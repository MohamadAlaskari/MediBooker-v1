'use client';

import { useVerifyEmail } from '@medibooker/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import * as zod from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { useFragmentValue } from './fragment';
import {
  AuthForm,
  FormError,
  PageHeading,
  SecretField,
  SubmitButton,
  TEXT_LINK,
  useValidationError,
} from './form-parts';

const SCHEMA = zod.object({ password: zod.string().min(1) });
type Values = zod.infer<typeof SCHEMA>;

/** The page of the link in the e-mail: the mailbox and the password together confirm an address. */
export function VerifyEmailForm(): ReactNode {
  const t = useTranslations('auth');
  const locale = useLocale();
  const token = useFragmentValue('token');
  const error = useValidationError();
  const { control, handleSubmit } = useForm<Values>({
    resolver: zodResolver(SCHEMA, { error }),
    defaultValues: { password: '' },
  });
  const confirm = useVerifyEmail();
  const submit = handleSubmit(({ password }) => {
    if (token !== undefined) confirm.mutate({ data: { token, password } });
  });
  if (confirm.isSuccess) {
    return (
      <>
        <PageHeading title={t('verifyEmail.doneTitle')} body={t('verifyEmail.doneBody')} />
        <LinkButton href={`/${locale}/account`}>{t('verifyEmail.continue')}</LinkButton>
      </>
    );
  }
  if (token === undefined) {
    return (
      <>
        <PageHeading title={t('verifyEmail.noLinkTitle')} />
        <Alert>
          <AlertDescription>{t('verifyEmail.noLinkBody')}</AlertDescription>
        </Alert>
        <LinkButton variant="outline" href={`/${locale}/account`} className="mt-4">
          {t('verifyEmail.continue')}
        </LinkButton>
      </>
    );
  }
  return (
    <>
      <PageHeading title={t('verifyEmail.title')} body={t('verifyEmail.body')} />
      <AuthForm onSubmit={submit}>
        <SecretField
          control={control}
          name="password"
          label={t('passwordLabel')}
          autoComplete="current-password"
        />
        <FormError error={confirm.error} />
        <SubmitButton pending={confirm.isPending}>{t('verifyEmail.submit')}</SubmitButton>
      </AuthForm>
      {/* The way back for an owner whose address someone else signed up with. */}
      <Link href={`/${locale}/forgot-password`} className={`${TEXT_LINK} mt-4`}>
        {t('verifyEmail.forgot')}
      </Link>
    </>
  );
}
