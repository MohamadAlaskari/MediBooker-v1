import type { DeskPatientChangeDto, DeskPatientRecordDto } from '@medibooker/api-client';
import type { PatientField, PatientValues } from './patient-fields';

/** The form's values of a patient as the record shows them; a known number is never shown. */
export function valuesOf({ patient }: Pick<DeskPatientRecordDto, 'patient'>): PatientValues {
  return {
    firstName: patient.firstName,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth,
    phone: patient.phone ?? '',
    insuranceType: patient.insuranceType,
    insuranceProvider: patient.insuranceProvider ?? '',
    insuranceNumber: '',
  };
}

/** The fields a patient's details cannot do without (BR-10): the form asks for them first. */
export const REQUIRED_FIELDS = ['firstName', 'lastName', 'dateOfBirth'] as const;

/** The required fields left empty, which the form names instead of sending them. */
export function missingOf(values: PatientValues): PatientField[] {
  return REQUIRED_FIELDS.filter((field) => values[field].trim() === '');
}

/**
 * What the team changed, as the API takes it (RT-97): what is left out stays, an emptied phone is
 * removed, and an empty number field keeps the known number. A provider and a number go only with
 * a type the practice asks them for; an emptied required field never goes (`missingOf`).
 */
export function changeOf(
  before: PatientValues,
  after: PatientValues,
  asks: { readonly provider: boolean; readonly number: boolean },
): DeskPatientChangeDto {
  const trimmed = (field: PatientField): string => after[field].trim();
  const differs = (field: PatientField): boolean =>
    trimmed(field) !== before[field] && (trimmed(field) !== '' || field === 'phone');
  const typeChanged = after.insuranceType !== before.insuranceType;
  const provider = trimmed('insuranceProvider');
  const number = trimmed('insuranceNumber');
  return {
    ...(differs('firstName') ? { firstName: trimmed('firstName') } : {}),
    ...(differs('lastName') ? { lastName: trimmed('lastName') } : {}),
    ...(differs('dateOfBirth') ? { dateOfBirth: trimmed('dateOfBirth') } : {}),
    ...(differs('phone') ? { phone: trimmed('phone') === '' ? null : trimmed('phone') } : {}),
    ...(typeChanged
      ? { insuranceType: after.insuranceType as NonNullable<DeskPatientChangeDto['insuranceType']> }
      : {}),
    ...(asks.provider && provider !== '' && (typeChanged || differs('insuranceProvider'))
      ? { insuranceProvider: provider }
      : {}),
    ...(asks.number && number !== '' ? { insuranceNumber: number } : {}),
  };
}
