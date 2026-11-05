import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { PRACTICE_SCHEMA_REQUIRED } from '../../generated/schema-versions.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { type DeploymentScope, practiceVerdict } from './practice-access.rules.js';
import type { PracticeUnavailableReason } from './practice-errors.js';
import type { PracticePurpose, PracticeRoute } from './practice-route.js';

/** Whether a practice may be served now, and its route when it may. */
export type PracticeResolution =
  | { readonly answer: 'SERVE'; readonly route: PracticeRoute }
  | { readonly answer: 'NOT_FOUND' }
  | { readonly answer: 'UNAVAILABLE'; readonly reason: PracticeUnavailableReason };

/**
 * Reads a practice's registry row from the platform database, on every call (status changes
 * take effect at once), and applies the status table for the purpose, the market check and the
 * schema guard before any practice client is leased (ADR 0005 §5.1, §6.8, §7.2).
 */
@Injectable()
export class PracticeResolver {
  private readonly scope: DeploymentScope;

  constructor(
    private readonly platform: PlatformPrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.scope = {
      appEnv: env.APP_ENV,
      markets: env.MARKETS,
      practiceSchemaRequired: PRACTICE_SCHEMA_REQUIRED,
    };
  }

  /** `practiceId` must be a UUID. */
  async resolve(practiceId: string, purpose: PracticePurpose): Promise<PracticeResolution> {
    const row = await this.platform.practice.findUnique({
      where: { id: practiceId },
      select: {
        id: true,
        status: true,
        market: true,
        clusterId: true,
        databaseName: true,
        appSecretRef: true,
        routeVersion: true,
        schemaVersion: true,
      },
    });
    if (row === null) return { answer: 'NOT_FOUND' };
    const verdict = practiceVerdict(row, purpose, this.scope);
    if (verdict.answer !== 'SERVE') return verdict;
    const { clusterId, databaseName, appSecretRef, schemaVersion } = row;
    if (
      clusterId === null ||
      databaseName === null ||
      appSecretRef === null ||
      schemaVersion === null
    ) {
      return { answer: 'UNAVAILABLE', reason: 'PRACTICE_ROUTE_INCOMPLETE' };
    }
    return {
      answer: 'SERVE',
      route: {
        id: row.id,
        status: row.status,
        market: row.market,
        clusterId,
        databaseName,
        appSecretRef,
        routeVersion: row.routeVersion,
        schemaVersion,
      },
    };
  }

  /** The ids of the ACTIVE practices, in a stable order (forEachPractice). */
  async activePracticeIds(): Promise<string[]> {
    const rows = await this.platform.practice.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }
}
