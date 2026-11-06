'use client';

import { useSyncExternalStore } from 'react';
import { safeReturnPath } from '@/lib/safe-return-path';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

function nothingOnTheServer(): undefined {
  return undefined;
}

/** The fragment never reaches a server, so tokens and the way back travel in it (03 §7). */
function useRawFragment(): string | undefined {
  return useSyncExternalStore(subscribe, () => window.location.hash, nothingOnTheServer);
}

/** One value of the fragment, or undefined; also before the browser has taken over the page. */
export function useFragmentValue(name: string): string | undefined {
  const fragment = useRawFragment();
  return fragment === undefined
    ? undefined
    : (new URLSearchParams(fragment.slice(1)).get(name) ?? undefined);
}

/** A section of the page to come back to: letters and hyphens, so nothing else gets through. */
const SECTION = /^[a-z-]+$/;

/** Where to go after signing in, when a page of this site asked for it. */
export function useReturnPath(): string | undefined {
  const path = safeReturnPath(useFragmentValue('next'));
  const section = useFragmentValue('section');
  if (path === undefined || section === undefined || !SECTION.test(section)) return path;
  return `${path}#${section}`;
}

/** The fragment as it is, for a link to the next step of the same way. */
export function useFragmentForLinks(): string {
  return useRawFragment() ?? '';
}
