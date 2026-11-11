'use client';

import { isApiError, useGetMe, useGetMyMembership } from '@medibooker/api-client';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AuthShell } from '../auth/auth-shell';
import { FormError } from '../auth/form-parts';
import { useSessionChangeElsewhere } from '../auth/sign-out-button';
import { DashboardShell } from './dashboard-shell';
import { DeskContext } from './desk-context';
import { IdleSignOut } from './idle-sign-out';
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
 * The way into the practice dashboard (A04, M05): the API says whether this person is on the team of
 * the installation's practice and in which role, and only then does anything of the practice load.
 * Before that, the frame of the account pages: setting up the second factor, or no access.
 */
export function DashboardGate({
  practiceId,
  brand,
  children,
}: {
  readonly practiceId: string | undefined;
  readonly brand?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const t = useTranslations('auth.dashboard');
  useSessionChangeElsewhere();
  const membership = useGetMyMembership(practiceId ?? '', {
    query: { enabled: practiceId !== undefined, retry: false },
  });
  if (practiceId !== undefined && membership.data !== undefined) {
    const { role, providerId } = membership.data;
    return (
      <DeskContext.Provider value={{ practiceId, role, providerId }}>
        <DashboardShell brand={brand} role={role}>
          {children}
        </DashboardShell>
        <IdleSignOut
          onActive={() => {
            // Asks again whether this person is on the team, which also refreshes the session.
            void membership.refetch();
          }}
        />
      </DeskContext.Provider>
    );
  }
  return <AuthShell brand={brand}>{gateState()}</AuthShell>;

  function gateState(): ReactNode {
    if (practiceId === undefined) return <p className="text-body-default">{t('noPractice')}</p>;
    if (membership.isPending) return <Loading />;
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
}
