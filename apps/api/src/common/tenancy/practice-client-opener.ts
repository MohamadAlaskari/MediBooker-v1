import type { ConnectionOptions } from 'node:tls';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ENV } from '../../config/env.module.js';
import type { ClusterEndpoint, Env } from '../../config/env.schema.js';
import type { DatabaseClusterTlsMode } from '../../generated/platform/enums.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { isAuthenticationFailure } from '../database/prisma-errors.js';
import { SecretStore } from '../database/secret-store.js';
import { type PracticeClient, PracticeClientFactory } from './practice-client.js';
import { PracticeConnectionMetrics } from './practice-connection-metrics.js';
import { appRoleOf, endpointOf, tlsOptionsOf } from './practice-endpoint.js';
import { PracticeUnavailableError, type PracticeUnavailableReason } from './practice-errors.js';
import type { PracticeRoute } from './practice-route.js';
import { PracticeSecrets } from './practice-secrets.js';

interface IdentityRow {
  practice_id: string | null;
  public_connect: boolean;
}

interface ClusterRoute {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly tlsMode: DatabaseClusterTlsMode;
  readonly caSecretRef: string | null;
}

/**
 * Opens the client of a practice database and proves it is the right one (02 §5 item 3, ADR
 * 0005 §2.2): the endpoint and TLS of its cluster, the app role's password from the secret store,
 * then one query that compares `practice_identity` with the route and reads whether CONNECT is
 * open to PUBLIC. Every failure closes the client and becomes a PracticeUnavailableError; only
 * the practice id, the cluster id and the reason code are logged, never a host, user, secret
 * reference or password (02 §8).
 */
@Injectable()
export class PracticeClientOpener {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly platform: PlatformPrismaService,
    private readonly secrets: PracticeSecrets,
    private readonly store: SecretStore,
    private readonly factory: PracticeClientFactory,
    private readonly metrics: PracticeConnectionMetrics,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PracticeClientOpener.name);
  }

  async open(route: PracticeRoute): Promise<PracticeClient> {
    const cluster = await this.platform.databaseCluster.findUnique({
      where: { id: route.clusterId },
      select: { id: true, host: true, port: true, tlsMode: true, caSecretRef: true },
    });
    if (cluster === null) throw new PracticeUnavailableError(route.id, 'PRACTICE_CLUSTER_UNKNOWN');
    const endpoint = endpointOf(cluster, this.env.DATABASE_CLUSTER_ENDPOINTS);
    const ssl = await this.tlsOf(route, cluster, endpoint.host);
    try {
      return await this.connect(route, endpoint, ssl, await this.password(route, false));
    } catch (error) {
      if (!(error instanceof PracticeUnavailableError)) throw error;
      if (error.reason !== 'PRACTICE_AUTHENTICATION_FAILED') throw error;
      // The secret may have changed since it was cached: read it once more (02 §5 item 3).
      return await this.connect(route, endpoint, ssl, await this.password(route, true));
    }
  }

  /** TLS with the cluster's CA; a cluster without TLS is accepted in local and ci only. */
  private async tlsOf(
    route: PracticeRoute,
    cluster: ClusterRoute,
    host: string,
  ): Promise<ConnectionOptions | false> {
    if (cluster.tlsMode === 'DISABLE') {
      if (this.env.APP_ENV === 'local' || this.env.APP_ENV === 'ci') return false;
      throw new PracticeUnavailableError(route.id, 'PRACTICE_TLS_REQUIRED');
    }
    const caReference = cluster.caSecretRef;
    if (caReference === null) {
      throw new PracticeUnavailableError(route.id, 'PRACTICE_SECRET_UNAVAILABLE');
    }
    const ca = await this.secret(route, () => this.store.get(caReference));
    return tlsOptionsOf(ca, host);
  }

  private password(route: PracticeRoute, fresh: boolean): Promise<string> {
    return this.secret(route, () => this.secrets.appPassword(route, fresh));
  }

  /** A secret, or PRACTICE_SECRET_UNAVAILABLE when the store cannot resolve its reference. */
  private async secret(route: PracticeRoute, read: () => Promise<string>): Promise<string> {
    try {
      return await read();
    } catch (error) {
      throw new PracticeUnavailableError(route.id, 'PRACTICE_SECRET_UNAVAILABLE', { cause: error });
    }
  }

  private async connect(
    route: PracticeRoute,
    endpoint: ClusterEndpoint,
    ssl: ConnectionOptions | false,
    password: string,
  ): Promise<PracticeClient> {
    const client = this.factory.create(route.id, {
      host: endpoint.host,
      port: endpoint.port,
      database: route.databaseName,
      user: appRoleOf(route),
      password,
      ssl,
      poolMax: this.env.PRACTICE_POOL_MAX,
    });
    try {
      await this.verify(route, client);
      return client;
    } catch (error) {
      await this.closeQuietly(client);
      throw this.unavailableOf(route, error);
    }
  }

  /** The first query of a new client: it opens the connection and checks identity and ACL. */
  private async verify(route: PracticeRoute, client: PracticeClient): Promise<void> {
    const [identity] = await client.$queryRaw<IdentityRow[]>`
      SELECT (SELECT practice_id::text FROM practice_identity WHERE id = 1) AS practice_id,
             has_database_privilege('public', current_database(), 'CONNECT') AS public_connect`;
    if (identity?.practice_id !== route.id) {
      this.metrics.identityMismatches += 1;
      throw this.refused(route, 'PRACTICE_IDENTITY_MISMATCH');
    }
    if (identity.public_connect) {
      this.metrics.openAcls += 1;
      throw this.refused(route, 'PRACTICE_ACL_OPEN');
    }
  }

  /** A database that must never be served: a routing mistake or an open ACL (ADR 0005 §4.2). */
  private refused(route: PracticeRoute, reasonCode: PracticeUnavailableReason): Error {
    this.logger.error(
      { practiceId: route.id, clusterId: route.clusterId, reasonCode },
      'practice database refused',
    );
    return new PracticeUnavailableError(route.id, reasonCode);
  }

  private unavailableOf(route: PracticeRoute, error: unknown): PracticeUnavailableError {
    if (error instanceof PracticeUnavailableError) return error;
    if (isAuthenticationFailure(error)) {
      this.metrics.authenticationFailures += 1;
      return new PracticeUnavailableError(route.id, 'PRACTICE_AUTHENTICATION_FAILED', {
        cause: error,
      });
    }
    return new PracticeUnavailableError(route.id, 'PRACTICE_CONNECTION_FAILED', { cause: error });
  }

  private async closeQuietly(client: PracticeClient): Promise<void> {
    try {
      await client.$disconnect();
    } catch {
      // The client failed already; the reason that matters is the original error.
    }
  }
}
