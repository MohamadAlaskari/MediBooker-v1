'use client';

import {
  getGetProfileQueryKey,
  isApiError,
  useGetProfile,
  useUpdateProfile,
  type ProfileDto,
} from '@medibooker/api-client';
import { UpdateProfileBody } from '@medibooker/api-client/zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldPath } from 'react-hook-form';
import * as zod from 'zod';
import { Button } from '@/components/ui/button';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { TextField } from '@/components/ui/text-field';
import {
  AuthForm,
  FormError,
  SubmitButton,
  useFieldErrors,
  useFormReady,
  useValidationError,
} from './form-parts';
import { useSignInWhenOver } from './session-redirect';

const INSURANCE_TYPES = ['PUBLIC', 'PRIVATE', 'SELF_PAY'] as const;

/** The rules of the API, with the empty fields a form has where the API has none. */
const PERSON = UpdateProfileBody.pick({
  firstName: true,
  lastName: true,
  dateOfBirth: true,
}).extend({ phone: zod.union([zod.literal(''), UpdateProfileBody.shape.phone.unwrap()]) });
const INSURANCE = zod.object({
  insuranceType: UpdateProfileBody.shape.insuranceType,
  insuranceProvider: zod.string().max(100),
  insuranceNumber: zod.union([zod.literal(''), UpdateProfileBody.shape.insuranceNumber.unwrap()]),
});
const SCHEMA = zod.object({ ...PERSON.shape, ...INSURANCE.shape });
type Values = zod.infer<typeof SCHEMA>;

const PERSON_FIELDS = ['firstName', 'lastName', 'dateOfBirth', 'phone'] as const;
const FIELDS = [...PERSON_FIELDS, 'insuranceType', 'insuranceProvider', 'insuranceNumber'] as const;

function valuesOf(profile: ProfileDto | undefined): Values {
  return {
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    dateOfBirth: profile?.dateOfBirth ?? '',
    phone: profile?.phone ?? '',
    insuranceType: profile?.insuranceType ?? 'PUBLIC',
    insuranceProvider: profile?.insuranceProvider ?? '',
    insuranceNumber: '',
  };
}

interface DetailFieldProps {
  readonly control: Control<Values>;
  readonly name: Exclude<FieldPath<Values>, 'insuranceType'>;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly type?: 'text' | 'date' | 'tel';
  readonly autoComplete: string;
}

function DetailField({
  control,
  name,
  label,
  hint,
  type,
  autoComplete,
}: DetailFieldProps): ReactNode {
  const ready = useFormReady();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          hint={hint}
          type={type}
          isReadOnly={!ready}
          autoComplete={autoComplete}
          name={field.name}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          inputRef={field.ref}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}

interface ProfileStepsProps {
  readonly profile: ProfileDto | undefined;
  readonly personHeading: ReactNode;
  readonly insuranceHeading: ReactNode;
  readonly submitLabel: string;
  readonly onSaved: () => void;
}

