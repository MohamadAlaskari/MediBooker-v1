import { describe, expect, it } from 'vitest';
import { isPracticeId, practiceNames } from './names.ts';

describe('practiceNames', () => {
  it('derives database, roles and secret references from the id without hyphens', () => {
    expect(practiceNames('00000000-0000-4000-8000-000000000001')).toEqual({
      practiceId: '00000000-0000-4000-8000-000000000001',
      id32: '00000000000040008000000000000001',
      databaseName: 'practice_00000000000040008000000000000001',
      appRole: 'practice_00000000000040008000000000000001_app',
      ownerRole: 'practice_00000000000040008000000000000001_owner',
      appSecretRef: 'dev:practice_00000000000040008000000000000001_app',
      ownerSecretRef: 'dev:practice_00000000000040008000000000000001_owner',
      fieldKeyRef: 'dev:practice_00000000000040008000000000000001_field_key',
    });
  });

  it('uses the lowercase id', () => {
    const names = practiceNames('ABCDEF01-2345-4678-9ABC-DEF012345678');
    expect(names.practiceId).toBe('abcdef01-2345-4678-9abc-def012345678');
    expect(names.databaseName).toBe('practice_abcdef0123454678' + '9abcdef012345678');
  });

  it('keeps every name within the 63 bytes of a PostgreSQL identifier', () => {
    expect(practiceNames('00000000-0000-4000-8000-000000000001').ownerRole).toHaveLength(47);
  });

  it.each([
    '',
    'al-noor',
    '00000000000040008000000000000001',
    '00000000-0000-4000-8000-00000000000g',
  ])('rejects %j', (value) => {
    expect(isPracticeId(value)).toBe(false);
    expect(() => practiceNames(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENTS' }),
    );
  });
});
