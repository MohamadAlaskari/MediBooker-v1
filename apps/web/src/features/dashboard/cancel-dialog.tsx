'use client';

import type { DeskAppointmentDto } from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { CalendarX } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { TextAreaField } from '@/components/ui/text-field';
import { practiceFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { noteToSend, phoneInSentence, textIn } from '../portal/appointment-view';
import { useDesk } from './desk-context';
import { useDeskChange } from './use-desk-change';

/** As long as the API takes it. */
const MAX_REASON_LENGTH = 500;

/**
 * A cancel by the practice (BR-04): with a reason the team keeps, which the patient does not see.
 * Until the appointment e-mails of N01 nobody tells the patient, so the dialog says so and shows how
 * to reach them.
 */
export function CancelDialog({
  appointment,
  onDone,
}: {
  readonly appointment: DeskAppointmentDto;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.cancel');
  const details = useTranslations('dashboard.details');
  const today = useTranslations('dashboard.today');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const change = useDeskChange(practiceId);
  const [isOpen, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [isMissing, setMissing] = useState(false);
  const format = practiceFormat(locale, appointment);
  const { patient } = appointment;
  const name = isolate(`${patient.firstName} ${patient.lastName}`);
  const when = `${format.dayLong(format.instantDate(appointment.startsAt))} ${format.instantTime(appointment.startsAt)}`;
  const service = isolate(textIn(appointment.serviceName, locale));
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) {
          change.reset();
          setMissing(false);
        }
      }}
    >
      <Button variant="danger">
        <CalendarX aria-hidden data-icon="inline-start" />
        {details('cancel')}
      </Button>
      <DialogContent
        title={t('title')}
        description={t('body', { name, service, when })}
        isDismissable={!change.isPending}
      >
        {(close) => (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const text = noteToSend(reason);
              setMissing(text === undefined);
              if (text === undefined) return;
              change.mutate(
                { action: 'CANCEL', appointmentId: appointment.id, cancelReason: text },
                {
                  onSuccess: () => {
                    close();
                    onDone(today('done', { action: 'CANCEL', name }));
                  },
                },
              );
            }}
          >
            <FormError error={change.error} />
            <TextAreaField
              label={t('reason')}
              hint={t('reasonHint')}
              value={reason}
              onChange={setReason}
              maxLength={MAX_REASON_LENGTH}
              isRequired
              error={isMissing ? t('required') : undefined}
            />
            {patient.phone === null ? null : (
              <p className="text-body-default text-text-primary">
                {t('phone', { phone: phoneInSentence(patient.phone) })}
              </p>
            )}
            <Button type="submit" variant="danger" isPending={change.isPending}>
              {t('confirm')}
            </Button>
            <Button variant="outline" isDisabled={change.isPending} onPress={close}>
              {t('keep')}
            </Button>
          </form>
        )}
      </DialogContent>
    </DialogTrigger>
  );
}