/** Screens 10 and 11: two steps of one form, sent together, and nothing kept in the browser. */
function ProfileSteps({
  profile,
  personHeading,
  insuranceHeading,
  submitLabel,
  onSaved,
}: ProfileStepsProps): ReactNode {
  const t = useTranslations('auth.details');
  const validation = useTranslations('validation');
  const error = useValidationError();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'person' | 'insurance'>('person');
  const { control, handleSubmit, setError, trigger } = useForm<Values>({
    resolver: zodResolver(SCHEMA, { error }),
    defaultValues: valuesOf(profile),
  });
  const showFieldErrors = useFieldErrors(setError, FIELDS);
  const save = useUpdateProfile();
  const insured = useWatch({ control, name: 'insuranceType' }) !== 'SELF_PAY';
  const known = profile?.insuranceNumberEnd ?? null;
  const submit = handleSubmit(({ phone, insuranceProvider, insuranceNumber, ...required }) => {
    let missing = false;
    if (insured && insuranceProvider === '') {
      setError('insuranceProvider', { message: validation('REQUIRED') }, { shouldFocus: true });
      missing = true;
    }
    if (insured && insuranceNumber === '' && known === null) {
      setError('insuranceNumber', { message: validation('REQUIRED') }, { shouldFocus: !missing });
      missing = true;
    }
    if (missing) return;
    save.mutate(
      {
        data: {
          ...required,
          ...(phone === '' ? {} : { phone }),
          ...(insured ? { insuranceProvider } : {}),
          ...(insured && insuranceNumber !== '' ? { insuranceNumber } : {}),
        },
      },
      {
        onError: (failure) => {
          showFieldErrors(failure);
          // What the API found wrong in the first step can only be mended there.
          const wrong = isApiError(failure) ? failure.fieldErrors.map(({ field }) => field) : [];
          if (PERSON_FIELDS.some((field) => wrong.includes(field))) setStep('person');
        },
        onSuccess: (saved) => {
          queryClient.setQueryData(getGetProfileQueryKey(), saved);
          onSaved();
        },
      },
    );
  });
  if (step === 'person') {
    return (
      <>
        {personHeading}
        <AuthForm
          onSubmit={async (event) => {
            event.preventDefault();
            if (await trigger(PERSON_FIELDS, { shouldFocus: true })) setStep('insurance');
          }}
        >
          <DetailField
            control={control}
            name="firstName"
            label={t('firstName')}
            autoComplete="given-name"
          />
          <DetailField
            control={control}
            name="lastName"
            label={t('lastName')}
            autoComplete="family-name"
          />
          <DetailField
            control={control}
            name="dateOfBirth"
            label={t('dateOfBirth')}
            type="date"
            autoComplete="bday"
          />
          <DetailField
            control={control}
            name="phone"
            label={t('phone')}
            type="tel"
            autoComplete="tel"
          />
          <FormError error={save.error} fields={FIELDS} />
          <SubmitButton pending={false}>{t('continue')}</SubmitButton>
        </AuthForm>
      </>
    );
  }
  return (
    <>
      {insuranceHeading}
      <AuthForm onSubmit={submit}>
        <Controller
          control={control}
          name="insuranceType"
          render={({ field, fieldState }) => (
            <RadioGroup
              label={t('insuranceType')}
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            >
              {INSURANCE_TYPES.map((type) => (
                <Radio key={type} value={type}>
                  {t(type)}
                </Radio>
              ))}
            </RadioGroup>
          )}
        />
        {insured ? (
          <>
            <DetailField
              control={control}
              name="insuranceProvider"
              label={t('insuranceProvider')}
              autoComplete="off"
            />
            <DetailField
              control={control}
              name="insuranceNumber"
              label={t('insuranceNumber')}
              hint={
                known === null
                  ? t('insuranceNumberHint')
                  : t('insuranceNumberKnown', { end: known })
              }
              autoComplete="off"
            />
          </>
        ) : null}
        <FormError error={save.error} fields={FIELDS} />
        <SubmitButton pending={save.isPending}>{submitLabel}</SubmitButton>
        <Button
          variant="ghost"
          onPress={() => {
            setStep('person');
          }}
        >
          {t('back')}
        </Button>
      </AuthForm>
    </>
  );
}

interface ProfileFormProps {
  /** Where this page is, for coming back after a sign-in. */
  readonly path: string;
  readonly personHeading: ReactNode;
  readonly insuranceHeading: ReactNode;
  readonly submitLabel: string;
  readonly onSaved: () => void;
}

/** Waits for what is known already: a form that started empty would overwrite it. */
export function ProfileForm({ path, ...props }: ProfileFormProps): ReactNode {
  const t = useTranslations('auth.account');
  const profile = useGetProfile();
  useSignInWhenOver(profile.error, path);
  const notEntered = isApiError(profile.error) && profile.error.status === 404;
  if (profile.isPending) {
    return (
      <p role="status" className="text-body-default text-text-secondary">
        {t('loading')}
      </p>
    );
  }
  if (profile.error !== null && !notEntered) return <FormError error={profile.error} />;
  return <ProfileSteps profile={profile.data} {...props} />;
}
