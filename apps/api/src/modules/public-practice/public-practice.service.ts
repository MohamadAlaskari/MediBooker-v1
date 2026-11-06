import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { cursorPageOf, type CursorQueryDto, decodeCursor } from '../../common/http/cursor-page.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import { PracticeContextMissingError } from '../../common/tenancy/practice-errors.js';
import { isPracticeSlug } from '../../common/tenancy/practice-route.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { PublishedPractices } from '../../common/tenancy/published-practices.js';
import { Clock } from '../../common/time/clock.js';
import { dbDateOf } from '../../common/time/convert.js';
import { OPEN_NOW_HORIZON_DAYS } from './domain/open-now.js';
import type { PublicPracticeDto, PublicPracticeListDto } from './public-practice.dto.js';
import { toPublicPractice } from './public-practice.mapper.js';

/**
 * Reads the public view of the practice of the current `@PracticeScoped('slug')` request: the name
 * and slug from the registry, everything else from the practice's own database. The list of
 * practices needs no practice database and no scope.
 */
@Injectable()
export class PublicPracticeService {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly clock: Clock,
    private readonly cls: ClsService<RequestContext>,
    private readonly published: PublishedPractices,
  ) {}

  async list({ limit, cursor }: CursorQueryDto): Promise<PublicPracticeListDto> {
    const after = cursor === undefined ? undefined : decodeCursor(cursor, isPracticeSlug);
    const slugs = await this.published.slugs(after, limit + 1);
    return cursorPageOf(
      slugs.map((slug) => ({ slug })),
      limit,
      ({ slug }) => slug,
    );
  }

  async read(acceptLanguage: string | undefined): Promise<PublicPracticeDto> {
    const { listing } = requirePracticeContext(this.cls);
    if (listing === undefined) throw new PracticeContextMissingError();
    const now = this.clock.now();
    const db = this.txHost.tx;
    const settings = await db.practiceSettings.findUniqueOrThrow({ where: { id: 1 } });
    const today = now.toZonedDateTimeISO(settings.timeZone).toPlainDate();
    const [page, theme, openingHours, specialDays, services, team] = await Promise.all([
      db.practicePage.findUniqueOrThrow({ where: { id: 1 } }),
      db.practiceTheme.findUniqueOrThrow({ where: { id: 1 } }),
      db.openingHours.findMany(),
      db.specialDay.findMany({
        where: {
          date: {
            gte: dbDateOf(today),
            lte: dbDateOf(today.add({ days: OPEN_NOW_HORIZON_DAYS })),
          },
        },
        orderBy: { date: 'asc' },
      }),
      db.service.findMany({
        where: { active: true, isBookableOnline: true },
        orderBy: { sortOrder: 'asc' },
      }),
      db.staffMember.findMany({
        where: {
          hiddenAt: null,
          consents: { some: { type: 'PUBLIC_PROFILE', withdrawnAt: null } },
        },
      }),
    ]);
    return toPublicPractice(
      {
        slug: listing.slug,
        name: listing.name,
        settings,
        page,
        theme,
        openingHours,
        specialDays,
        services,
        team,
      },
      now,
      acceptLanguage,
    );
  }
}
