'use client';

import {
  getGetMyAppointmentQueryKey,
  getListMyAppointmentsQueryKey,
  isApiError,
  useCancelAppointment,
  type AppointmentDto,
  type MyAppointmentsDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarX } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { FormError, useFocusOnArrival } from '../auth/form-parts';
import { formatOf, isOutcomeUnknown, textIn, whenParts } from './appointment-view';

const DANGER =
  'bg-bg-danger text-text-on-danger data-[hovered]:bg-bg-danger-hover data-[pressed]:bg-bg-danger-hover';

interface CancelButtonProps {
  readonly appointment: AppointmentDto;
  readonly label: string;
  /** Among other rows: what tells this button from the others in a screen reader's list. */
  readonly name?: string;
  readonly variant?: 'ghost' | 'danger';
  /**
   * The appointment has changed, so this button may go with the focus on it: the page takes the focus,
   * and says what happened when this cancel is what changed it.
   */
  readonly onChanged: (news?: string) => void;
}

/** PW9: asks once more, because the time then goes to someone else. */
export function CancelButton({
  appointment,
  label,
  name,
  variant = 'ghost',
  onChanged,
}: CancelButtonProps): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [isOpen, setOpen] = useState(false);
  const service = isolate(textIn(appointment.serviceName, locale));
  const when = t(
    'appointment.when',
    whenParts(formatOf(appointment, locale), appointment.startsAt),
  );
  const cancel = useCancelAppointment({
    mutation: {
      onSuccess: (cancelled) => {
        // At once and whatever the next look answers: this one must not stay on the page as booked.
        queryClient.setQueryData(
          getGetMyAppointmentQueryKey(appointment.practiceId, appointment.id),
          cancelled,
        );
        queryClient.setQueryData<MyAppointmentsDto>(getListMyAppointmentsQueryKey(), (list) =>
          list === undefined
            ? undefined
            : { ...list, items: list.items.filter(({ id }) => id !== appointment.id) },
        );
        void queryClient.invalidateQueries();
        setOpen(false);
        onChanged(t('cancel.done', { service, when }));
      },
    },
  });
  // From a tab left open: it was moved elsewhere, or its deadline has passed. Another press is no use.
  const refused =
    isApiError(cancel.error, 'INVALID_STATUS_TRANSITION') ||
    isApiError(cancel.error, 'CANCELLATION_DEADLINE_PASSED');
  // The answer got lost, so it may have gone through: "keep" would promise what nobody knows.
  const outcomeUnknown = isOutcomeUnknown(cancel.error);
  const closeButton = useFocusOnArrival<HTMLButtonElement>(refused);
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open && cancel.error !== null) {
          // What is shown may be out of date. Only now: the answer can take this row away, and the
          // dialog with its message along with it.
          void queryClient.invalidateQueries();
          if (refused || outcomeUnknown) onChanged();
        }
        cancel.reset();
      }}
    >
      <Button
        variant={variant === 'danger' ? 'default' : 'ghost'}
        className={variant === 'danger' ? DANGER : 'text-text-brand'}
        aria-label={name}
      >
        {variant === 'danger' ? <CalendarX aria-hidden data-icon="inline-start" /> : null}
        {label}
      </Button>
      <DialogContent
        title={t('cancel.title')}
        description={t('cancel.body', { service, when })}
        isDismissable={!cancel.isPending}
      >
        {(close) => (
          <>
            <FormError error={cancel.error} />
            {refused ? (
              <Button ref={closeButton} variant="outline" onPress={close}>
                {t('cancel.close')}
              </Button>
            ) : (
              <>
                <Button
                  isPending={cancel.isPending}
                  className={DANGER}
                  onPress={() => {
                    cancel.mutate({
                      practiceId: appointment.practiceId,
                      appointmentId: appointment.id,
                    });
                  }}
                >
                  {t('cancel.confirm')}
                </Button>
                <Button variant="outline" isDisabled={cancel.isPending} onPress={close}>
                  {outcomeUnknown ? t('cancel.close') : t('cancel.keep')}
                </Button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </DialogTrigger>
  );
}
