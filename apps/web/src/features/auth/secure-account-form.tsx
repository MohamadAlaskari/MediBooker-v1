'use client';

import { isApiError, useSecureAccount } from '@medibooker/api-client';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useSyncExternalStore, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { FormError, PageHeading, TEXT_LINK } from './form-parts';

/** Whether this page load looked at its fragment, and the token it found there. */
let looked = false;
let captured: string | undefined;

/**
 * Reads the link's token once per page load and takes it out of the address bar and the history at
 * once: it works for a week (the review of A05). A fragment never reaches a server (03 §7).
 */
function lookOnce(onChange: () => void): () => void {
  if (!looked) {
    looked = true;
    captured = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? undefined;
    if (captured !== undefined) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    onChange();
  }
  return () => undefined;
}

function tokenOfThisLoad(): string | null | undefined {
  return looked ? (captured ?? null) : undefined;
}

function notYet(): undefined {
  return undefined;
}

/** The token; undefined while the page has not come to life, null without one. */
function useTokenOnce(): string | null | undefined {
  return useSyncExternalStore(lookOnce, tokenOfThisLoad, notYet);
}

/**
 * "This was not me" (E10, ADR 0004 §8): the page of the link in a security e-mail. One press ends
 * every sign-in of the account and stops its password; a link to choose a new one follows by e-mail.
 */
export function SecureAccountForm(): ReactNode {
  const t = useTranslations('auth.secureAccount');
  const locale = useLocale();
  const token = useTokenOnce();
  const secure = useSecureAccount();
  if (secure.isSuccess) {
    // The old password works nowhere now: the way on is a new one, also if the e-mail is late.
    return (
      <>
        <PageHeading title={t('doneTitle')} body={t('doneBody')} />
        <LinkButton href={`/${locale}/forgot-password`}>{t('newPassword')}</LinkButton>
      </>
    );
  }
  const linkGone = isApiError(secure.error) && secure.error.code === 'INVALID_TOKEN';
  if (token === null || linkGone) {
    return (
      <>
        <PageHeading title={t('noLinkTitle')} />
        <Alert>
          <AlertDescription>{t('noLinkBody')}</AlertDescription>
        </Alert>
        <Link href={`/${locale}/forgot-password`} className={`${TEXT_LINK} mt-4`}>
          {t('newPassword')}
        </Link>
      </>
    );
  }
  return (
    <>
      <PageHeading title={t('title')} body={t('body')} />
      <FormError error={secure.error} />
      <Button
        isPending={secure.isPending || token === undefined}
        onPress={() => {
          if (typeof token === 'string') secure.mutate({ data: { token } });
        }}
      >
        {t('submit')}
      </Button>
    </>
  );
}
