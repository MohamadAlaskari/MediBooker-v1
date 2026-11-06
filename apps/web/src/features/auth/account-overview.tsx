'use client';

import { useGetMe, useLogout } from '@medibooker/api-client';
import { isolateLtr } from '@medibooker/i18n';
import { CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormError, PageHeading } from './form-parts';
import { ResendButton } from './resend-button';
import { useSignInWhenOver } from './session-redirect';

/** Where a sign-in leads until the portal exists (B04): who is signed in, and how to get out. */
export function AccountOverview(): ReactNode {
  const t = useTranslations('auth.account');
  const locale = useLocale();
  const me = useGetMe();
  useSignInWhenOver(me.error, '/account');
  const logout = useLogout();
  if (me.data === undefined) {
    return (
      <>
        <PageHeading title={t('title')} />
        {me.error === null ? (
          <p role="status" className="text-body-default text-text-secondary">
            {t('loading')}
          </p>
        ) : (
          <FormError error={me.error} />
        )}
      </>
    );
  }
  const { email, emailVerified } = me.data;
  return (
    <>
      <PageHeading title={t('title')} body={t('signedInAs', { email: isolateLtr(email) })} />
      {emailVerified ? (
        <p className="mb-6 flex items-center gap-2 text-body-default text-text-success">
          <CircleCheck aria-hidden className="size-5 shrink-0" />
          {t('confirmed')}
        </p>
      ) : (
        <Alert className="mb-6 gap-2">
          <AlertTitle>{t('notConfirmedTitle')}</AlertTitle>
          <AlertDescription>{t('notConfirmedBody')}</AlertDescription>
          <ResendButton email={email} label={t('resend')} sentLabel={t('resent')} />
        </Alert>
      )}
      <FormError error={logout.error} />
      <Button
        variant="outline"
        className="mt-2"
        isDisabled={logout.isPending}
        onPress={() => {
          logout.mutate(
            { data: {} },
            {
              onSuccess: () => {
                // A new document: nothing of this person stays in memory for whoever comes next.
                window.location.replace(`/${locale}/sign-in`);
              },
            },
          );
        }}
      >
        {t('signOut')}
      </Button>
    </>
  );
}
