'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { LinkButton } from '@/components/ui/button';
import { practiceAddressOf } from '@/features/practice-page/free-times/free-times-view';
import { safeReturnPath } from '@/lib/safe-return-path';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

/** The fragment never reaches the server, so only the browser knows where a visitor came from. */
function returnPathInFragment(): string | undefined {
  return safeReturnPath(new URLSearchParams(window.location.hash.slice(1)).get('next'));
}

function noReturnPath(): undefined {
  return undefined;
}

export function BackToPractice({
  label,
  fallback,
}: {
  readonly label: string;
  readonly fallback: string;
}): ReactNode {
  const next = useSyncExternalStore(subscribe, returnPathInFragment, noReturnPath);
  return (
    <LinkButton
      variant="outline"
      className="mt-6"
      href={next === undefined ? fallback : practiceAddressOf(next)}
    >
      {label}
    </LinkButton>
  );
}
