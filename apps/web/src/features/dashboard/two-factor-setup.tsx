'use client';

import { isApiError, useConfirmTotp, useStartTotp } from '@medibooker/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import * as zod from 'zod';
import { Button } from '@/components/ui/button';
import {
  AuthForm,
  CodeField,
  FormError,
  PageHeading,
  SubmitButton,
  useValidationError,
} from '../auth/form-parts';
import { NoAccess } from './notice';
import { QrCode } from './qr-code';

const CODE_SCHEMA = zod.object({ code: zod.string().trim().min(1) });
type CodeValues = zod.infer<typeof CODE_SCHEMA>;

/** A long key in groups of four, as people copy it into an app. */
function grouped(secret: string): string {
  return secret.replaceAll(/(.{4})(?=.)/g, '$1 ');
}

/** Shown once: the codes exist nowhere else, the API keeps only their hashes. */
function RecoveryCodes({
  codes,
  onDone,
}: {
  readonly codes: readonly string[];
  readonly onDone: () => void;
}): ReactNode {
  const t = useTranslations('auth.twoFactor');
  return (
    <>
      <PageHeading title={t('recoveryTitle')} body={t('recoveryBody')} focusOnArrival />
      <ul
        aria-label={t('recoveryList')}
        dir="ltr"
        className="mb-6 grid grid-cols-2 gap-2 rounded-md bg-bg-subtle p-4 text-body-default text-text-primary"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button className="w-full" onPress={onDone}>
        {t('done')}
      </Button>
    </>
  );
}

/**
 * Screen W4 when a person has no second factor yet: the secret as a QR code and as text, a first
 * code to prove the app has it, then the recovery codes. The answer of the confirmation carries a
 * session with both factors, in new cookies.
 */
export function TwoFactorSetup({ onEnabled }: { readonly onEnabled: () => void }): ReactNode {
  const t = useTranslations('auth.twoFactor');
  const error = useValidationError();
  const start = useStartTotp();
  const confirm = useConfirmTotp();
  const [codes, setCodes] = useState<readonly string[] | undefined>(undefined);
  const { control, handleSubmit } = useForm<CodeValues>({
    resolver: zodResolver(CODE_SCHEMA, { error }),
    defaultValues: { code: '' },
  });
  const submit = handleSubmit(({ code }) => {
    confirm.mutate(
      { data: { code } },
      {
        onSuccess: ({ recoveryCodes }) => {
          setCodes(recoveryCodes);
        },
      },
    );
  });
  if (codes !== undefined) return <RecoveryCodes codes={codes} onDone={onEnabled} />;
  // Only the team sets up the app: the dashboard asks for it before it can tell.
  if (isApiError(start.error, 'FORBIDDEN')) return <NoAccess />;
  if (start.data === undefined) {
    return (
      <>
        <PageHeading title={t('title')} body={t('body')} />
        <FormError error={start.error} />
        <Button
          className="w-full"
          isPending={start.isPending}
          onPress={() => {
            start.mutate();
          }}
        >
          {t('start')}
        </Button>
      </>
    );
  }
  const { otpauthUri, secret } = start.data;
  return (
    <>
      <PageHeading title={t('title')} body={t('scan')} focusOnArrival />
      <div className="mb-6 flex flex-col items-center gap-3">
        <QrCode text={otpauthUri} label={t('qrLabel')} />
        <p className="text-body-small text-text-secondary">{t('manual')}</p>
        <p dir="ltr" className="text-body-default break-all text-text-primary select-all">
          {grouped(secret)}
        </p>
      </div>
      <AuthForm onSubmit={submit}>
        <CodeField control={control} name="code" kind="code" label={t('confirmLabel')} />
        <FormError error={confirm.error} />
        <SubmitButton pending={confirm.isPending}>{t('confirm')}</SubmitButton>
      </AuthForm>
    </>
  );
}
