'use client';

import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Button as ButtonPrimitive,
  composeRenderProps,
  ListBox as ListBoxPrimitive,
  ListBoxItem as ListBoxItemPrimitive,
  Popover as PopoverPrimitive,
  Select as SelectPrimitive,
  SelectValue as SelectValuePrimitive,
  type ListBoxItemProps,
  type SelectProps,
} from 'react-aria-components';
import { cn } from '@/lib/utils';

/**
 * From `shadcn add select`, reduced to what is used and adapted to the Figma Text Field and the
 * tokens (ADR 0007): a target of at least 44 px, the type scale, the focus ring of `border/focus`.
 */
export function Select<T extends object>({
  className,
  ...props
}: Omit<SelectProps<T>, 'className'> & { readonly className?: string }): ReactNode {
  return (
    <SelectPrimitive data-slot="select" className={cn('w-full min-w-0', className)} {...props} />
  );
}

export function SelectTrigger({ className }: { readonly className?: string }): ReactNode {
  return (
    <ButtonPrimitive
      data-slot="select-trigger"
      className={cn(
        'flex min-h-touch-target w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-bg-surface px-3 text-start text-body-default text-text-primary outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-border-focus data-[hovered]:bg-bg-subtle',
        className,
      )}
    >
      <SelectValuePrimitive data-slot="select-value" className="min-w-0 flex-1 truncate" />
      <ChevronDownIcon aria-hidden className="pointer-events-none size-5 text-icon-secondary" />
    </ButtonPrimitive>
  );
}

export function SelectContent({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <PopoverPrimitive
      data-slot="select-content"
      offset={4}
      className="z-50 w-(--trigger-width) overflow-auto rounded-md border border-border-default bg-bg-surface shadow-elevation-2"
    >
      <ListBoxPrimitive data-slot="select-list" className="outline-none">
        {children}
      </ListBoxPrimitive>
    </PopoverPrimitive>
  );
}

export function SelectItem({ children, ...props }: ListBoxItemProps): ReactNode {
  return (
    <ListBoxItemPrimitive
      data-slot="select-item"
      className="flex min-h-touch-target cursor-default items-center gap-2 px-3 text-body-default text-text-primary outline-none select-none data-[focused]:bg-bg-subtle data-[selected]:text-text-brand"
      {...props}
    >
      {composeRenderProps(children, (content, { isSelected }) => (
        <>
          <span className="min-w-0 flex-1">{content}</span>
          {isSelected ? <CheckIcon aria-hidden className="size-5 shrink-0" /> : null}
        </>
      ))}
    </ListBoxItemPrimitive>
  );
}
