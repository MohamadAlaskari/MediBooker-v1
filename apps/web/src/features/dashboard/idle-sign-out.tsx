'use client';

import { useLogout } from '@medibooker/api-client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '@/components/ui/button';
import { announceSignOut } from '@/lib/session-broadcast';
import { signInAgainHref } from '../auth/session-redirect';

/** 03 §5: the dashboard signs out after 15 minutes without activity, with a warning before. */
export const IDLE_SIGN_OUT_MS = 15 * 60_000;
export const IDLE_WARNING_MS = 60_000;
/** The other tabs of the dashboard in this browser: activity in one keeps them signed in. */
const CHANNEL = 'mb_dashboard_activity';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** How often a tab tells the others at most: often enough, without a message per key. */
const TELL_EVERY_MS = 5000;
/**
 * How often activity asks the API at most: the API ends a session with both factors after 30 minutes
 * without a refresh (`SECOND_FACTOR_IDLE_MINUTES`), and a person who reads a drawer for a while is
 * still there. Only on activity: never a request on a timer (RT-94).
 */
const KEEP_ALIVE_MS = 5 * 60_000;

function channelOrNone(): BroadcastChannel | undefined {
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    // Without channels each tab counts for itself, which signs out sooner, never later.
    return undefined;
  }
}

/**
 * The automatic sign-out of a shared front-desk computer (health-data-security §7). Activity is a
 * press, a key, a scroll, in this tab or another of the dashboard; it starts the two timers again,
 * so no clock is read and nothing is stored. A minute before the end a dialog asks, and its answer
 * counts as activity. At the end the session ends at the API and the page leaves for signing in,
 * which comes back to the dashboard.
 */
export function IdleSignOut({
  onActive,
}: {
  /** A request of the API that keeps the session refreshed, at most every few minutes. */
  readonly onActive: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.idle');
  const locale = useLocale();
  const logout = useLogout();
  const warningTimer = useRef<number | undefined>(undefined);
  const endTimer = useRef<number | undefined>(undefined);
  const toldLately = useRef(false);
  const askedLately = useRef(false);
  const keepAlive = useRef(onActive);
  useEffect(() => {
    keepAlive.current = onActive;
  });
  const signingOut = useRef(false);
  const [isWarning, setWarning] = useState(false);

  const signOut = useCallback(() => {
    if (signingOut.current) return;
    signingOut.current = true;
    const leave = (): void => {
      announceSignOut();
      // A new document: nothing of the patients stays in memory for whoever comes next.
      window.location.replace(
        signInAgainHref(locale, { pathname: `/${locale}/dashboard`, hash: '' }),
      );
    };
    logout.mutate({ data: {} }, { onSettled: leave });
  }, [locale, logout]);

  const startTimers = useCallback(() => {
    window.clearTimeout(warningTimer.current);
    window.clearTimeout(endTimer.current);
    warningTimer.current = window.setTimeout(() => {
      setWarning(true);
    }, IDLE_SIGN_OUT_MS - IDLE_WARNING_MS);
    endTimer.current = window.setTimeout(signOut, IDLE_SIGN_OUT_MS);
  }, [signOut]);

  const restart = useCallback(() => {
    setWarning(false);
    startTimers();
  }, [startTimers]);

  useEffect(() => {
    const channel = channelOrNone();
    const onActivity = (): void => {
      restart();
      if (!askedLately.current) {
        askedLately.current = true;
        keepAlive.current();
        window.setTimeout(() => {
          askedLately.current = false;
        }, KEEP_ALIVE_MS);
      }
      if (toldLately.current) return;
      toldLately.current = true;
      channel?.postMessage('active');
      window.setTimeout(() => {
        toldLately.current = false;
      }, TELL_EVERY_MS);
    };
    channel?.addEventListener('message', restart);
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    startTimers();
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      channel?.close();
      window.clearTimeout(warningTimer.current);
      window.clearTimeout(endTimer.current);
    };
  }, [restart, startTimers]);

  return (
    <ModalOverlay
      isOpen={isWarning}
      isDismissable
      onOpenChange={(open) => {
        if (!open) restart();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg-overlay p-4"
    >
      <Modal className="my-auto w-full max-w-[28rem] rounded-lg bg-bg-surface p-6 shadow-elevation-2">
        <Dialog role="alertdialog" className="flex flex-col gap-4 outline-none">
          <Heading slot="title" className="text-heading-h3 text-text-primary">
            {t('title')}
          </Heading>
          <p className="text-body-default text-text-secondary">{t('body')}</p>
          <Button onPress={restart}>{t('stay')}</Button>
          <Button variant="outline" isPending={logout.isPending} onPress={signOut}>
            {t('signOut')}
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
