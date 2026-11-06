'use client';

import { useResetPassword } from '@medibooker/api-client';
import { ResetPasswordBody } from '@medibooker/api-client/zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type * as zod from 'zod';
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
  useFieldErrors,
  useValidationError,
} from './form-parts';

const SCHEMA = ResetPasswordBody.pick({ password: true });
type Values = zod.infer<typeof SCHEMA>;

const MIN_PASSWORD_LENGTH = 10;

/** The page of the link in the e-mail. A new password ends every session of the account. */
export function ResetPasswordForm(): ReactNode {
  const t = useTranslations('auth');
  const locale = useLocale();
  const token = useFragmentValue('token');
  const error = useValidationError();
  const { control, handleSubmit, setError } = useForm<Values>({
    resolver: zodResolver(SCHEMA, { error }),
    defaultValues: { password: '' },
  });
  const showFieldErrors = useFieldErrors(setError, ['password']);
  const reset = useResetPassword();
  const submit = handleSubmit(({ password }) => {
    if (token !== undefined) {
      reset.mutate({ data: { token, password } }, { onError: showFieldErrors });
    }
  });
  if (reset.isSuccess) {
    return (
      <>
        <PageHeading title={t('reset.doneTitle')} body={t('reset.doneBody')} />
        <LinkButton href={`/${locale}/sign-in`}>{t('reset.signIn')}</LinkButton>
      </>
    );
  }
  if (token === undefined) {
    return (
      <>
        <PageHeading title={t('reset.noLinkTitle')} />
        <Alert>
          <AlertDescription>{t('reset.noLinkBody')}</AlertDescription>
        </Alert>
        <Link href={`/${locale}/forgot-password`} className={`${TEXT_LINK} mt-4`}>
          {t('reset.requestNew')}
        </Link>
      </>
    );
  }
  return (
    <>
      <PageHeading title={t('reset.title')} body={t('reset.body')} />
      <AuthForm onSubmit={submit}>
        <SecretField
          control={control}
          name="password"
          label={t('newPasswordLabel')}
          hint={t('passwordHint', { min: MIN_PASSWORD_LENGTH })}
          autoComplete="new-password"
        />
        <FormError error={reset.error} fields={['password']} />
        <SubmitButton pending={reset.isPending}>{t('reset.submit')}</SubmitButton>
      </AuthForm>
      <Link href={`/${locale}/forgot-password`} className={`${TEXT_LINK} mt-4`}>
        {t('reset.requestNew')}
      </Link>
    </>
  );
}
