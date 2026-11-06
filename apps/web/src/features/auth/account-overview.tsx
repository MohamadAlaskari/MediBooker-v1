'use client';

import {
  isApiError,
  useDeleteUnconfirmedAccount,
  useGetMe,
  useGetProfile,
  useLogout,
} from '@medibooker/api-client';
import { isolateLtr } from '@medibooker/i18n';
import { CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { FormError, PageHeading } from './form-parts';
import { ResendButton } from './resend-button';
import { useSignInWhenOver } from './session-redirect';

/** What the account knows about a person, and the way to change it. */
function DetailsSummary(): ReactNode {
  const t = useTranslations('auth.account');
  const insurance = useTranslations('auth.details');
  const locale = useLocale();
  const profile = useGetProfile();
  const href = `/${locale}/account/details`;
  if (profile.isPending) return null;
  if (profile.data === undefined) {
    if (!isApiError(profile.error) || profile.error.status !== 404) {
      return <FormError error={profile.error} />;
    }
    return (
      <Alert className="mb-6 gap-2">
        <AlertTitle>{t('completeTitle')}</AlertTitle>
        <AlertDescription>{t('completeBody')}</AlertDescription>
        <LinkButton href={href}>{t('completeAction')}</LinkButton>
      </Alert>
    );
  }
  const { firstName, lastName, insuranceType } = profile.data;
  return (
    <section className="mb-6 flex flex-col gap-2">
      <h2 className="text-heading-h3 text-text-primary">{t('detailsTitle')}</h2>
      <p className="text-body-default text-text-secondary">
        <bdi>{`${firstName} ${lastName}`}</bdi>
      </p>
      <p className="text-body-default text-text-secondary">{insurance(insuranceType)}</p>
      <LinkButton variant="outline" href={href}>
        {t('changeDetails')}
      </LinkButton>
    </section>
  );
}

/** For who mistyped the address: asks once more, because this cannot be undone. */
function DeleteUnconfirmed(): ReactNode {
  const t = useTranslations('auth.account');
  const locale = useLocale();
  const [asking, setAsking] = useState(false);
  const remove = useDeleteUnconfirmedAccount();
  if (!asking) {
    return (
      <Button
        variant="ghost"
        className="mt-2 whitespace-normal text-text-danger"
        onPress={() => {
          setAsking(true);
        }}
      >
        {t('wrongAddress')}
      </Button>
    );
  }
  return (
    <Alert role="alert" className="mt-2 gap-2 bg-bg-danger-subtle">
      <AlertDescription>{t('wrongAddressBody')}</AlertDescription>
      <FormError error={remove.error} />
      <Button
        isDisabled={remove.isPending}
        className="bg-bg-danger text-text-on-danger data-[hovered]:bg-bg-danger-hover data-[pressed]:bg-bg-danger-hover"
        onPress={() => {
          remove.mutate(undefined, {
            onSuccess: () => {
              window.location.replace(`/${locale}/sign-up`);
            },
          });
        }}
      >
        {t('deleteAccount')}
      </Button>
      <Button
        variant="outline"
        onPress={() => {
          setAsking(false);
        }}
      >
        {t('keepAccount')}
      </Button>
    </Alert>
  );
}

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
      <DetailsSummary />
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
      {emailVerified ? null : <DeleteUnconfirmed />}
    </>
  );
}
