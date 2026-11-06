'use client';

import { useForgotPassword } from '@medibooker/api-client';
import { ForgotPasswordBody } from '@medibooker/api-client/zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type * as zod from 'zod';
import {
  AuthForm,
  EmailField,
  FormError,
  PageHeading,
  SubmitButton,
  TEXT_LINK,
  useValidationError,
} from './form-parts';

type Values = zod.infer<typeof ForgotPasswordBody>;

/** Screen 13. The answer is the same whether the address has an account or not. */
export function ForgotPasswordForm(): ReactNode {
  const t = useTranslations('auth');
  const locale = useLocale();
  const error = useValidationError();
  const { control, handleSubmit } = useForm<Values>({
    resolver: zodResolver(ForgotPasswordBody, { error }),
    defaultValues: { email: '' },
  });
  const forgot = useForgotPassword();
  const submit = handleSubmit((data) => {
    forgot.mutate({ data });
  });
  const back = (
    <Link href={`/${locale}/sign-in`} className={`${TEXT_LINK} mt-4`}>
      {t('forgot.back')}
    </Link>
  );
  if (forgot.isSuccess) {
    return (
      <>
        <PageHeading title={t('forgot.doneTitle')} body={t('forgot.doneBody')} />
        {back}
      </>
    );
  }
  return (
    <>
      <PageHeading title={t('forgot.title')} body={t('forgot.body')} />
      <AuthForm onSubmit={submit}>
        <EmailField
          control={control}
          name="email"
          label={t('emailLabel')}
          autoComplete="username"
        />
        <FormError error={forgot.error} />
        <SubmitButton pending={forgot.isPending}>{t('forgot.submit')}</SubmitButton>
      </AuthForm>
      {back}
    </>
  );
}
