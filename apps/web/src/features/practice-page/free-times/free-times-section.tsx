import type { PublicPracticeDto } from '@medibooker/api-client';
import { DEFAULT_LOCALE, isLocale, isolate, messages } from '@medibooker/i18n';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { PracticeFormat } from '@/lib/format';
import { doctorsOf } from '../practice-view';
import { PageSection } from '../section';
import { FreeTimesPicker } from './free-times-picker';

interface FreeTimesSectionProps {
  readonly practice: PublicPracticeDto;
  readonly locale: string;
  readonly format: PracticeFormat;
}

/**
 * Where a visitor finds a time (P06). The server renders the picker's frame and the phone, so the
 * section has its place before the times arrive, and without JavaScript the phone is the way.
 */
export function FreeTimesSection({ practice, locale, format }: FreeTimesSectionProps): ReactNode {
  const t = useTranslations('practicePage');
  const { services, team, phone, numberingSystem, hourCycle, timeZone } = practice;
  const offers = services.map(({ id, name, durationMinutes }) => {
    const duration = t('services.duration', {
      count: durationMinutes,
      minutes: format.number(durationMinutes),
    });
    return {
      id,
      // Plain for React Aria's typeahead; isolated where it shows, so that a name in another script
      // keeps its order and leaves the sentence's alone (B06).
      label: t('freeTimes.serviceOption', { name: name ?? '', duration }),
      display: t('freeTimes.serviceOption', { name: isolate(name ?? ''), duration }),
    };
  });
  const language = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <PageSection
      id="free-times"
      title={t('freeTimes.title')}
      subtitle={t(offers.length === 0 ? 'freeTimes.placeholder' : 'freeTimes.subtitle')}
    >
      {offers.length === 0 ? null : (
        // The client needs only these texts (ADR 0013).
        <NextIntlClientProvider
          locale={language}
          messages={{ practicePage: { freeTimes: messages[language].practicePage.freeTimes } }}
        >
          <FreeTimesPicker
            slug={practice.slug}
            locale={locale}
            settings={{ numberingSystem, hourCycle, timeZone }}
            today={practice.today}
            weekStart={practice.weekStart}
            services={offers}
            doctors={doctorsOf(team)}
            phone={phone}
          />
        </NextIntlClientProvider>
      )}
    </PageSection>
  );
}
