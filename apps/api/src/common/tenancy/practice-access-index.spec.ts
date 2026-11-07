import { describe, expect, it, vi } from 'vitest';
import type { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { FixedClock } from '../time/fixed-clock.js';
import { PracticeAccessIndex } from './practice-access-index.js';
import { PracticeAudit } from './practice-audit.js';
import type { PracticeKeys } from './practice-keys.js';
import type { PracticeTransactionHost } from './practice-transactional.adapter.js';

const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const USER = '00000000-0000-4000-8000-000000000001';
const PRACTICE = '00000000-0000-4000-8000-00000000000a';

function setUp() {
  const findMany = vi.fn();
  const findUnique = vi.fn();
  const executeRaw = vi.fn().mockResolvedValue(1);
  const platform = {
    practiceAccess: { findMany },
    user: { findUnique },
    $executeRaw: executeRaw,
  } as unknown as PlatformPrismaService;
  return {
    index: new PracticeAccessIndex(platform, new FixedClock(NOW)),
    findMany,
    findUnique,
    executeRaw,
  };
}

describe('PracticeAccessIndex', () => {
  it('reads only active rows of this person in this practice', async () => {
    const { index, findMany } = setUp();
    findMany.mockResolvedValue([{ capacity: 'PATIENT' }]);
    await expect(index.capacitiesOf(USER, PRACTICE)).resolves.toEqual(['PATIENT']);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: USER, practiceId: PRACTICE, active: true },
      select: { capacity: true },
    });
  });

  it('lists the practices of a person with their current slug, or none', async () => {
    const { index, findMany } = setUp();
    findMany.mockResolvedValue([
      {
        capacity: 'PATIENT',
        practice: { id: PRACTICE, name: { en: 'A' }, slugs: [{ slug: 'al-noor' }] },
      },
      { capacity: 'STAFF', practice: { id: 'other', name: {}, slugs: [] } },
    ]);
    await expect(index.practicesOf(USER)).resolves.toEqual([
      { id: PRACTICE, slug: 'al-noor', name: { en: 'A' }, capacity: 'PATIENT' },
      { id: 'other', slug: null, name: {}, capacity: 'STAFF' },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER, active: true }) as object,
      }),
    );
  });

  it.each([
    [{ emailVerifiedAt: new Date() }, true],
    [{ emailVerifiedAt: null }, false],
    [null, false],
  ])('takes a confirmed address only from the row: %j', async (row, expected) => {
    const { index, findUnique } = setUp();
    findUnique.mockResolvedValue(row);
    await expect(index.isVerified(USER)).resolves.toBe(expected);
  });

  it('applies an event in one statement, which ignores an older version', async () => {
    const { index, executeRaw } = setUp();
    await index.apply(PRACTICE, 7n, { userId: USER, capacity: 'PATIENT', active: true });
    const [statement, ...values] = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(statement.join('?')).toContain(
      'WHERE practice_access.source_version < EXCLUDED.source_version',
    );
    expect(statement.join('?')).toContain('FROM users WHERE id =');
    expect(values).toEqual(expect.arrayContaining([PRACTICE, 'PATIENT', true, 7n, USER]));
  });
});

describe('PracticeAudit', () => {
  function audit() {
    const create = vi.fn().mockResolvedValue({});
    const keyedHash = vi.fn().mockResolvedValue('hash');
    const txHost = { tx: { auditEvent: { create } } } as unknown as PracticeTransactionHost;
    const keys = { keyedHash } as unknown as PracticeKeys;
    return { audit: new PracticeAudit(txHost, new FixedClock(NOW), keys), create, keyedHash };
  }

  it('hashes an address with a key of the practice, and only when there is one', async () => {
    const context = audit();
    await expect(context.audit.ipHashOf(PRACTICE, '203.0.113.9')).resolves.toBe('hash');
    expect(context.keyedHash).toHaveBeenCalledWith(PRACTICE, 'ip-address', '203.0.113.9');
    await expect(context.audit.ipHashOf(PRACTICE, undefined)).resolves.toBeNull();
  });

  it('writes ids and a constant, at the time of the clock', async () => {
    const context = audit();
    await context.audit.record({
      userId: USER,
      action: 'patient.join',
      subjectId: 'patient-1',
      ipHash: 'hash',
    });
    expect(context.create).toHaveBeenCalledWith({
      data: {
        at: new Date(NOW.epochMilliseconds),
        actor: `user:${USER}`,
        action: 'patient.join',
        subjectId: 'patient-1',
        ipHash: 'hash',
      },
    });
  });
});
