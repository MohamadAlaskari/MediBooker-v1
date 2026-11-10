'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SignOutButton } from '../auth/sign-out-button';

/** Why the dashboard cannot go on for this sign-in, with the way out. */
export function Notice({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}): ReactNode {
  return (
    <>
      <Alert role="alert" className="mb-6 gap-2">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </Alert>
      <SignOutButton className="w-full" />
    </>
  );
}

/** An account outside the practice's team. */
export function NoAccess(): ReactNode {
  const t = useTranslations('auth.dashboard');
  return <Notice title={t('noAccessTitle')} body={t('noAccessBody')} />;
}
