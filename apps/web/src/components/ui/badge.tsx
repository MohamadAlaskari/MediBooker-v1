import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** From `shadcn add badge`, adapted to the Figma component and the tokens (ADR 0007). */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-1 text-label-small whitespace-nowrap',
  {
    variants: {
      variant: {
        brand: 'bg-bg-brand text-text-on-brand',
        brandSubtle: 'bg-bg-brand-subtle text-text-brand',
        neutral: 'bg-bg-subtle text-text-secondary',
        success: 'bg-bg-success-subtle text-text-success',
        info: 'bg-bg-info-subtle text-text-info',
        warning: 'bg-bg-warning-subtle text-text-warning',
        danger: 'bg-bg-danger-subtle text-text-danger',
        outline: 'border border-border-brand bg-bg-surface text-text-brand',
      },
    },
    defaultVariants: { variant: 'brand' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>): ReactNode {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
