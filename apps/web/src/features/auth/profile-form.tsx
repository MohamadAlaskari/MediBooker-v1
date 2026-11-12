'use client';

import {
  getGetProfileQueryKey,
  isApiError,
  useGetProfile,
  useUpdateProfile,
} from '@medibooker/api-client';
import { UpdateProfileBody } from '@medibooker/api-client/zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldPath } from 'react-hook-form';
import * as zod from 'zod';
import { Button } from '@/components/ui/button';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { TextField } from '@/components/ui/text-field';
import {
  AuthForm,
  FormError,
  PageHeading,
  SubmitButton,
  useFieldErrors,
  useFormReady,
  useValidationError,
} from './form-parts';
import { useSessionChangeElsewhere } from './sign-out-button';
import { useWaitOut, WaitNote } from './wait-out';

export const INSURANCE_TYPES = ['PUBLIC', 'PRIVATE', 'SELF_PAY'] as const;
export type InsuranceType = (typeof INSURANCE_TYPES)[number];

/** What is known of a person already: from the account, or from a practice. */
interface KnownDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
  readonly phone: string | null;
  readonly insuranceType: InsuranceType;
  readonly insuranceProvider: string | null;
  readonly insuranceNumberEnd: string | null;
}

/** What a form hands over: what is left empty stays out, so that what is known stays. */
interface EnteredDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
  readonly insuranceType: InsuranceType;
  readonly phone?: string;
  readonly insuranceProvider?: string;
  readonly insuranceNumber?: string;
}

/** Where the entered details go. */
interface DetailsSaving {
  readonly send: (
    details: EnteredDetails,
    handlers: { readonly onError: (failure: unknown) => void; readonly onSuccess: () => void },
  ) => void;
  readonly isPending: boolean;
  readonly error: unknown;
}

/** The rules of the API, with the empty fields a form has where the API has none. */
const PERSON = UpdateProfileBody.pick({
  firstName: true,
  lastName: true,
  dateOfBirth: true,
}).extend({ phone: zod.union([zod.literal(''), UpdateProfileBody.shape.phone.unwrap()]) });
const MAX_PROVIDER_LENGTH = 100;
const INSURANCE = zod.object({
  insuranceType: UpdateProfileBody.shape.insuranceType,
  insuranceProvider: zod.string().max(MAX_PROVIDER_LENGTH),
  insuranceNumber: zod.union([zod.literal(''), UpdateProfileBody.shape.insuranceNumber.unwrap()]),
});
const SCHEMA = zod.object({ ...PERSON.shape, ...INSURANCE.shape });
type Values = zod.infer<typeof SCHEMA>;

const PERSON_FIELDS = ['firstName', 'lastName', 'dateOfBirth', 'phone'] as const;
const FIELDS = [...PERSON_FIELDS, 'insuranceType', 'insuranceProvider', 'insuranceNumber'] as const;

function valuesOf(known: KnownDetails | undefined, types: readonly InsuranceType[]): Values {
  const type = known?.insuranceType;
  return {
    firstName: known?.firstName ?? '',
    lastName: known?.lastName ?? '',
    dateOfBirth: known?.dateOfBirth ?? '',
    phone: known?.phone ?? '',
    insuranceType: type !== undefined && types.includes(type) ? type : (types[0] ?? 'PUBLIC'),
    insuranceProvider: known?.insuranceProvider ?? '',
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
  readonly maxLength?: number;
}

function DetailField({
  control,
  name,
  label,
  hint,
  type,
  autoComplete,
  maxLength,
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
          maxLength={maxLength}
        />
      )}
    />
  );
}

/** What a practice asks of each insurance type (BR-10): the form shows exactly that, nothing more. */
export interface PracticeAsks {
  readonly providerTypes: readonly string[];
  readonly numberTypes: readonly string[];
}

/** The heading of a step: the steps themselves say when it takes the focus. */
interface StepHeading {
  readonly title: string;
  readonly body?: string;
}

