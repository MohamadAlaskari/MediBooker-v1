import { describe, expect, it } from 'vitest';
import { onlyAllowedFields, REVIEWED_LOG_FIELDS } from './log-fields.js';
import { REDACTED_PATHS } from './redaction.js';

describe('REVIEWED_LOG_FIELDS', () => {
  it('holds exactly the reviewed fields of 02 §8: changing it is a reviewed change', () => {
    expect([...REVIEWED_LOG_FIELDS.keys()]).toEqual([
      'practiceId',
      'clusterId',
      'reasonCode',
      'succeeded',
      'failed',
    ]);
  });

  it('shares no name with the redacted fields', () => {
    const redactedFields = REDACTED_PATHS.filter((redactedPath) => /^\w+$/.test(redactedPath));
    expect(redactedFields).toContain('email');
    for (const field of REVIEWED_LOG_FIELDS.keys()) expect(redactedFields).not.toContain(field);
  });

  it.each([
    ['practiceId', '00000000-0000-4000-8000-000000000001', 'Sara Example, A123456789'],
    ['clusterId', 'eu-central-1', 'Sara Example'],
    ['reasonCode', 'PRACTICE_IDENTITY_MISMATCH', 'host db.internal.test refused'],
    ['reasonCode', 'PRACTICE_ACL_OPEN', 'practice_identity_mismatch'],
    ['reasonCode', 'PRACTICE_CONNECTION_FAILED', `P${'_A'.repeat(40)}`],
  ])('keeps %s only in its form', (field, valid, invalid) => {
    expect(onlyAllowedFields({ [field]: valid })).toEqual({ [field]: valid });
    expect(onlyAllowedFields({ [field]: invalid })).toEqual({ droppedFields: 1 });
    expect(onlyAllowedFields({ [field]: 42 })).toEqual({ droppedFields: 1 });
  });
});

describe('onlyAllowedFields', () => {
  it('keeps the order of the fields, so the access line stays as pino-http writes it', () => {
    const fields = { res: {}, err: new Error('x'), responseTime: 1, req: {} };
    expect(Object.keys(onlyAllowedFields(fields))).toEqual(['res', 'err', 'responseTime', 'req']);
  });

  it('leaves the logged object unchanged', () => {
    const fields = { context: 'LogProbe', email: 'sara@example.test' };
    expect(onlyAllowedFields(fields)).toEqual({ context: 'LogProbe', droppedFields: 1 });
    expect(fields).toEqual({ context: 'LogProbe', email: 'sara@example.test' });
  });

  it('never copies a key it does not know, also not __proto__', () => {
    const fields = JSON.parse('{"__proto__":{"isAdmin":true},"context":"LogProbe"}') as object;
    const kept = onlyAllowedFields(fields);
    expect(kept).toEqual({ context: 'LogProbe', droppedFields: 1 });
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
    expect('isAdmin' in kept).toBe(false);
  });

  it('returns an empty object for a call without fields', () => {
    expect(onlyAllowedFields({})).toEqual({});
  });
});
