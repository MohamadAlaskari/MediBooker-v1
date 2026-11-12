import type { PublicPracticeDto } from '@medibooker/api-client';
import { CalendarPlus, Clock, Globe, MapPin, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import type { PracticeFormat } from '@/lib/format';
import { bookHref } from '../portal/free-times/free-times-view';
import {
  openingRowsOf,
  openStatusOf,
  specialDayLineOf,
  telHref,
  type SpecialDayLine,
} from './practice-view';
import { CARD_CLASS } from './section';

interface PracticeHeroProps {
  readonly practice: PublicPracticeDto;
  readonly format: PracticeFormat;
}

function OpenBadge({ practice, format }: PracticeHeroProps): ReactNode {
  const t = useTranslations('practicePage.status');
  const status = openStatusOf(practice, format);
  if (status === undefined) return null;
  const { key, ...values } = status;
  return (
    <Badge variant={practice.openNow === true ? 'success' : 'neutral'}>
      <span aria-hidden className="size-2 rounded-full bg-current" />
      {t(key, values as never)}
    </Badge>
  );
}

function SpecialDay({ line }: { readonly line: SpecialDayLine }): ReactNode {
  const t = useTranslations('practicePage.hours');
  const { key, ...values } = line;
  return <li>{t(key, values as never)}</li>;
}

function OpeningHoursCard({ practice, format }: PracticeHeroProps): ReactNode {
  const t = useTranslations('practicePage.hours');
  const rows = openingRowsOf(practice, format);
  return (
    <section
      id="opening-hours"
      aria-labelledby="opening-hours-heading"
      className={`${CARD_CLASS} scroll-mt-16 p-6`}
    >
      <h2
        id="opening-hours-heading"
        className="flex items-center gap-2 text-heading-h3 text-text-primary"
      >
        <Clock aria-hidden className="size-5 text-icon-brand" />
        {t('title')}
      </h2>
      <dl className="mt-4">
        {rows.map(({ weekday, name, ranges, isToday }) => (
          <div
            key={weekday}
            aria-current={isToday ? 'date' : undefined}
            className={
              isToday
                ? 'flex items-center justify-between gap-4 rounded-md bg-bg-brand-muted p-2 text-label-default text-text-brand'
                : 'flex items-center justify-between gap-4 p-2 text-body-small text-text-secondary'
            }
          >
            <dt className="flex items-center gap-2">
              {name}
              {isToday ? <Badge variant="outline">{t('today')}</Badge> : null}
            </dt>
            <dd className="tabular-times text-end">
              {ranges.length === 0
                ? t('closed')
                : ranges.map(({ from, to }) => (
                    <span key={from} className="block">
                      {t('range', { from, to })}
                    </span>
                  ))}
            </dd>
          </div>
        ))}
      </dl>
      {practice.specialDays.length === 0 ? null : (
        <Alert className="mt-4">
          <AlertTitle>{t('specialTitle')}</AlertTitle>
          <AlertDescription>
            <ul>
              {practice.specialDays.map((day) => (
                <SpecialDay key={day.date} line={specialDayLineOf(day, format)} />
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

/**
 * The first screen: who the practice is, whether it is open and how to reach it (PW13). Booking
 * starts on its own page, which signs a visitor in first (B07).
 */
export function PracticeHero({
  practice,
  locale,
  format,
}: PracticeHeroProps & { readonly locale: string }): ReactNode {
  const t = useTranslations('practicePage.hero');
  const showHours = practice.openNow !== null;
  return (
    <div className="bg-bg-brand-subtle py-12">
      <div className="mx-auto grid max-w-page items-start gap-8 px-4 desktop:grid-cols-2">
        <div>
          <OpenBadge practice={practice} format={format} />
          <h1 className="mt-4 text-display text-text-primary">
            <bdi>{practice.name}</bdi>
          </h1>
          {practice.about === null ? null : (
            <p className="mt-4 text-body-large text-text-secondary">{practice.about}</p>
          )}
          <ul className="mt-4 flex flex-col gap-2 text-body-default text-text-secondary">
            {practice.address === null ? null : (
              <li className="flex items-center gap-2">
                <MapPin aria-hidden className="size-5 shrink-0 text-icon-brand" />
                <bdi>{practice.address}</bdi>
              </li>
            )}
            {practice.phone === null ? null : (
              <li className="flex items-center gap-2">
                <Phone aria-hidden className="size-5 shrink-0 text-icon-brand" />
                <span dir="ltr">{practice.phone}</span>
              </li>
            )}
            <li className="flex items-center gap-2">
              <Globe aria-hidden className="size-5 shrink-0 text-icon-brand" />
              {t('languages', { languages: format.languages(practice.supportedLocales) })}
            </li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href={bookHref(locale, practice.slug)}>
              <CalendarPlus aria-hidden data-icon="inline-start" />
              {t('bookAppointment')}
            </LinkButton>
            {practice.phone === null ? null : (
              <LinkButton variant="outline" href={telHref(practice.phone)}>
                <Phone aria-hidden data-icon="inline-start" />
                {t('callUs')}
              </LinkButton>
            )}
          </div>
        </div>
        {showHours ? <OpeningHoursCard practice={practice} format={format} /> : null}
      </div>
    </div>
  );
}
