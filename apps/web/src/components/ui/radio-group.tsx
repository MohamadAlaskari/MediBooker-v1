'use client';

import type { ReactNode, Ref } from 'react';
import {
  FieldError,
  Label,
  RadioButton,
  RadioField,
  RadioGroup as RadioGroupPrimitive,
  type RadioGroupProps as RadioGroupPrimitiveProps,
} from 'react-aria-components';
import { cn } from '@/lib/utils';

interface RadioGroupProps extends Omit<RadioGroupPrimitiveProps, 'className' | 'children'> {
  readonly label: string;
  /** Translated, and shown as long as it is set. */
  readonly error?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string;
}

/** The Radio of Figma, on React Aria (ADR 0007). */
export function RadioGroup({
  label,
  error,
  children,
  className,
  ...props
}: RadioGroupProps): ReactNode {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      validationBehavior="aria"
      isInvalid={error !== undefined}
      className={cn('flex flex-col gap-1 text-start', className)}
      {...props}
    >
      <Label className="text-label-default text-text-primary">{label}</Label>
      {children}
      <FieldError className="text-body-small text-text-danger">{error}</FieldError>
    </RadioGroupPrimitive>
  );
}

interface RadioProps {
  readonly value: string;
  readonly children: ReactNode;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
}

export function Radio({ value, children, inputRef }: RadioProps): ReactNode {
  return (
    <RadioField value={value} inputRef={inputRef}>
      <RadioButton className="group flex min-h-touch-target cursor-default items-center gap-3 text-body-default text-text-primary">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-bg-surface group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-border-focus group-data-[selected]:border-border-brand"
        >
          <span className="hidden size-3 rounded-full bg-bg-brand group-data-[selected]:block" />
        </span>
        {children}
      </RadioButton>
    </RadioField>
  );
}
