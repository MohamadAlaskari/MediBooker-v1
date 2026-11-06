'use client';

import { Check } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import {
  CheckboxButton,
  CheckboxField,
  FieldError,
  type CheckboxFieldProps,
} from 'react-aria-components';
import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<CheckboxFieldProps, 'className' | 'children'> {
  readonly children: ReactNode;
  /** Translated, and shown as long as it is set. */
  readonly error?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
  readonly className?: string;
}

/** The Checkbox of Figma, on React Aria (ADR 0007): the whole label is a target of at least 44 px. */
export function Checkbox({
  children,
  error,
  inputRef,
  className,
  ...props
}: CheckboxProps): ReactNode {
  return (
    <CheckboxField
      data-slot="checkbox"
      inputRef={inputRef}
      validationBehavior="aria"
      isInvalid={error !== undefined}
      className={cn('flex flex-col gap-1', className)}
      {...props}
    >
      <CheckboxButton className="group flex min-h-touch-target cursor-default items-center gap-3 text-start text-body-default text-text-primary">
        {({ isSelected }) => (
          <>
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-bg-surface group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-border-focus group-data-[invalid]:border-border-danger group-data-[selected]:border-border-brand group-data-[selected]:bg-bg-brand"
            >
              {isSelected ? <Check className="size-4 text-icon-on-brand" /> : null}
            </span>
            <span className="min-w-0">{children}</span>
          </>
        )}
      </CheckboxButton>
      <FieldError className="text-body-small text-text-danger">{error}</FieldError>
    </CheckboxField>
  );
}
