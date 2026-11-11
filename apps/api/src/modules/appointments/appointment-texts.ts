/**
 * What a sealed text of an appointment is bound to: its row and its field. A value copied into
 * another row or another field does not open there.
 */

/** What the patient wrote for the practice when booking. */
export function noteContextOf(appointmentId: string): string {
  return `appointment:${appointmentId}:patient-note`;
}

/** Why the practice cancelled (BR-04). */
export function cancelReasonContextOf(appointmentId: string): string {
  return `appointment:${appointmentId}:cancel-reason`;
}
