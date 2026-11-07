'use client';

import {
  isApiError,
  useDeleteUnconfirmedAccount,
  useGetMe,
  useGetProfile,
} from '@medibooker/api-client';
import { isolateLtr } from '@medibooker/i18n';
import { CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { announceSignOut } from '@/lib/session-broadcast';
import { clearChoice } from '../portal/booking-choice';
import { FormError, PageHeading } from './form-parts';
import { ResendButton } from './resend-button';
import { SignOutButton, useSessionChangeElsewhere } from './sign-out-button';

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
        isPending={remove.isPending}
        className="bg-bg-danger text-text-on-danger data-[hovered]:bg-bg-danger-hover data-[pressed]:bg-bg-danger-hover"
        onPress={() => {
          remove.mutate(undefined, {
            onSuccess: () => {
              announceSignOut();
              clearChoice();
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

/** Who is signed in, and how to get out. */
export function AccountOverview(): ReactNode {
  const t = useTranslations('auth.account');
  const locale = useLocale();
  const me = useGetMe();
  useSessionChangeElsewhere();
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
      <LinkButton variant="outline" href={`/${locale}/appointments`} className="mb-2">
        {t('appointments')}
      </LinkButton>
      <SignOutButton className="mt-2" />
      {emailVerified ? null : <DeleteUnconfirmed />}
    </>
  );
}
