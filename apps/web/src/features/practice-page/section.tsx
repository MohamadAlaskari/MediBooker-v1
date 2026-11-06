import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';

interface PageSectionProps {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/** One band of the page: its width, its spacing and its heading (PW13). */
export function PageSection({
  id,
  title,
  subtitle,
  className,
  children,
}: PageSectionProps): ReactNode {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('scroll-mt-16 py-12', className)}>
      <Reveal>
        <div className="mx-auto max-w-page px-4">
          <h2 id={headingId} className="text-heading-h2 text-text-primary">
            {title}
          </h2>
          {subtitle === undefined ? null : (
            <p className="mt-2 text-body-default text-text-secondary">{subtitle}</p>
          )}
          <div className="mt-6">{children}</div>
        </div>
      </Reveal>
    </section>
  );
}

/** The surface of a card: every card of the page looks the same. */
export const CARD_CLASS = 'rounded-lg border border-border-default bg-bg-surface p-4';
