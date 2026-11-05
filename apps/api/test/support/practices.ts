/**
 * The databases of one integration test file (02 §12, 06 §3): its own platform database, copied
 * from platform_template with the ACL that 01-cluster.sh gives medibooker_platform, and the
 * practices practiceA and practiceB with fresh ids. Files run in parallel and never share a
 * database. The teardown drops every practice of the file with dropPractice, then the platform
 * database.
 *
 * Usage, at the top of a test file or a describe block:
 *
 *   const databases = usePracticeDatabases();
 *   // in a test or a later beforeAll:
 *   const app = await createTestApp({ env: databases.apiEnv });
 */
import { randomUUID } from 'node:crypto';
import { createDevSecretStore, practiceNames, type SecretStore } from '@medibooker/db-migrate';
import {
  dropPractice,
  provisionPractice,
  type ProvisionedPractice,
} from '@medibooker/db-migrate/testing';
import type { Client, ClientConfig } from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';
import {
  PLATFORM_TEMPLATE,
  roleUrl,
  type IntegrationCluster,
} from '../integration/support/cluster.js';
import { connect, quoteIdent, withClient } from '../integration/support/sql.js';

/**
 * How a practice is made: a copy of the migrated practice_template through
 * createPracticeDatabase() (fast, for tests that do not test provisioning), or the full path of
 * `medibooker-db provision` as medibooker_provisioner (ADR 0005 §5.3; the tenancy specs).
 */
export type PracticePath = 'template' | 'full';

export interface ProvisionOptions {
  /** Default: `template`. */
  readonly path?: PracticePath;
  /** ISO 3166-1 alpha-2; default `SA`. */
  readonly market?: string;
}

/**
 * A file's databases. The getters throw until the file's beforeAll has run. URLs and connection
 * options hold passwords: pass them on, never print them.
 */
export class PracticeDatabases {
  readonly #cluster: IntegrationCluster = inject('integrationCluster');
  readonly #platformDatabase = `platform_${randomUUID().replaceAll('-', '')}`;
  readonly #secretStore: SecretStore;
  readonly #practicesToDrop = new Set<string>();
  #platformCreated = false;
  #practiceA: ProvisionedPractice | undefined;
  #practiceB: ProvisionedPractice | undefined;

