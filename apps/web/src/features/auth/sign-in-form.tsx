'use client';

import { useLogin } from '@medibooker/api-client';
import { LoginBody } from '@medibooker/api-client/zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import * as zod from 'zod';
import { LinkButton } from '@/components/ui/button';
import { announceSignIn } from '@/lib/session-broadcast';
import { useFragmentForLinks, useReturnPath } from './fragment';
import {
  AuthForm,
  EmailField,
  FormError,
  PageHeading,
  SecretField,
  SubmitButton,
  TEXT_LINK,
  useValidationError,
} from './form-parts';

// Only that it is there: whether a password follows today's rules says nothing about an old account.
const SCHEMA = LoginBody.pick({ email: true }).extend({ password: zod.string().min(1) });
type Values = zod.infer<typeof SCHEMA>;

/** Screen PW1. After signing in a person goes on where they came from, on this site. */
export function SignInForm(): ReactNode {
  const t = useTranslations('auth');
  const locale = useLocale();
  const returnPath = useReturnPath();
  const fragment = useFragmentForLinks();
  const error = useValidationError();
  const { control, handleSubmit } = useForm<Values>({
    resolver: zodResolver(SCHEMA, { error }),
    defaultValues: { email: '', password: '' },
  });
  const login = useLogin();
  const submit = handleSubmit((data) => {
    login.mutate(
      { data },
      {
        onSuccess: () => {
          announceSignIn();
          // A new document: a practice page's style carries the nonce of its own document.
          window.location.replace(returnPath ?? `/${locale}/appointments`);
        },
      },
    );
  });
  return (
    <>
      <PageHeading title={t('signIn.title')} body={t('signIn.body')} />
      <AuthForm onSubmit={submit}>
        <EmailField
          control={control}
          name="email"
          label={t('emailLabel')}
          autoComplete="username"
        />
        <div className="flex flex-col">
          <SecretField
            control={control}
            name="password"
            label={t('passwordLabel')}
            autoComplete="current-password"
          />
          <Link href={`/${locale}/forgot-password${fragment}`} className={`${TEXT_LINK} self-end`}>
            {t('signIn.forgot')}
          </Link>
        </div>
        <FormError error={login.error} />
        <SubmitButton pending={login.isPending}>{t('signIn.submit')}</SubmitButton>
      </AuthForm>
      <p className="mt-6 text-center text-body-small text-text-secondary">{t('signIn.newHere')}</p>
      <LinkButton variant="outline" href={`/${locale}/sign-up${fragment}`} className="mt-2 w-full">
        {t('signIn.createAccount')}
      </LinkButton>
    </>
  );
}
