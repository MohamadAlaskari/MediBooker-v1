import { describe, expect, it } from 'vitest';
import { isExactPracticeAcl } from './verify.ts';

const NAMES = { ownerRole: 'practice_x_owner', appRole: 'practice_x_app' };
const EXACT = [
  { grantee: 'practice_x_owner', privilege: 'CREATE' },
  { grantee: 'practice_x_owner', privilege: 'TEMPORARY' },
  { grantee: 'practice_x_owner', privilege: 'CONNECT' },
  { grantee: 'practice_x_app', privilege: 'CONNECT' },
];

describe('isExactPracticeAcl', () => {
  it('accepts exactly the owner plus practice_<id32>_app=c', () => {
    expect(isExactPracticeAcl(false, EXACT, NAMES)).toBe(true);
    expect(isExactPracticeAcl(false, [...EXACT].reverse(), NAMES)).toBe(true);
  });

  it("refuses PostgreSQL's default ACL, which grants CONNECT to PUBLIC", () => {
    expect(isExactPracticeAcl(true, [], NAMES)).toBe(false);
  });

  it.each([
    ['CONNECT for PUBLIC', [...EXACT, { grantee: 'PUBLIC', privilege: 'CONNECT' }]],
    ['another practice', [...EXACT, { grantee: 'practice_y_app', privilege: 'CONNECT' }]],
    ['TEMPORARY for the app', [...EXACT, { grantee: 'practice_x_app', privilege: 'TEMPORARY' }]],
    ['no CONNECT for the app', EXACT.slice(0, 3)],
    ['no CREATE for the owner', EXACT.slice(1)],
  ])('refuses an ACL with %s', (_case, entries) => {
    expect(isExactPracticeAcl(false, entries, NAMES)).toBe(false);
  });
});
