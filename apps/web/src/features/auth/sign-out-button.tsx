'use client';

import { useLogout } from '@medibooker/api-client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { announceSignOut, onSessionChangeElsewhere } from '@/lib/session-broadcast';
import { FormError } from './form-parts';

/**
 * A signing-out or signing-in in another tab ends this page too: a new document keeps nothing of the
 * person. After a signing-in the cookies may be someone else's, so what is on this page would go out
 * under that person's name; the new document reads as whoever it is now.
 */
export function useSessionChangeElsewhere(): void {
  const locale = useLocale();
  useEffect(
    () =>
      onSessionChangeElsewhere((change) => {
        if (change === 'signed-out') window.location.replace(`/${locale}/sign-in`);
        else window.location.reload();
      }),
    [locale],
  );
}

/** Ends the session here and in the other tabs. */
export function SignOutButton({ className }: { readonly className?: string }): ReactNode {
  const t = useTranslations('auth.account');
  const locale = useLocale();
  const logout = useLogout();
  return (
    <>
      <FormError error={logout.error} />
      <Button
        variant="outline"
        {...(className === undefined ? {} : { className })}
        isPending={logout.isPending}
        onPress={() => {
          logout.mutate(
            { data: {} },
            {
              onSuccess: () => {
                announceSignOut();
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
