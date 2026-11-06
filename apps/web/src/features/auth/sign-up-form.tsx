'use client';

import { isApiError, useLogin, useRegister } from '@medibooker/api-client';
import { RegisterBody } from '@medibooker/api-client/zod';
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import * as zod from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { useFragmentForLinks } from './fragment';
import {
  AuthForm,
  EmailField,
  FormError,
  PageHeading,
  SecretField,
  SubmitButton,
  TEXT_LINK,
  useFieldErrors,
  useFormReady,
  useValidationError,
} from './form-parts';
import { SignUpSteps } from './sign-up-steps';

const SCHEMA = RegisterBody.pick({ email: true, password: true }).extend({
  consent: zod.boolean().refine(Boolean),
});
type Values = zod.infer<typeof SCHEMA>;

const MIN_PASSWORD_LENGTH = 10;

/**
 * Screen 09. A sign-up runs without a break: the account is created and the person is signed in at
 * once (the user's decision, RT-89). When the sign-in fails, the address already had an account.
 */
export function SignUpForm(): ReactNode {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const fragment = useFragmentForLinks();
  const error = useValidationError();
  const { control, handleSubmit, setError } = useForm<Values>({
    resolver: zodResolver(SCHEMA, { error }),
    defaultValues: { email: '', password: '', consent: false },
  });
  const showFieldErrors = useFieldErrors(setError, ['email', 'password']);
  const signUp = useRegister();
  const login = useLogin();
  const [signInFailed, setSignInFailed] = useState(false);
  const ready = useFormReady();
  const pending = signUp.isPending || login.isPending;
  const submit = handleSubmit(({ email, password }) => {
    setSignInFailed(false);
    signUp.mutate(
      { data: { email, password, locale, privacyNoticeVersion: PRIVACY_NOTICE_VERSION } },
      {
        onError: showFieldErrors,
        onSuccess: () => {
          login.mutate(
            { data: { email, password } },
            {
              // Only this answer means another password; a limit or a failure says what it is.
              onError: (failure) => {
                setSignInFailed(isApiError(failure) && failure.status === 401);
              },
              onSuccess: () => {
                router.replace(`/${locale}/sign-up/details${fragment}`);
              },
            },
          );
        },
      },
    );
  });
  return (
    <>
      <SignUpSteps current="account" />
      <PageHeading title={t('signUp.title')} body={t('signUp.body')} />
      <AuthForm onSubmit={submit}>
        <EmailField
          control={control}
          name="email"
          label={t('emailLabel')}
          autoComplete="username"
        />
        <SecretField
          control={control}
          name="password"
          label={t('passwordLabel')}
          hint={t('passwordHint', { min: MIN_PASSWORD_LENGTH })}
          autoComplete="new-password"
        />
        <Controller
          control={control}
          name="consent"
          render={({ field, fieldState }) => (
            <Checkbox
              isReadOnly={!ready}
              name={field.name}
              isSelected={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              error={fieldState.error === undefined ? undefined : t('signUp.consentRequired')}
            >
              {t('signUp.consent')}
            </Checkbox>
          )}
        />
        {/* Beside the checkbox and not in its label: a link inside a label is a target inside one. */}
        <Link
          href={`/${locale}/privacy`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${TEXT_LINK} self-start`}
        >
          {t('signUp.readPrivacy')}
        </Link>
        {signInFailed ? (
          <Alert role="alert">
            <AlertDescription>
              {t('signUp.signInFailed')}{' '}
              <Link href={`/${locale}/forgot-password`} className="text-text-brand underline">
                {t('signUp.forgot')}
              </Link>
            </AlertDescription>
          </Alert>
        ) : (
          <FormError error={signUp.error ?? login.error} fields={['email', 'password']} />
        )}
        <SubmitButton pending={pending}>{t('signUp.submit')}</SubmitButton>
      </AuthForm>
      <p className="mt-4 flex flex-wrap items-center gap-x-2 text-body-small text-text-secondary">
        {t('signUp.haveAccount')}
        <Link href={`/${locale}/sign-in${fragment}`} className={TEXT_LINK}>
          {t('signUp.signIn')}
        </Link>
      </p>
    </>
  );
}
