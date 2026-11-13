import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import { PracticeRunner } from '../../common/tenancy/practice-runner.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { textFor } from '../public-practice/domain/locale.js';

/** How the practice writes a time (its settings): what an e-mail with a time needs. */
export interface PracticeWriting {
  readonly timeZone: string;
  readonly numberingSystem: string;
  readonly hourCycle: string;
}

/** Where the installation names no practice, or its database cannot be reached. */
export const WRITING_FALLBACK: PracticeWriting = {
  timeZone: 'UTC',
  numberingSystem: 'latn',
  hourCycle: 'h23',
};

/**
 * Whether a time can be written this way: a zone or a locale this runtime does not take would fail
 * every e-mail with a time on each try, so such settings get the fallback (the security review of A04
 * part 2b). The zone is a column the practice's management will change (M01).
 */
export function canWrite({ timeZone, numberingSystem, hourCycle }: PracticeWriting): boolean {
  try {
    const format = new Intl.DateTimeFormat(`en-u-nu-${numberingSystem}-hc-${hourCycle}`, {
      timeZone,
      timeStyle: 'short',
    });
    return format.format(0) !== '';
  } catch {
    return false;
  }
}

/**
 * The practice this installation serves (ADR 0016), as its account e-mails name it. Read from the
 * registry each time: e-mails are few, and a renamed practice is named anew at once.
 */
@Injectable()
export class InstallationPractice {
  constructor(
    private readonly platform: PlatformPrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly runner: PracticeRunner,
    @InjectTransactionHost('practice') private readonly practiceTx: PracticeTransactionHost,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(InstallationPractice.name);
  }

  /** Its name in a language, or in its other one; undefined where the installation names none. */
  async nameIn(locale: string): Promise<string | undefined> {
    const row = await this.registryRow();
    if (row === undefined) return undefined;
    const fallback = locale === 'ar' ? 'en' : 'ar';
    return textFor(row.practice.name, locale, fallback) ?? undefined;
  }

  /**
   * How it writes a time, for the security e-mails (A04): its zone, digits and hours, from its own
   * database. A practice that cannot be reached, or settings no formatter takes, get UTC and Latin
   * digits: the e-mail still goes.
   */
  async writing(): Promise<PracticeWriting> {
    const row = await this.registryRow();
    if (row === undefined) return WRITING_FALLBACK;
    let settings: PracticeWriting;
    try {
      settings = await this.runner.runInPractice(
        row.practiceId,
        () =>
          this.practiceTx.tx.practiceSettings.findUniqueOrThrow({
            where: { id: 1 },
            select: { timeZone: true, numberingSystem: true, hourCycle: true },
          }),
        { purpose: 'job' },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'practice settings for an account e-mail not read');
      return WRITING_FALLBACK;
    }
    if (canWrite(settings)) return settings;
    this.logger.warn('practice settings for an account e-mail cannot write a time');
    return WRITING_FALLBACK;
  }

  private async registryRow(): Promise<
    { readonly practiceId: string; readonly practice: { readonly name: unknown } } | undefined
  > {
    const slug = this.env.PRACTICE_SLUG;
    if (slug === undefined) return undefined;
    const row = await this.platform.practiceSlug.findUnique({
      where: { slug },
      select: { practiceId: true, practice: { select: { name: true } } },
    });
    return row ?? undefined;
  }
}
