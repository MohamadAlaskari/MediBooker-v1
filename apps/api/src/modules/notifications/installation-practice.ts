import { Inject, Injectable } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { textFor } from '../public-practice/domain/locale.js';

/**
 * The practice this installation serves (ADR 0016), as its account e-mails name it. Read from the
 * registry each time: e-mails are few, and a renamed practice is named anew at once.
 */
@Injectable()
export class InstallationPractice {
  constructor(
    private readonly platform: PlatformPrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Its name in a language, or in its other one; undefined where the installation names none. */
  async nameIn(locale: string): Promise<string | undefined> {
    const slug = this.env.PRACTICE_SLUG;
    if (slug === undefined) return undefined;
    const row = await this.platform.practiceSlug.findUnique({
      where: { slug },
      select: { practice: { select: { name: true } } },
    });
    if (row === null) return undefined;
    const fallback = locale === 'ar' ? 'en' : 'ar';
    return textFor(row.practice.name, locale, fallback) ?? undefined;
  }
}
