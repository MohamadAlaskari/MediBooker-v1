'use client';

import { isApiError } from '@medibooker/api-client';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * The answers whose `Retry-After` says when another press can pass: a throttle, and a practice that
 * is busy or cannot be reached (503). Others say it too, such as a join a day later, which a page
 * says in words instead.
 */
const WAITED_OUT: ReadonlySet<string> = new Set(['RATE_LIMITED', 'SERVICE_UNAVAILABLE']);

/** Longer than this, a button would look broken: the sentence says how long, and it waits no more. */
const MAX_WAIT_SECONDS = 120;
const SECOND_MS = 1000;

/** The seconds an action's answer asks to wait before the next press, or undefined. */
export function waitOf(error: unknown): number | undefined {
  if (!isApiError(error) || !WAITED_OUT.has(error.code)) return undefined;
  const seconds = error.retryAfterSeconds;
  return seconds === undefined || seconds <= 0 ? undefined : Math.min(seconds, MAX_WAIT_SECONDS);
}

/**
 * An action's button waits out the `Retry-After` of its last answer (B06): another press within it
 * would only count against the same limit, or find the practice as busy. The seconds while it
 * waits, else undefined. A timer ends it: the page reads no clock.
 */
export function useWaitOut(error: unknown): number | undefined {
  const seconds = waitOf(error);
  // The answer whose wait is over: a new one waits anew.
  const [over, setOver] = useState<unknown>(null);
  useEffect(() => {
    if (seconds === undefined) return undefined;
    const timer = setTimeout(() => {
      setOver(error);
    }, seconds * SECOND_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [error, seconds]);
  return seconds !== undefined && over !== error ? seconds : undefined;
}

/** Below a button that waits: until when, in words. Not a live region: the error says it first. */
export function WaitNote({ seconds }: { readonly seconds: number | undefined }): ReactNode {
  const t = useTranslations('common');
  if (seconds === undefined) return null;
  return <p className="text-body-small text-text-secondary">{t('tryAgainIn', { seconds })}</p>;
}
