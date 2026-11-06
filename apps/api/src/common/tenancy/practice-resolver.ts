import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { PRACTICE_SCHEMA_REQUIRED } from '../../generated/schema-versions.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { type DeploymentScope, practiceVerdict } from './practice-access.rules.js';
import type { PracticeUnavailableReason } from './practice-errors.js';
import type { PracticeListing, PracticePurpose, PracticeRoute } from './practice-route.js';

/** Whether a practice may be served now, and its route when it may. */
export type PracticeResolution =
  | { readonly answer: 'SERVE'; readonly route: PracticeRoute }
  | { readonly answer: 'NOT_FOUND' }
  | { readonly answer: 'UNAVAILABLE'; readonly reason: PracticeUnavailableReason };

/** A public request by slug: as PracticeResolution, with the listing and the practice's id. */
export type SlugResolution =
  | {
      readonly answer: 'SERVE';
      readonly route: PracticeRoute;
      readonly listing: PracticeListing;
    }
  | { readonly answer: 'NOT_FOUND' }
  | {
      readonly answer: 'UNAVAILABLE';
      readonly practiceId: string;
      readonly reason: PracticeUnavailableReason;
    };

/** The registry fields of a practice's route. */
const ROUTE_FIELDS = {
  id: true,
  status: true,
  market: true,
  clusterId: true,
  databaseName: true,
  appSecretRef: true,
  routeVersion: true,
  schemaVersion: true,
} as const;

/** A registry row with those fields. */
interface RouteRow {
  readonly id: string;
  readonly status: PracticeRoute['status'];
  readonly market: string;
  readonly clusterId: string | null;
  readonly databaseName: string | null;
  readonly appSecretRef: string | null;
  readonly routeVersion: number;
  readonly schemaVersion: string | null;
}

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
      select: ROUTE_FIELDS,
    });
    if (row === null) return { answer: 'NOT_FOUND' };
    return this.routeOf(row, purpose);
  }

  /**
   * A public request by slug (02 §5), current or retired: unknown and unpublished practices give
   * the same 404 as the status table's, before any practice client is leased.
   */
  async resolveSlug(slug: string): Promise<SlugResolution> {
    const row = await this.platform.practiceSlug.findUnique({
      where: { slug },
      select: {
        practice: {
          select: {
            ...ROUTE_FIELDS,
            name: true,
            publishedAt: true,
            slugs: { where: { retiredAt: null }, select: { slug: true }, take: 1 },
          },
        },
      },
    });
    if (row === null) return { answer: 'NOT_FOUND' };
    const { practice } = row;
    if (practice.publishedAt === null) return { answer: 'NOT_FOUND' };
    const resolution = this.routeOf(practice, 'public');
    if (resolution.answer === 'UNAVAILABLE') {
      return { ...resolution, practiceId: practice.id };
    }
    if (resolution.answer === 'NOT_FOUND') return resolution;
    return {
      answer: 'SERVE',
      route: resolution.route,
      listing: { slug: practice.slugs[0]?.slug ?? slug, name: practice.name },
    };
  }

  /** The status table for the purpose, the market check and the schema guard for one row. */
  private routeOf(row: RouteRow, purpose: PracticePurpose): PracticeResolution {
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
