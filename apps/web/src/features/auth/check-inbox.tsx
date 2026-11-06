'use client';

import { useGetMe } from '@medibooker/api-client';
import { isolateLtr } from '@medibooker/i18n';
import { Mail } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LinkButton } from '@/components/ui/button';
import { useReturnPath } from './fragment';
import { FormError } from './form-parts';
import { ResendButton } from './resend-button';
import { useSignInWhenOver } from './session-redirect';
import { SignUpSteps } from './sign-up-steps';

/** Screen 12. The person is already signed in and can go on: only a booking waits for the link. */
export function CheckInbox(): ReactNode {
  const t = useTranslations('auth.checkInbox');
  const locale = useLocale();
  const returnPath = useReturnPath();
  const me = useGetMe();
  useSignInWhenOver(me.error, '/check-inbox');
  return (
    <>
      <SignUpSteps current="verify" />
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-bg-brand-subtle">
          <Mail aria-hidden className="size-8 text-icon-brand" />
        </span>
        <h1 className="text-heading-h1 text-text-primary">{t('title')}</h1>
        {me.data === undefined ? (
          <FormError error={me.error} />
        ) : (
          <p className="text-body-default text-text-secondary">
            {t('body', { email: isolateLtr(me.data.email) })}
          </p>
        )}
      </div>
      <div className="mt-8 flex flex-col gap-2">
        <LinkButton href={returnPath ?? `/${locale}/account`}>{t('continue')}</LinkButton>
        {me.data === undefined ? null : (
          <ResendButton
            email={me.data.email}
            label={t('resend')}
            sentLabel={t('resent')}
            startWaiting
          />
        )}
      </div>
    </>
  );
}
