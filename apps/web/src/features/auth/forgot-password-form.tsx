'use client';

import { useForgotPassword } from '@medibooker/api-client';
import { ForgotPasswordBody } from '@medibooker/api-client/zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type * as zod from 'zod';
import { useFragmentForLinks } from './fragment';
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
  const fragment = useFragmentForLinks();
  const error = useValidationError();
  const { control, handleSubmit } = useForm<Values>({
    resolver: zodResolver(ForgotPasswordBody, { error }),
    defaultValues: { email: '' },
  });
  const forgot = useForgotPassword();
  const submit = handleSubmit((data) => {
    forgot.mutate({ data });
  });
  // A new document: on its way back to a page it holds, Next writes the fragment twice, and a way
  // back in it is then no way back any more.
  const back = (
    <a href={`/${locale}/sign-in${fragment}`} className={`${TEXT_LINK} mt-4`}>
      {t('forgot.back')}
    </a>
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
