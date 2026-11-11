'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { useDesk } from './desk-context';
import { isPracticeQueryOf } from './setup-view';

/** A native field of the dashboard's forms, in the tokens of the Text Field of Figma. */
export const CONTROL =
  'min-h-touch-target rounded-md border border-border-strong bg-bg-surface px-3 text-body-default text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus aria-[invalid=true]:border-border-danger';

/** After a change of the practice's setup or schedule: every answer of the practice is read again. */
export function useInvalidatePractice(): () => Promise<void> {
  const { practiceId } = useDesk();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) => isPracticeQueryOf(practiceId, queryKey),
    });
}

/** Keys for the ranges an editor starts with; those added later count on in a ref. */
export function counter(prefix: string): () => string {
  let count = 0;
  return () => {
    count += 1;
    return `${prefix}-${String(count)}`;
  };
}

/** A time of the practice's wall clock, as the browser's own time field takes it. */
export function TimeInput({
  label,
  value,
  onChange,
  invalid = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid?: boolean;
}): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body-small text-text-secondary">
        {label}
      </label>
      <input
        id={id}
        type="time"
        step={300}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={CONTROL}
      />
    </div>
  );
}
