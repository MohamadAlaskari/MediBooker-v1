'use client';

import { isApiError, useGetMe, useGetMyMembership } from '@medibooker/api-client';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { FormError, PageHeading } from '../auth/form-parts';
import { SignOutButton, useSessionChangeElsewhere } from '../auth/sign-out-button';
import { NoAccess, Notice } from './notice';
import { TwoFactorSetup } from './two-factor-setup';

function Loading(): ReactNode {
  const t = useTranslations('auth.dashboard');
  return (
    <p role="status" className="text-body-default text-text-secondary">
      {t('loading')}
    </p>
  );
}

/**
 * A staff route answers MFA_REQUIRED before anything else: who has no second factor yet sets it up
 * here, and who has one but signed in without it signs in again.
 */
function SecondFactorNeeded({ onEnabled }: { readonly onEnabled: () => void }): ReactNode {
  const t = useTranslations('auth.dashboard');
  const me = useGetMe();
  if (me.isPending) return <Loading />;
  if (me.data === undefined) return <FormError error={me.error} />;
  if (!me.data.mfaEnabled) {
    return (
      <TwoFactorSetup
        onEnabled={() => {
          void me.refetch();
          onEnabled();
        }}
      />
    );
  }
  return <Notice title={t('againTitle')} body={t('againBody')} />;
}

/**
 * The start of the practice dashboard (A04): the own role in the installation's practice. The
 * appointments of the day follow with M05. Every answer comes from the API, which decides.
 */
export function DashboardHome({
  practiceId,
}: {
  readonly practiceId: string | undefined;
}): ReactNode {
  const t = useTranslations('auth.dashboard');
  useSessionChangeElsewhere();
  const membership = useGetMyMembership(practiceId ?? '', {
    query: { enabled: practiceId !== undefined, retry: false },
  });
  if (practiceId === undefined) return <p className="text-body-default">{t('noPractice')}</p>;
  if (membership.isPending) return <Loading />;
  if (membership.data !== undefined) {
    return (
      <>
        <PageHeading title={t('title')} body={t('signedInAs', { role: membership.data.role })} />
        <p className="mb-6 text-body-default text-text-secondary">{t('soon')}</p>
        <SignOutButton className="w-full" />
      </>
    );
  }
  const { error } = membership;
  if (isApiError(error, 'MFA_REQUIRED')) {
    return (
      <SecondFactorNeeded
        onEnabled={() => {
          void membership.refetch();
        }}
      />
    );
  }
  if (isApiError(error, 'NOT_FOUND') || isApiError(error, 'FORBIDDEN')) return <NoAccess />;
  return <FormError error={error} />;
}
