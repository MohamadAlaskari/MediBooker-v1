'use client';

import type { ReactNode } from 'react';
import { SwitchButton, SwitchField, type SwitchFieldProps } from 'react-aria-components';
import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<SwitchFieldProps, 'className' | 'children'> {
  /** The visible label; a screen reader says "on" or "off" with it. */
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The Switch of Figma on React Aria (ADR 0007): a track with a knob that moves to the end, also in
 * right-to-left, and a label that is part of a target of at least 44 px.
 */
export function Switch({ children, className, ...props }: SwitchProps): ReactNode {
  return (
    <SwitchField data-slot="switch" className={cn('flex flex-col', className)} {...props}>
      <SwitchButton className="group flex min-h-touch-target cursor-default items-center gap-3 text-start text-body-default text-text-primary data-[disabled]:opacity-60">
        <span
          aria-hidden
          className="flex h-6 w-10 shrink-0 items-center rounded-full border border-border-strong bg-bg-surface p-px transition-colors group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-border-focus group-data-[selected]:border-border-brand group-data-[selected]:bg-bg-brand motion-reduce:transition-none"
        >
          <span className="size-5 rounded-full bg-icon-secondary shadow-elevation-1 transition-transform group-data-[selected]:translate-x-4 group-data-[selected]:bg-icon-on-brand rtl:group-data-[selected]:-translate-x-4 motion-reduce:transition-none" />
        </span>
        <span className="min-w-0">{children}</span>
      </SwitchButton>
    </SwitchField>
  );
}
