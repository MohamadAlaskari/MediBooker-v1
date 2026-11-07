'use client';

import type { ReactNode } from 'react';

/**
 * The first stop of the keyboard. A fragment with a value holds a way back or a token, which a jump to
 * `#main` would wipe: then only the focus moves. Otherwise it is a plain link, for no JavaScript too.
 */
export function SkipLink({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <a
      href="#main"
      onClick={(event) => {
        if (!window.location.hash.includes('=')) return;
        event.preventDefault();
        document.getElementById('main')?.focus();
      }}
      className="sr-only rounded-md bg-bg-surface text-label-default text-text-brand focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-20 focus:flex focus:min-h-touch-target focus:items-center focus:px-3 focus:shadow-elevation-2"
    >
      {children}
    </a>
  );
}
