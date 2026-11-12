'use client';

import { isApiError, useLogin } from '@medibooker/api-client';
import { LoginBody } from '@medibooker/api-client/zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import * as zod from 'zod';
import { Button, LinkButton } from '@/components/ui/button';
import { announceSignIn } from '@/lib/session-broadcast';
import { useFragmentForLinks, useReturnPath } from './fragment';
import {
  AuthForm,
  CodeField,
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
const CODE_SCHEMA = zod.object({ code: zod.string().trim().min(1) });
type CodeValues = zod.infer<typeof CODE_SCHEMA>;

/** What the second step sends with the password: the code of the app or a recovery code. */
type Factor = 'code' | 'recovery';

interface SecondStepProps {
  readonly credentials: Values;
  readonly onBack: () => void;
  readonly onSignedIn: () => void;
}

/**
 * Screen W4, for an account with a second factor: the password stays in memory for this one
 * request, and the API opens no session before both are right.
 */
function SecondStep({ credentials, onBack, onSignedIn }: SecondStepProps): ReactNode {
  const t = useTranslations('auth.signIn');
  const error = useValidationError();
  const [factor, setFactor] = useState<Factor>('code');
  const { control, handleSubmit, reset } = useForm<CodeValues>({
    resolver: zodResolver(CODE_SCHEMA, { error }),
    defaultValues: { code: '' },
  });
  const login = useLogin();
  const submit = handleSubmit(({ code }) => {
    const second = factor === 'code' ? { code } : { recoveryCode: code };
    login.mutate({ data: { ...credentials, ...second } }, { onSuccess: onSignedIn });
  });
  const other: Factor = factor === 'code' ? 'recovery' : 'code';
  return (
    <>
      <PageHeading
        key={factor}
        title={t('codeTitle')}
        body={factor === 'code' ? t('codeBody') : t('recoveryBody')}
        focusOnArrival
      />
      <AuthForm onSubmit={submit}>
        <CodeField
          control={control}
          name="code"
          kind={factor}
          label={factor === 'code' ? t('codeLabel') : t('recoveryLabel')}
        />
        <FormError error={login.error} />
        <SubmitButton pending={login.isPending}>{t('verify')}</SubmitButton>
      </AuthForm>
      <Button
        variant="ghost"
        className="mt-2 w-full whitespace-normal"
        onPress={() => {
          reset();
          login.reset();
          setFactor(other);
        }}
      >
        {other === 'recovery' ? t('useRecovery') : t('useCode')}
      </Button>
      <Button variant="ghost" className="mt-2 w-full" onPress={onBack}>
        {t('back')}
      </Button>
    </>
  );
}

/** Screen PW1 and W3. After signing in a person goes on where they came from, on this site. */
export function SignInForm(): ReactNode {
  const t = useTranslations('auth');
  const locale = useLocale();
  const returnPath = useReturnPath();
  const fragment = useFragmentForLinks();
  const error = useValidationError();
  const { control, handleSubmit, getValues } = useForm<Values>({
    resolver: zodResolver(SCHEMA, { error }),
    defaultValues: { email: '', password: '' },
  });
  const [secondStep, setSecondStep] = useState(false);
  const login = useLogin();
  const signedIn = (): void => {
    announceSignIn();
    // A new document: a practice page's style carries the nonce of its own document.
    window.location.replace(returnPath ?? `/${locale}/home`);
  };
  const submit = handleSubmit((data) => {
    login.mutate(
      { data },
      {
        onSuccess: signedIn,
        onError: (failure) => {
          if (isApiError(failure, 'MFA_CODE_REQUIRED')) setSecondStep(true);
        },
      },
    );
  });
  if (secondStep) {
    return (
      <SecondStep
        credentials={getValues()}
        onSignedIn={signedIn}
        onBack={() => {
          login.reset();
          setSecondStep(false);
        }}
      />
    );
  }
  const shownError = isApiError(login.error, 'MFA_CODE_REQUIRED') ? null : login.error;
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
        <FormError error={shownError} />
        <SubmitButton pending={login.isPending}>{t('signIn.submit')}</SubmitButton>
      </AuthForm>
      <p className="mt-6 text-center text-body-small text-text-secondary">{t('signIn.newHere')}</p>
      <LinkButton variant="outline" href={`/${locale}/sign-up${fragment}`} className="mt-2 w-full">
        {t('signIn.createAccount')}
      </LinkButton>
    </>
  );
}
