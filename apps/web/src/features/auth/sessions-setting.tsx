'use client';

import {
  getGetSessionsQueryKey,
  useEndOtherSessions,
  useEndSession,
  useGetSessions,
  type SignInDto,
} from '@medibooker/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from './form-parts';

/** What the last action did, and how many times, so that a second one moves the focus again. */
interface Done {
  readonly message: 'sessionEnded' | 'sessionsEndedOthers';
  readonly count: number;
}

function SignInRow({
  signIn,
  now,
  onEnd,
  ending,
}: {
  readonly signIn: SignInDto;
  readonly now: Date;
  readonly onEnd: () => void;
  readonly ending: boolean;
}): ReactNode {
  const t = useTranslations('auth.account');
  const format = useFormatter();
  const device = signIn.device ?? t('sessionUnknownDevice');
  const since = format.relativeTime(new Date(signIn.signedInAt), now);
  const lastActive = format.relativeTime(new Date(signIn.lastActiveAt), now);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-default p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-body-default text-text-primary">
          <bdi>{device}</bdi>
          {signIn.current ? (
            <span className="rounded-sm bg-bg-brand-subtle px-2 text-body-small text-text-brand">
              {t('sessionCurrent')}
            </span>
          ) : null}
        </p>
        <p className="text-body-small text-text-secondary">
          {t('sessionSince', { when: since })} · {t('sessionLastActive', { when: lastActive })}
        </p>
        {signIn.secondFactor ? (
          <p className="text-body-small text-text-secondary">{t('sessionSecondFactor')}</p>
        ) : null}
      </div>
      {signIn.current ? null : (
        <Button
          variant="outline"
          isPending={ending}
          aria-label={t('sessionEndLabel', { device, when: since })}
          onPress={onEnd}
        >
          {t('sessionEnd')}
        </Button>
      )}
    </li>
  );
}

/**
 * Where the account is signed in (A04): every browser and the app, newest first, with a way to end
 * one, for example on a lost phone, or all others at once. The current one stays: signing out of it
 * is the button below. Times are relative, so the page needs no time zone.
 */
export function SessionsSetting(): ReactNode {
  const t = useTranslations('auth.account');
  const queryClient = useQueryClient();
  const now = useNow({ updateInterval: 60_000 });
  const sessions = useGetSessions();
  const [done, setDone] = useState<Done>();
  const status = useRef<HTMLParagraphElement>(null);
  const refresh = (message: Done['message']) => {
    void queryClient.invalidateQueries({ queryKey: getGetSessionsQueryKey() });
    setDone((before) => ({ message, count: (before?.count ?? 0) + 1 }));
  };
  const end = useEndSession({
    mutation: {
      onSuccess: () => {
        refresh('sessionEnded');
      },
    },
  });
  const endOthers = useEndOtherSessions({
    mutation: {
      onSuccess: () => {
        refresh('sessionsEndedOthers');
      },
    },
  });
  // The button that was pressed is gone: the focus goes to what happened.
  useEffect(() => {
    if (done !== undefined) status.current?.focus();
  }, [done]);
  if (sessions.data === undefined) {
    return sessions.error === null ? null : <FormError error={sessions.error} />;
  }
  const others = sessions.data.filter(({ current }) => !current);
  return (
    <section aria-labelledby="sessions-title" className="mb-6 flex flex-col gap-3">
      <h2 id="sessions-title" className="text-heading-h3 text-text-primary">
        {t('sessionsTitle')}
      </h2>
      <p className="text-body-default text-text-secondary">{t('sessionsBody')}</p>
      {done === undefined ? null : (
        <p
          key={done.count}
          ref={status}
          role="status"
          tabIndex={-1}
          className="text-body-default text-text-success"
        >
          {t(done.message)}
        </p>
      )}
      <FormError error={end.error ?? endOthers.error} />
      <ul className="flex flex-col gap-2">
        {sessions.data.map((signIn) => (
          <SignInRow
            key={signIn.id}
            signIn={signIn}
            now={now}
            ending={end.isPending && end.variables.sessionId === signIn.id}
            onEnd={() => {
              end.mutate({ sessionId: signIn.id });
            }}
          />
        ))}
      </ul>
      {others.length > 0 ? (
        <Button
          variant="outline"
          isPending={endOthers.isPending}
          onPress={() => {
            endOthers.mutate();
          }}
        >
          {t('sessionsEndOthers')}
        </Button>
      ) : (
        <p className="text-body-default text-text-secondary">{t('sessionsOnlyThis')}</p>
      )}
    </section>
  );
}
