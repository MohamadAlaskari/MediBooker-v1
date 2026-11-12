import type { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import { insuranceNumberEnd } from '../account-profile/domain/profile.rules.js';

/**
 * The blind index of an insurance number, with this practice's key: the same number differs per
 * practice. The one place that names its context, for a join (B01), a patient the team adds (W7)
 * and a search (W8): a second spelling of it would make numbers unsearchable.
 */
export function insuranceNumberIndexOf(
  keys: PracticeKeys,
  practiceId: string,
  number: string,
): Promise<string> {
  return keys.keyedHash(practiceId, 'insurance-number', number);
}

/** What a sealed number is bound to: its patient's row and its field. */
function insuranceNumberContextOf(patientId: string): string {
  return `patient:${patientId}:insurance-number`;
}

/** The number under this practice's key, bound to its patient's row, its end, and its index. */
export async function sealedInsuranceNumber(
  keys: PracticeKeys,
  practiceId: string,
  patientId: string,
  number: string,
): Promise<{
  readonly insuranceNumberEncrypted: string;
  readonly insuranceNumberEnd: string;
  readonly insuranceNumberIndex: string;
}> {
  return {
    insuranceNumberEncrypted: await keys.encrypt(
      practiceId,
      number,
      insuranceNumberContextOf(patientId),
    ),
    insuranceNumberEnd: insuranceNumberEnd(number),
    insuranceNumberIndex: await insuranceNumberIndexOf(keys, practiceId, number),
  };
}

/** The whole number again, only for the person's copy of their data (Art. 15, RT-97). */
export function openedInsuranceNumber(
  keys: PracticeKeys,
  practiceId: string,
  patientId: string,
  sealed: string,
): Promise<string> {
  return keys.decrypt(practiceId, sealed, insuranceNumberContextOf(patientId));
}
