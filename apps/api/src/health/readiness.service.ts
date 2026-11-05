import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlatformPrismaService } from '../common/database/platform-prisma.service.js';
import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import { PLATFORM_SCHEMA_REQUIRED } from '../generated/schema-versions.js';

/** How long readiness waits for the platform database (02 §10). */
const PLATFORM_CHECK_TIMEOUT_MS = 1000;

/**
 * Readiness (02 §10): the platform database answers within one second and its schema has reached
 * PLATFORM_SCHEMA_REQUIRED, MARKETS is set in staging and production, and the app is not shutting
 * down. Practice databases are not part of it: an unavailable practice answers its own requests
 * with 503 and never takes the API out of rotation.
 */
@Injectable()
export class ReadinessService implements BeforeApplicationShutdown {
  private draining = false;

  constructor(
    private readonly platform: PlatformPrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Shutdown has begun: report not ready, so the instance leaves the rotation. */
  beforeApplicationShutdown(): void {
    this.draining = true;
  }

  /** Throws 503 SERVICE_UNAVAILABLE when the instance must not receive traffic. */
  async assertReady(): Promise<void> {
    const deployed = this.env.APP_ENV === 'staging' || this.env.APP_ENV === 'production';
    if (this.draining || (deployed && this.env.MARKETS.length === 0)) {
      throw new ServiceUnavailableException();
    }
    const schemaVersion = await this.platformSchemaVersion();
    if (schemaVersion === undefined || schemaVersion < PLATFORM_SCHEMA_REQUIRED) {
      throw new ServiceUnavailableException();
    }
  }

  /** The platform schema version, or undefined when the database did not answer in time. */
  private async platformSchemaVersion(): Promise<string | undefined> {
    const check = async (): Promise<string | undefined> => {
      await this.platform.assertReachable();
      return this.platform.schemaVersion();
    };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(resolve, PLATFORM_CHECK_TIMEOUT_MS, undefined);
      timer.unref();
    });
    try {
      // Promise.race also handles a rejection of the check that arrives after the timeout.
      return await Promise.race([check().catch(() => undefined), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
