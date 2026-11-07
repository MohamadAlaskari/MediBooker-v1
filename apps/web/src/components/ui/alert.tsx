import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * From `shadcn add alert`, adapted to the tokens (ADR 0007). `note` by default: a screen reader
 * interrupts for `role="alert"`, which only something that just went wrong deserves.
 */
export function Alert({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      data-slot="alert"
      role="note"
      className={cn('grid w-full gap-1 rounded-md bg-bg-info-subtle p-3 text-start', className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      data-slot="alert-title"
      className={cn('text-label-default text-text-info', className)}
      {...props}
    />
  );
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-body-small wrap-anywhere text-text-secondary', className)}
      {...props}
    />
  );
}
