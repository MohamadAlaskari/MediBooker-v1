import { describe, expect, it } from 'vitest';
import {
  ALL_STAFF_ROLES,
  PracticeScoped,
  practiceAccessOf,
  practiceScopeOf,
  practiceStaffRolesOf,
} from './practice-scoped.decorator.js';

/** A handler as Nest sees it, decorated like a route method: the metadata sits on the function. */
function decorated(decorator: MethodDecorator): () => undefined {
  const handler = (): undefined => undefined;
  decorator({}, 'handler', {
    value: handler,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return handler;
}

describe('PracticeScoped', () => {
  it('refuses an access rule on a public slug route, which reads no caller', () => {
    expect(() => PracticeScoped('slug', { staff: ['ADMIN'] })).toThrow('a slug route is public');
    expect(() => PracticeScoped('slug', { patient: true })).toThrow('a slug route is public');
    expect(() => PracticeScoped('slug')).not.toThrow();
  });

  it('marks a staff route with the roles it admits', () => {
    const handler = decorated(PracticeScoped('id', { staff: ALL_STAFF_ROLES }));
    expect(practiceScopeOf(handler)).toBe('id');
    expect(practiceAccessOf(handler)).toBe('staff');
    expect(practiceStaffRolesOf(handler)).toEqual(['STAFF', 'DOCTOR', 'ADMIN']);
  });

  it('marks a route for a confirmed account (B07)', () => {
    expect(practiceAccessOf(decorated(PracticeScoped('id', { account: true })))).toBe('account');
    expect(() => PracticeScoped('slug', { account: true })).toThrow('a slug route is public');
  });

  it('refuses two rules, which would serve as the weaker one (security review of B07)', () => {
    for (const options of [
      { patient: true, account: true },
      { patient: true, join: true },
      { staff: ALL_STAFF_ROLES, account: true },
      { join: true, account: true },
    ] as const) {
      expect(() => PracticeScoped('id', options)).toThrow('one access rule');
    }
  });

  it('takes confirmed only with patient', () => {
    expect(() => PracticeScoped('id', { account: true, confirmed: true })).toThrow(
      'confirmed goes with patient',
    );
    expect(() => PracticeScoped('id', { confirmed: true })).toThrow('confirmed goes with patient');
    expect(
      practiceAccessOf(decorated(PracticeScoped('id', { patient: true, confirmed: true }))),
    ).toBe('confirmed-patient');
  });

  it('names no roles for any other route', () => {
    const handler = decorated(PracticeScoped('id', { patient: true }));
    expect(practiceAccessOf(handler)).toBe('patient');
    expect(practiceStaffRolesOf(handler)).toEqual([]);
  });
});
