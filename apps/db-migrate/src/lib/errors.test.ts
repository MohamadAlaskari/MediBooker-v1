import { describe, expect, it } from 'vitest';
import { toErrorCode, ToolError } from './errors.ts';

function withCode(code: unknown, message = 'connect ECONNREFUSED 10.0.0.1:5432 as role x'): Error {
  return Object.assign(new Error(message), { code });
}

describe('ToolError', () => {
  it('carries its code as its message, so printing it reveals nothing else', () => {
    const error = new ToolError('SECRET_UNRESOLVABLE');
    expect(error.message).toBe('SECRET_UNRESOLVABLE');
    expect(String(error)).toBe('ToolError: SECRET_UNRESOLVABLE');
  });
});

describe('toErrorCode', () => {
  it.each([
    ['28P01', 'DATABASE_AUTH_FAILED'],
    ['28000', 'DATABASE_AUTH_FAILED'],
    ['3D000', 'DATABASE_NOT_FOUND'],
    ['42501', 'DATABASE_PERMISSION_DENIED'],
    ['ECONNREFUSED', 'DATABASE_UNREACHABLE'],
    ['ENOTFOUND', 'DATABASE_UNREACHABLE'],
    ['ETIMEDOUT', 'DATABASE_UNREACHABLE'],
    ['53300', 'DATABASE_UNREACHABLE'],
    ['57P01', 'DATABASE_UNREACHABLE'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'DATABASE_TLS_FAILED'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DATABASE_TLS_FAILED'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'DATABASE_TLS_FAILED'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'DATABASE_TLS_FAILED'],
    ['23505', 'DATABASE_ERROR'],
    ['ERR_SOMETHING_ELSE', 'INTERNAL_ERROR'],
  ])('maps %s to %s from the code alone', (code, expected) => {
    expect(toErrorCode(withCode(code))).toBe(expected);
  });

  it('keeps the code of a ToolError', () => {
    expect(toErrorCode(new ToolError('RUNNER_BUSY'))).toBe('RUNNER_BUSY');
  });

  it.each([new Error('no code'), withCode(42), 'a thrown string', null, undefined])(
    'maps %j without a string code to INTERNAL_ERROR',
    (error) => {
      expect(toErrorCode(error)).toBe('INTERNAL_ERROR');
    },
  );
});
