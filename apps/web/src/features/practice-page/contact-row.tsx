import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * One way to reach a practice, on its page (P03) and on the portal's home (PW2): an icon, what it
 * is, a note below, and a link where it leads somewhere.
 */
export function ContactRow({
  icon,
  title,
  note,
  href,
  external,
}: {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly note?: string;
  readonly href?: string;
  readonly external?: boolean;
}): ReactNode {
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-bg-subtle">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-default text-text-primary">{title}</span>
        {note === undefined ? null : (
          <span className="block text-body-small text-text-secondary">{note}</span>
        )}
      </span>
      {external === true ? (
        <ChevronRight aria-hidden className="size-5 shrink-0 text-icon-secondary rtl:rotate-180" />
      ) : null}
    </>
  );
  const layout = 'flex min-h-touch-target items-center gap-3 py-3';
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      {href === undefined ? (
        <div className={layout}>{content}</div>
      ) : (
        <a
          href={href}
          className={`${layout} hover:bg-bg-subtle`}
          {...(external === true ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {content}
        </a>
      )}
    </li>
  );
}
