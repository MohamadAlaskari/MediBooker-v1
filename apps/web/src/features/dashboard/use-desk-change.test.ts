import {
  getGetDeskDayQueryKey,
  getSearchDeskAppointmentsQueryKey,
  getSearchDeskPatientsQueryKey,
} from '@medibooker/api-client';
import { describe, expect, it } from 'vitest';
import { isDeskQueryOf } from './use-desk-change';

const PRACTICE = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

describe('isDeskQueryOf', () => {
  it('finds the desk’s answers to read again after a change, also the searches that are POSTs', () => {
    expect(isDeskQueryOf(PRACTICE, getGetDeskDayQueryKey(PRACTICE, {}))).toBe(true);
    expect(
      isDeskQueryOf(PRACTICE, getSearchDeskAppointmentsQueryKey(PRACTICE, { query: 'سارة' })),
    ).toBe(true);
    expect(isDeskQueryOf(PRACTICE, getSearchDeskPatientsQueryKey(PRACTICE, {}))).toBe(true);
  });

  it('leaves another practice’s answers and everything outside the desk', () => {
    expect(isDeskQueryOf(PRACTICE, getGetDeskDayQueryKey(OTHER, {}))).toBe(false);
    expect(isDeskQueryOf(PRACTICE, [`/api/v1/practices/${PRACTICE}/me/membership`])).toBe(false);
    expect(isDeskQueryOf(PRACTICE, ['POST', 1, { desk: true }])).toBe(false);
  });
});
