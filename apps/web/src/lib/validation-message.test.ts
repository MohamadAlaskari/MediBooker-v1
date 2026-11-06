import { describe, expect, it } from 'vitest';
import { validationMessageOf } from './validation-message';

describe('validationMessageOf', () => {
  it('calls an empty or a missing field missing, whichever rule found it', () => {
    expect(validationMessageOf({ code: 'invalid_format', input: '' }).key).toBe('REQUIRED');
    expect(validationMessageOf({ code: 'too_small', input: '', minimum: 10 }).key).toBe('REQUIRED');
    expect(validationMessageOf({ code: 'invalid_type' }).key).toBe('REQUIRED');
  });

  it('says how long a text must be', () => {
    expect(validationMessageOf({ code: 'too_small', input: 'short', minimum: 10 })).toEqual({
      key: 'TOO_SHORT',
      values: { min: 10 },
    });
    expect(validationMessageOf({ code: 'too_big', input: 'long', maximum: 254 })).toEqual({
      key: 'TOO_LONG',
      values: { max: 254 },
    });
  });

  it('knows a wrong format, and has an answer for anything else', () => {
    expect(validationMessageOf({ code: 'invalid_format', input: 'x' }).key).toBe('INVALID_FORMAT');
    expect(validationMessageOf({ code: 'custom', input: false }).key).toBe('INVALID_VALUE');
  });
});
