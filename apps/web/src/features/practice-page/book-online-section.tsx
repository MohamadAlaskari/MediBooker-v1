import type { PublicPracticeDto } from '@medibooker/api-client';
import { LogIn, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LinkButton } from '@/components/ui/button';
import { bookHref } from '../portal/free-times/free-times-view';
import { PageSection } from './section';

/**
 * Where to sign in or sign up, and back to the booking after it: the way of a signed-in person. The
 * fragment carries the way back, so no server ever sees it (03 §7).
 */
export function authHrefs(
  locale: string,
  slug: string,
): { readonly signIn: string; readonly signUp: string } {
  const back = `#next=${encodeURIComponent(bookHref(locale, slug))}`;
  return { signIn: `/${locale}/sign-in${back}`, signUp: `/${locale}/sign-up${back}` };
}

interface BookOnlineSectionProps {
  readonly practice: PublicPracticeDto;
  readonly locale: string;
}

/**
 * Where the free times were (B07): a practice's times are only for signed-in people, the user's
 * decision of 2026-11-12. The page says so and leads to signing in or up, and on to the booking.
 */
export function BookOnlineSection({ practice, locale }: BookOnlineSectionProps): ReactNode {
  const t = useTranslations('practicePage.bookOnline');
  const { signIn, signUp } = authHrefs(locale, practice.slug);
  return (
    <PageSection id="book-online" title={t('title')} subtitle={t('body')}>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={signIn}>
          <LogIn aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
          {t('signIn')}
        </LinkButton>
        <LinkButton variant="outline" href={signUp}>
          <UserPlus aria-hidden data-icon="inline-start" />
          {t('signUp')}
        </LinkButton>
      </div>
    </PageSection>
  );
}