interface DetailsStepsProps {
  readonly known: KnownDetails | undefined;
  readonly personHeading: StepHeading;
  readonly insuranceHeading: StepHeading;
  /** A press brought the person here: the first heading takes the focus, too. */
  readonly focusOnArrival?: boolean;
  readonly submitLabel: string;
  readonly saving: DetailsSaving;
  /** The types to choose from: a practice takes its own. */
  readonly types?: readonly InsuranceType[];
  /** For a practice; left out, this is the account's form, which asks both of every insured type. */
  readonly asks?: PracticeAsks;
  /** What the hint says about a number known already. */
  readonly knownNumberHint?: (end: string) => string;
  /** Shown above the button of the last step, such as a consent. */
  readonly beforeSubmit?: ReactNode;
  /** Fields outside the form whose errors are shown elsewhere. */
  readonly otherFields?: readonly string[];
  readonly onSaved: () => void;
}

/**
 * Screens 10 and 11: two steps of one form, sent together, and nothing kept in the browser. The tokens
 * for autofill stay on names and phone, because WCAG 1.3.5 asks for them; what a shared browser keeps
 * is that browser's setting.
 */
export function DetailsSteps({
  known: details,
  personHeading,
  insuranceHeading,
  focusOnArrival = false,
  submitLabel,
  saving,
  types = INSURANCE_TYPES,
  asks,
  knownNumberHint,
  beforeSubmit,
  otherFields = [],
  onSaved,
}: DetailsStepsProps): ReactNode {
  const t = useTranslations('auth.details');
  const validation = useTranslations('validation');
  const error = useValidationError();
  const [step, setStep] = useState<'person' | 'insurance'>('person');
  const [focusHeading, setFocusHeading] = useState(focusOnArrival);
  const [wrongField, setWrongField] = useState<(typeof PERSON_FIELDS)[number]>();
  // The other step replaces what had the focus, and a screen reader would hear nothing of it.
  const goTo = (next: 'person' | 'insurance'): void => {
    setWrongField(undefined);
    setFocusHeading(true);
    setStep(next);
  };
  const { clearErrors, control, handleSubmit, setError, setFocus, setValue, trigger } =
    useForm<Values>({
      resolver: zodResolver(SCHEMA, { error }),
      defaultValues: valuesOf(details, types),
    });
  // What the API found wrong in the first step: its field takes the focus once that step is back (03 §12).
  useEffect(() => {
    if (step === 'person' && wrongField !== undefined) setFocus(wrongField);
  }, [step, wrongField, setFocus]);
  const showFieldErrors = useFieldErrors(setError, FIELDS);
  const chosenType = useWatch({ control, name: 'insuranceType' });
  const insured = chosenType !== 'SELF_PAY';
  const asksProvider = insured && (asks === undefined || asks.providerTypes.includes(chosenType));
  const asksNumber = insured && (asks === undefined || asks.numberTypes.includes(chosenType));
  // A number is copied only for the same type of insurance.
  const known = chosenType === details?.insuranceType ? details.insuranceNumberEnd : null;
  // Only what is on the page: an error about anything else must show above the button.
  const wait = useWaitOut(saving.error);
  const shownFields = [
    ...PERSON_FIELDS,
    'insuranceType',
    ...(asksProvider ? ['insuranceProvider'] : []),
    ...(asksNumber ? ['insuranceNumber'] : []),
    ...otherFields,
  ];
  const submit = handleSubmit(({ phone, insuranceProvider, insuranceNumber, ...required }) => {
    let missing = false;
    if (asksProvider && insuranceProvider === '') {
      setError('insuranceProvider', { message: validation('REQUIRED') }, { shouldFocus: true });
      missing = true;
    }
    if (asksNumber && insuranceNumber === '' && known === null) {
      setError('insuranceNumber', { message: validation('REQUIRED') }, { shouldFocus: !missing });
      missing = true;
    }
    if (missing) return;
    saving.send(
      {
        ...required,
        ...(phone === '' ? {} : { phone }),
        ...(asksProvider && insuranceProvider !== '' ? { insuranceProvider } : {}),
        ...(asksNumber && insuranceNumber !== '' ? { insuranceNumber } : {}),
      },
      {
        onError: (failure) => {
          showFieldErrors(failure);
          // What the API found wrong in the first step can only be mended there.
          const wrong = isApiError(failure) ? failure.fieldErrors.map(({ field }) => field) : [];
          const first = PERSON_FIELDS.find((field) => wrong.includes(field));
          if (first !== undefined) {
            setWrongField(first);
            setFocusHeading(false);
            setStep('person');
          }
        },
        onSuccess: onSaved,
      },
    );
  });
  // The keys: nothing of one step may stay for the other, least of all the submit button, on which a
  // second press would send the details from a step the person has not read.
  if (step === 'person') {
    return (
      <Fragment key="person">
        <PageHeading {...personHeading} focusOnArrival={focusHeading} />
        <AuthForm
          onSubmit={async (event) => {
            event.preventDefault();
            if (await trigger(PERSON_FIELDS, { shouldFocus: true })) goTo('insurance');
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
          <FormError error={saving.error} fields={shownFields} />
          <SubmitButton pending={false}>{t('continue')}</SubmitButton>
        </AuthForm>
      </Fragment>
    );
  }
  return (
    <Fragment key="insurance">
      <PageHeading {...insuranceHeading} focusOnArrival={focusHeading} />
      <AuthForm onSubmit={submit}>
        <Controller
          control={control}
          name="insuranceType"
          render={({ field, fieldState }) => (
            <RadioGroup
              label={t('insuranceType')}
              name={field.name}
              value={field.value}
              onChange={(type) => {
                field.onChange(type);
                // A number belongs to one type. Half typed in a field that goes hidden now, it would
                // stop the form without a word, because its error has no field left to show on.
                setValue('insuranceNumber', '');
                clearErrors('insuranceNumber');
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            >
              {types.map((type) => (
                <Radio key={type} value={type}>
                  {t(type)}
                </Radio>
              ))}
            </RadioGroup>
          )}
        />
        {asksProvider ? (
          <DetailField
            control={control}
            name="insuranceProvider"
            label={t('insuranceProvider')}
            autoComplete="off"
            // Too long and then hidden by another type, it would stop the form without a word.
            maxLength={MAX_PROVIDER_LENGTH}
          />
        ) : null}
        {asksNumber ? (
          <DetailField
            control={control}
            name="insuranceNumber"
            label={t('insuranceNumber')}
            hint={
              known === null
                ? t('insuranceNumberHint')
                : (knownNumberHint?.(known) ?? t('insuranceNumberKnown', { end: known }))
            }
            autoComplete="off"
          />
        ) : null}
        {beforeSubmit}
        <FormError error={saving.error} fields={shownFields} />
        <SubmitButton pending={saving.isPending || wait !== undefined}>{submitLabel}</SubmitButton>
        <WaitNote seconds={wait} />
        <Button
          variant="ghost"
          onPress={() => {
            goTo('person');
          }}
        >
          {t('back')}
        </Button>
      </AuthForm>
    </Fragment>
  );
}

interface ProfileFormProps {
  readonly personHeading: StepHeading;
  readonly insuranceHeading: StepHeading;
  readonly submitLabel: string;
  readonly onSaved: () => void;
}

/** The account's details. Waits for what is known: a form that started empty would overwrite it. */
export function ProfileForm({ onSaved, ...props }: ProfileFormProps): ReactNode {
  const t = useTranslations('auth.account');
  const queryClient = useQueryClient();
  const profile = useGetProfile();
  const update = useUpdateProfile();
  useSessionChangeElsewhere();
  const notEntered = isApiError(profile.error) && profile.error.status === 404;
  if (profile.isPending) {
    return (
      <p role="status" className="text-body-default text-text-secondary">
        {t('loading')}
      </p>
    );
  }
  // Only when there is nothing to show: a failed look for changes must not take away what was typed.
  if (profile.data === undefined && !notEntered) return <FormError error={profile.error} />;
  return (
    <DetailsSteps
      known={profile.data}
      saving={{
        send: (data, { onError, onSuccess }) => {
          update.mutate(
            { data },
            {
              onError,
              onSuccess: (saved) => {
                queryClient.setQueryData(getGetProfileQueryKey(), saved);
                onSuccess();
              },
            },
          );
        },
        isPending: update.isPending,
        error: update.error,
      }}
      onSaved={onSaved}
      {...props}
    />
  );
}
