import type { PublicPracticeDto } from '@medibooker/api-client';
import type { ReactNode } from 'react';
import { practiceFormat } from '@/lib/format';
import { BookOnlineSection } from './book-online-section';
import { PracticeHeader } from './practice-header';
import { PracticeHero } from './practice-hero';
import { FindUsSection, PracticeFooter, ServicesSection, TeamSection } from './practice-sections';

interface PracticePageProps {
  readonly practice: PublicPracticeDto;
  readonly locale: string;
}

/** The public page of a practice, PW13 and PW14: one column on a phone, wider from a tablet on. */
export function PracticePage({ practice, locale }: PracticePageProps): ReactNode {
  const format = practiceFormat(locale, practice);
  return (
    <>
      <PracticeHeader practice={practice} locale={locale} showHours={practice.openNow !== null} />
      <main id="main" tabIndex={-1}>
        <PracticeHero practice={practice} locale={locale} format={format} />
        <BookOnlineSection practice={practice} locale={locale} />
        <ServicesSection practice={practice} format={format} />
        <TeamSection practice={practice} format={format} />
        <FindUsSection practice={practice} format={format} />
      </main>
      <PracticeFooter practice={practice} format={format} />
    </>
  );
}
