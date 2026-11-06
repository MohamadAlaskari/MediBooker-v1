'use client';

import { useResendVerification } from '@medibooker/api-client';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from './form-parts';

const WAIT_SECONDS = 45;

interface ResendButtonProps {
  readonly email: string;
  readonly label: string;
  readonly sentLabel: string;
  /** The first e-mail has only just left, so asking again makes no sense yet. */
  readonly startWaiting?: boolean;
}

/** Asks for the confirmation e-mail again, with a wait so that nobody keeps pressing it. */
export function ResendButton({
  email,
  label,
  sentLabel,
  startWaiting = false,
}: ResendButtonProps): ReactNode {
  const t = useTranslations('auth.checkInbox');
  const [waiting, setWaiting] = useState(startWaiting ? WAIT_SECONDS : 0);
  const resend = useResendVerification();
  const counting = waiting > 0;
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setInterval(() => {
      setWaiting((seconds) => Math.max(seconds - 1, 0));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [counting]);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        isDisabled={counting || resend.isPending}
        onPress={() => {
          resend.mutate(
            { data: { email } },
            {
              onSuccess: () => {
                setWaiting(WAIT_SECONDS);
              },
            },
          );
        }}
      >
        {counting ? t('resendIn', { seconds: waiting }) : label}
      </Button>
      <p role="status" className="text-center text-body-small text-text-success">
        {resend.isSuccess ? sentLabel : null}
      </p>
      <FormError error={resend.error} />
    </div>
  );
}
