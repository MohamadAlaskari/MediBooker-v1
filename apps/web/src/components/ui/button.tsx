'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode, RefAttributes } from 'react';
import {
  Button as ButtonPrimitive,
  Link as LinkPrimitive,
  type ButtonProps as ButtonPrimitiveProps,
  type LinkProps as LinkPrimitiveProps,
} from 'react-aria-components';
import { cn } from '@/lib/utils';

/**
 * From `shadcn add button`, adapted to the Figma component and the tokens (ADR 0007): targets of at
 * least 44 px, the type scale, the focus ring of `border/focus`. Never `outline-none` beside a ring:
 * in Tailwind 4 it sets `--tw-outline-style`, which `outline-2` reads, and the ring stays invisible.
 * A running request is `isPending`, which looks disabled and keeps the focus; `isDisabled` would drop
 * it to the page, so that one is for what cannot be pressed at all.
 */
export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent text-label-default whitespace-nowrap transition-colors select-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-border-focus data-[disabled]:pointer-events-none data-[disabled]:bg-bg-disabled data-[disabled]:text-text-disabled data-[pending]:cursor-progress data-[pending]:bg-bg-disabled data-[pending]:text-text-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          'bg-bg-brand text-text-on-brand data-[hovered]:bg-bg-brand-hover data-[pressed]:bg-bg-brand-pressed',
        outline: 'border-border-strong bg-bg-surface text-text-primary data-[hovered]:bg-bg-subtle',
        ghost: 'text-text-primary data-[hovered]:bg-bg-subtle',
      },
      size: {
        default: 'min-h-touch-target gap-2 px-4',
        icon: 'size-touch-target',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type Variants = VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  ...props
}: Omit<ButtonPrimitiveProps, 'className'> &
  RefAttributes<HTMLButtonElement> &
  Variants & { readonly className?: string }): ReactNode {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export function LinkButton({
  className,
  variant,
  size,
  ...props
}: Omit<LinkPrimitiveProps, 'className'> &
  RefAttributes<HTMLAnchorElement> &
  Variants & { readonly className?: string }): ReactNode {
  return (
    <LinkPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
