'use client';

import {
  cancelAppointmentAsPractice,
  checkInAppointment,
  completeAppointment,
  markAppointmentNoShow,
  type DeskAppointmentRowDto,
} from '@medibooker/api-client';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

export type DeskChangeAction = 'CHECK_IN' | 'COMPLETE' | 'NO_SHOW' | 'CANCEL';

export interface DeskChange {
  readonly action: DeskChangeAction;
  readonly appointmentId: string;
  /** Only for a cancel, which needs one (BR-04). */
  readonly cancelReason?: string;
}

/**
 * Every answer of the desk of this practice, in the generated client's query keys: a GET's key
 * starts with its path, a search (a POST that reads) with its method and then its path.
 */
export function isDeskQueryOf(practiceId: string, queryKey: readonly unknown[]): boolean {
  const desk = `/api/v1/practices/${practiceId}/desk/`;
  return queryKey.some((part) => typeof part === 'string' && part.startsWith(desk));
}

/**
 * The team's changes of an appointment (BR-04, BR-11). Whatever the answer, the day and the
 * details are read again: another member may have changed the same appointment meanwhile.
 */
export function useDeskChange(
  practiceId: string,
): UseMutationResult<DeskAppointmentRowDto, unknown, DeskChange> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, appointmentId, cancelReason }: DeskChange) => {
      switch (action) {
        case 'CHECK_IN': {
          return checkInAppointment(practiceId, appointmentId);
        }
        case 'COMPLETE': {
          return completeAppointment(practiceId, appointmentId);
        }
        case 'NO_SHOW': {
          return markAppointmentNoShow(practiceId, appointmentId);
        }
        case 'CANCEL': {
          return cancelAppointmentAsPractice(practiceId, appointmentId, {
            cancelReason: cancelReason ?? '',
          });
        }
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => isDeskQueryOf(practiceId, queryKey),
      }),
  });
}