  constructor() {
    // The development store of `medibooker-db` with SECRET_STORE=dev: `dev:` references derive
    // from the seed, and the cluster `local` names the provisioner as env:PROVISIONER_DATABASE_URL.
    this.#secretStore = createDevSecretStore({
      appEnv: 'ci',
      seed: this.#cluster.secrets.DEV_SECRET_SEED,
      environment: { PROVISIONER_DATABASE_URL: this.provisionerUrl },
    });
  }

  /** The cluster's host and port as the tests reach it. */
  get endpoint(): { readonly host: string; readonly port: number } {
    return { host: this.#cluster.host, port: this.#cluster.port };
  }

  get platformDatabase(): string {
    return this.#platformDatabase;
  }

  /** The platform database as the API's role (PLATFORM_DATABASE_URL). */
  get platformAppUrl(): string {
    return roleUrl(this.#cluster, 'platform_app', this.#platformDatabase);
  }

  /** The platform database as its owner (PLATFORM_MIGRATION_URL): registry and audit log. */
  get platformOwnerUrl(): string {
    return roleUrl(this.#cluster, 'platform_owner', this.#platformDatabase);
  }

  /** The cluster as medibooker_provisioner (PROVISIONER_DATABASE_URL). */
  get provisionerUrl(): string {
    return roleUrl(this.#cluster, 'medibooker_provisioner', 'postgres');
  }

  /** A database as the cluster's superuser (DATABASE_ADMIN_URL): catalog checks and teardown. */
  superuserUrl(database = 'postgres'): string {
    return roleUrl(this.#cluster, 'postgres', database);
  }

  /** The development secret store that provisioned the file's practices. */
  get secretStore(): SecretStore {
    return this.#secretStore;
  }

  /** The variables of an API test app on this file's databases: `createTestApp({ env })`. */
  get apiEnv(): Readonly<Record<string, string>> {
    return {
      APP_ENV: 'ci',
      PLATFORM_DATABASE_URL: this.platformAppUrl,
      SECRET_STORE: 'dev',
      DEV_SECRET_SEED: this.#cluster.secrets.DEV_SECRET_SEED,
    };
  }

  get practiceA(): ProvisionedPractice {
    if (this.#practiceA === undefined) throw new Error('practiceA is not provisioned');
    return this.#practiceA;
  }

  get practiceB(): ProvisionedPractice {
    if (this.#practiceB === undefined) throw new Error('practiceB is not provisioned');
    return this.#practiceB;
  }

  /** Provisions one more practice with a fresh id; the teardown drops it. */
  async provision(options: ProvisionOptions = {}): Promise<ProvisionedPractice> {
    const practiceId = randomUUID();
    this.dropOnTeardown(practiceId);
    return provisionPractice({
      practiceId,
      market: options.market ?? 'SA',
      appEnv: 'ci',
      platformUrl: this.platformOwnerUrl,
      provisionerUrl: this.provisionerUrl,
      secretStore: this.#secretStore,
      ...((options.path ?? 'template') === 'template'
        ? { fromTemplate: true, adminUrl: this.superuserUrl() }
        : {}),
    });
  }

  /** Drops a practice that a test provisioned itself (for example the seed's) at teardown. */
  dropOnTeardown(practiceId: string): void {
    this.#practicesToDrop.add(practiceId);
  }

  /** Connection options of a practice's app role on a database: by default its own. */
  async appConnection(
    practice: ProvisionedPractice,
    database: string = practice.databaseName,
  ): Promise<ClientConfig> {
    const names = practiceNames(practice.practiceId);
    return {
      host: this.#cluster.host,
      port: this.#cluster.port,
      user: names.appRole,
      password: await this.#secretStore.get(names.appSecretRef),
      database,
    };
  }

  /** A connection of a practice's app role to its own database; the caller ends it. */
  async connectAsApp(practice: ProvisionedPractice): Promise<Client> {
    return connect(await this.appConnection(practice));
  }

  /** Creates the platform database and practiceA and practiceB; run by usePracticeDatabases. */
  async setUp(practices: PracticePath | 'none'): Promise<void> {
    const name = quoteIdent(this.#platformDatabase);
    await withClient(this.superuserUrl(), async (admin) => {
      await admin.query(
        `CREATE DATABASE ${name} OWNER platform_owner TEMPLATE ${PLATFORM_TEMPLATE}`,
      );
      this.#platformCreated = true;
      // PostgreSQL grants CONNECT to PUBLIC on every new database; 01-cluster.sh narrows it.
      await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${name} TO platform_app`);
    });
    if (practices === 'none') return;
    this.#practiceA = await this.provision({ path: practices, market: 'SA' });
    this.#practiceB = await this.provision({ path: practices, market: 'DE' });
  }

  /** Drops every practice of the file, then the platform database; run by usePracticeDatabases. */
  async tearDown(): Promise<void> {
    if (!this.#platformCreated) return;
    const failures: unknown[] = [];
    for (const practiceId of this.#practicesToDrop) {
      await dropPractice({
        practiceId,
        appEnv: 'ci',
        platformUrl: this.platformOwnerUrl,
        adminUrl: this.superuserUrl(),
      }).catch((error: unknown) => failures.push(error));
    }
    await withClient(this.superuserUrl(), (admin) =>
      admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(this.#platformDatabase)} WITH (FORCE)`),
    );
    if (failures.length > 0) throw new AggregateError(failures, 'dropPractice failed');
  }
}

export interface PracticeDatabasesOptions {
  /** How practiceA and practiceB are made, or `none`. Default: `template`. */
  readonly practices?: PracticePath | 'none';
}

/**
 * Registers the file's beforeAll and afterAll and returns its databases. Call it before the
 * file's own hooks: its beforeAll then runs first, and its afterAll last.
 */
export function usePracticeDatabases(options: PracticeDatabasesOptions = {}): PracticeDatabases {
  const databases = new PracticeDatabases();
  beforeAll(() => databases.setUp(options.practices ?? 'template'));
  afterAll(() => databases.tearDown());
  return databases;
}
