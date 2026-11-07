'use client';

import { isApiError } from '@medibooker/api-client';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type BaseSyntheticEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
  type UseFormSetError,
} from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PasswordField, TextField } from '@/components/ui/text-field';
import { validationMessageOf, type ValidationIssue } from '@/lib/validation-message';

function noChanges(): () => void {
  return () => undefined;
}

/**
 * Whether the page has come to life. Until then a field takes no input: React would drop it when it
 * takes over, and a person would see an empty field called missing after typing into it.
 */
export function useFormReady(): boolean {
  return useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );
}

/** What the resolver of a form says about a broken rule, in the language of the page. */
export function useValidationError(): (issue: ValidationIssue) => string {
  const t = useTranslations('validation');
  return (issue) => {
    const { key, values } = validationMessageOf(issue);
    return t(key, values);
  };
}

/**
 * Puts what the API says about single fields next to them (03 §12), and answers whether it could:
 * otherwise a form shows the error above its button.
 */
export function useFieldErrors<Values extends FieldValues>(
  setError: UseFormSetError<Values>,
  fields: readonly FieldPath<Values>[],
): (error: unknown) => void {
  const t = useTranslations('validation');
  return (error) => {
    if (!isApiError(error)) return;
    for (const { field, code, params } of error.fieldErrors) {
      const known = fields.find((name) => name === field);
      if (known === undefined) continue;
      const message = t.has(code as never) ? t(code as never, params as never) : t('INVALID_VALUE');
      setError(known, { type: 'server', message }, { shouldFocus: true });
    }
  };
}

interface FormErrorProps {
  readonly error: unknown;
  /** The fields of this form that show their own errors. */
  readonly fields?: readonly string[];
  /** Where a 404 means something else than a page that is not there. */
  readonly notFound?: string;
}

/** A failure of the whole form: in a live region, and only when no field of it already says so. */
export function FormError({ error, fields = [], notFound }: FormErrorProps): ReactNode {
  const t = useTranslations('errors');
  if (error === null || error === undefined) return null;
  if (isApiError(error) && error.fieldErrors.some(({ field }) => fields.includes(field))) {
    return null;
  }
  const code = isApiError(error) ? error.code : 'UNEXPECTED_RESPONSE';
  const params = isApiError(error) ? error.params : undefined;
  const text = t.has(code as never) ? t(code as never, params as never) : t('INTERNAL_ERROR');
  return (
    <Alert role="alert" className="bg-bg-danger-subtle">
      <AlertDescription className="text-text-danger">
        {code === 'NOT_FOUND' ? (notFound ?? text) : text}
      </AlertDescription>
    </Alert>
  );
}

interface BoundFieldProps<Values extends FieldValues> {
  readonly control: Control<Values>;
  readonly name: FieldPath<Values>;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly autoComplete: string;
}

export function EmailField<Values extends FieldValues>({
  control,
  name,
  label,
  autoComplete,
}: BoundFieldProps<Values>): ReactNode {
  const ready = useFormReady();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          isReadOnly={!ready}
          type="email"
          inputMode="email"
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

export function SecretField<Values extends FieldValues>({
  control,
  name,
  label,
  hint,
  autoComplete,
}: BoundFieldProps<Values>): ReactNode {
  const t = useTranslations('auth');
  const ready = useFormReady();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <PasswordField
          label={label}
          isReadOnly={!ready}
          hint={hint}
          autoComplete={autoComplete}
          showLabel={t('showPassword')}
          hideLabel={t('hidePassword')}
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

interface AuthFormProps {
  /** What `handleSubmit` of the form returns. */
  readonly onSubmit: (event: BaseSyntheticEvent) => Promise<void>;
  readonly children: ReactNode;
}

/** POST: should a browser ever send it by itself, no field ends up in a URL or a server log. */
export function AuthForm({ onSubmit, children }: AuthFormProps): ReactNode {
  return (
    <form
      method="post"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        // A waiting button is no submit button, and without one Enter in a single field still sends
        // the form: a token that works once would answer the second time with an error.
        if (event.currentTarget.querySelector('[data-pending]') !== null) {
          event.preventDefault();
          return;
        }
        void onSubmit(event);
      }}
    >
      {children}
    </form>
  );
}

interface SubmitButtonProps {
  readonly pending: boolean;
  readonly children: ReactNode;
}

/**
 * Disabled until the page has come to life: before that the browser would send the form itself,
 * passwords included, and neither a click nor the Enter key can do that with this button disabled.
 * A running request only makes it wait: disabled, it would drop the focus to the page.
 */
export function SubmitButton({ pending, children }: SubmitButtonProps): ReactNode {
  const ready = useFormReady();
  return (
    // Without a transition: a colour between disabled and enabled is readable by nobody.
    <Button type="submit" isPending={pending} isDisabled={!ready} className="transition-none">
      {children}
    </Button>
  );
}

/**
 * A step that replaces another on the same page: a screen reader should land on its heading, when it
 * mounts and whenever `enabled` turns true. The same for what takes the place of a button with the
 * focus, because the focus would otherwise drop to the page.
 */
export function useFocusOnArrival<Target extends HTMLElement = HTMLHeadingElement>(
  enabled = true,
): RefObject<Target | null> {
  const target = useRef<Target>(null);
  useEffect(() => {
    if (enabled) target.current?.focus();
  }, [enabled]);
  return target;
}

interface PageHeadingProps {
  readonly title: string;
  readonly body?: string;
  /** See useFocusOnArrival. Two steps need different keys, or React keeps one heading for both. */
  readonly focusOnArrival?: boolean;
}

export function PageHeading({ title, body, focusOnArrival = false }: PageHeadingProps): ReactNode {
  const heading = useFocusOnArrival(focusOnArrival);
  return (
    <header className="mb-6 text-start">
      {/* Only a script can focus it: the focus is shown by what is read out, not by a ring. */}
      {/* A practice's name can stand in it, longer than a phone is wide and in one word too. */}
      <h1
        ref={heading}
        tabIndex={focusOnArrival ? -1 : undefined}
        className="text-heading-h1 wrap-anywhere text-text-primary outline-none"
      >
        {title}
      </h1>
      {body === undefined ? null : (
        <p className="mt-2 text-body-default wrap-anywhere text-text-secondary">{body}</p>
      )}
    </header>
  );
}

export const TEXT_LINK =
  'inline-flex min-h-touch-target items-center text-label-default text-text-brand hover:underline';
