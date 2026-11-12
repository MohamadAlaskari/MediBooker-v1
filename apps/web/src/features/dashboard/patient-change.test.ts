import { describe, expect, it } from 'vitest';
import { changeOf, missingOf, valuesOf } from './patient-change';

const RECORD = {
  patient: {
    id: '00000000-0000-4000-8000-0000000000a1',
    firstName: 'Hala',
    lastName: 'Example',
    dateOfBirth: '1982-07-19',
    age: 44,
    phone: '+966 55 000 9876',
    email: null,
    insuranceType: 'PUBLIC',
    insuranceProvider: 'Synthetic Insurance',
  },
} as const;
const BOTH = { provider: true, number: true };
const NONE = { provider: false, number: false };

describe('the change of a patient the practice keeps (RT-97)', () => {
  it('starts from the record, without the known number', () => {
    expect(valuesOf(RECORD)).toEqual({
      firstName: 'Hala',
      lastName: 'Example',
      dateOfBirth: '1982-07-19',
      phone: '+966 55 000 9876',
      insuranceType: 'PUBLIC',
      insuranceProvider: 'Synthetic Insurance',
      insuranceNumber: '',
    });
    expect(
      valuesOf({ patient: { ...RECORD.patient, phone: null, insuranceProvider: null } }),
    ).toMatchObject({ phone: '', insuranceProvider: '' });
  });

  it('sends only what changed, trimmed, and nothing for nothing', () => {
    const before = valuesOf(RECORD);
    expect(changeOf(before, before, BOTH)).toEqual({});
    expect(changeOf(before, { ...before, lastName: ' Exampel ', phone: '' }, BOTH)).toEqual({
      lastName: 'Exampel',
      phone: null,
    });
    // An emptied required field never goes: the form names it first.
    expect(changeOf(before, { ...before, firstName: '  ' }, BOTH)).toEqual({});
    expect(missingOf({ ...before, firstName: '  ', dateOfBirth: '' })).toEqual([
      'firstName',
      'dateOfBirth',
    ]);
    expect(missingOf(before)).toEqual([]);
  });

  it('keeps the known number unless one is typed, and sends the insurance as the type asks', () => {
    const before = valuesOf(RECORD);
    expect(changeOf(before, { ...before, insuranceNumber: ' 99887766 ' }, BOTH)).toEqual({
      insuranceNumber: '99887766',
    });
    expect(changeOf(before, { ...before, insuranceType: 'SELF_PAY' }, NONE)).toEqual({
      insuranceType: 'SELF_PAY',
    });
    // Another type that asks for a provider takes the one in the field along.
    expect(changeOf(before, { ...before, insuranceType: 'PRIVATE' }, BOTH)).toEqual({
      insuranceType: 'PRIVATE',
      insuranceProvider: 'Synthetic Insurance',
    });
    // An emptied provider is not sent: the API keeps the one it has, or names it as missing.
    expect(changeOf(before, { ...before, insuranceProvider: '' }, BOTH)).toEqual({});
  });
});
