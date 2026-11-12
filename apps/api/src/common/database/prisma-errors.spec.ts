import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { describe, expect, it } from 'vitest';
import {
  driverFailureOf,
  isAuthenticationFailure,
  isConnectionFailure,
  isDatabaseBusy,
} from './prisma-errors.js';

/** A Prisma error with the driver adapter's report, as the pg adapter produces it. */
function reported(cause: Record<string, unknown>, code = 'P2010'): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Invalid invocation: secret-value', {
    code,
    clientVersion: '7.10.1',
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause } },
  });
}

describe('driverFailureOf', () => {
  it('reads kind, SQLSTATE, severity and the index of a unique violation, each as a string', () => {
    expect(
      driverFailureOf(
        reported({
          kind: 'UniqueConstraintViolation',
          originalCode: '23505',
          constraint: { index: 'practice_slugs_pkey' },
        }),
      ),
    ).toEqual({
      kind: 'UniqueConstraintViolation',
      sqlState: '23505',
      severity: undefined,
      index: 'practice_slugs_pkey',
    });
  });

  it('reads nothing that is not a string', () => {
    expect(
      driverFailureOf(reported({ kind: 7, originalCode: {}, constraint: { fields: ['slug'] } })),
    ).toEqual({
      kind: undefined,
      sqlState: undefined,
      severity: undefined,
      index: undefined,
    });
  });

  it('is undefined for other errors and for a Prisma error without a report', () => {
    expect(driverFailureOf(new Error('x'))).toBeUndefined();
    expect(
      driverFailureOf({ meta: { driverAdapterError: { cause: { kind: 'x' } } } }),
    ).toBeUndefined();
    expect(
      driverFailureOf(
        new PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: '7.10.1' }),
      ),
    ).toBeUndefined();
    expect(
      driverFailureOf(
        new PrismaClientKnownRequestError('x', {
          code: 'P2010',
          clientVersion: '7.10.1',
          meta: { driverAdapterError: 'not an object' },
        }),
      ),
    ).toBeUndefined();
  });

  it('is undefined for a value whose prototype cannot be read', () => {
    const unreadable = new Proxy(
      {},
      {
        getPrototypeOf: (): never => {
          throw new RangeError('secret-value');
        },
      },
    );
    expect(driverFailureOf(unreadable)).toBeUndefined();
  });
});

describe('isConnectionFailure (02 §5 item 7)', () => {
  it.each([
    ['refused or unknown host', 'DatabaseNotReachable'],
    ['unknown database (3D000)', 'DatabaseDoesNotExist'],
    ['refused password (28P01)', 'AuthenticationFailed'],
    ['refused login (28000)', 'DatabaseAccessDenied'],
    ['certificate or host name not verified', 'TlsConnectionError'],
    ['reset or terminated connection', 'ConnectionClosed'],
    ['socket timeout', 'SocketTimeout'],
  ])('is true for a %s', (_case, kind) => {
    expect(isConnectionFailure(reported({ kind }))).toBe(true);
  });

  it.each([
    ['no CONNECT on the database (42501 on connect)', '42501'],
    ['terminated by an administrator (57P01)', '57P01'],
  ])('is true for a FATAL database error: %s', (_case, code) => {
    expect(
      isConnectionFailure(reported({ kind: 'postgres', originalCode: code, severity: 'FATAL' })),
    ).toBe(true);
    expect(
      isConnectionFailure(reported({ kind: 'postgres', originalCode: code, severity: 'PANIC' })),
    ).toBe(true);
  });

  it('is false for errors of a query on a working connection', () => {
    expect(
      isConnectionFailure(reported({ kind: 'UniqueConstraintViolation', originalCode: '23505' })),
    ).toBe(false);
    // A CHECK violation and a permission error on a table end the statement, not the session.
    expect(
      isConnectionFailure(reported({ kind: 'postgres', originalCode: '23514', severity: 'ERROR' })),
    ).toBe(false);
    expect(
      isConnectionFailure(reported({ kind: 'postgres', originalCode: '42501', severity: 'ERROR' })),
    ).toBe(false);
  });

  it('is false for errors without a driver report: other errors and pg connect timeouts', () => {
    expect(isConnectionFailure(new Error('timeout exceeded when trying to connect'))).toBe(false);
    expect(isConnectionFailure(reported({}))).toBe(false);
    expect(isConnectionFailure('secret-value')).toBe(false);
  });
});

describe('isDatabaseBusy', () => {
  it('is true for pg, when no connection of the pool came free in time', () => {
    expect(isDatabaseBusy(new Error('timeout exceeded when trying to connect'))).toBe(true);
  });

  it('is true for a transaction that could not start or ran out of time', () => {
    expect(
      isDatabaseBusy(new PrismaClientKnownRequestError('x', { code: 'P2028', clientVersion: '7' })),
    ).toBe(true);
  });

  it('is true for a row lock that did not come free', () => {
    expect(
      isDatabaseBusy(reported({ kind: 'postgres', originalCode: '55P03', severity: 'ERROR' })),
    ).toBe(true);
  });

  it('is true for a transaction the database ended because it waited in a circle', () => {
    expect(
      isDatabaseBusy(reported({ kind: 'postgres', originalCode: '40P01', severity: 'ERROR' })),
    ).toBe(true);
  });

  it('is false for anything else: a failed connection, another error, what is no error', () => {
    expect(isDatabaseBusy(reported({ kind: 'ConnectionClosed' }))).toBe(false);
    expect(isDatabaseBusy(reported({ kind: 'postgres', originalCode: '23514' }))).toBe(false);
    expect(isDatabaseBusy(new Error('other'))).toBe(false);
    expect(isDatabaseBusy('timeout exceeded when trying to connect')).toBe(false);
    const unreadable = new Proxy(
      {},
      {
        getPrototypeOf: (): never => {
          throw new RangeError('secret-value');
        },
      },
    );
    expect(isDatabaseBusy(unreadable)).toBe(false);
  });
});

describe('isAuthenticationFailure', () => {
  it('is true only for a refused password', () => {
    expect(
      isAuthenticationFailure(reported({ kind: 'AuthenticationFailed', originalCode: '28P01' })),
    ).toBe(true);
    expect(
      isAuthenticationFailure(reported({ kind: 'DatabaseAccessDenied', originalCode: '28000' })),
    ).toBe(false);
    expect(isAuthenticationFailure(new Error('x'))).toBe(false);
  });
});
