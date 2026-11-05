import { describe, expect, it } from 'vitest';
import { BASE_BRANCH_REF, scanRange, type ScanEvent } from './scan-range.ts';

/** Synthetic object names. */
const PUSHED = 'a'.repeat(40);
const BEFORE = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const HEAD = 'd'.repeat(40);
const MERGE = 'e'.repeat(40);
const NOT_IN_CLONE = 'f'.repeat(40);
const SHA256_PUSHED = '1'.repeat(64);
const ZERO = '0'.repeat(40);

/** A clone with the given commits and refs; it records every revision it was asked about. */
function clone(...known: string[]) {
  const asked: string[] = [];
  const hasCommit = (revision: string): boolean => {
    asked.push(revision);
    return known.includes(revision);
  };
  return { hasCommit, asked };
}

function event(fields: Partial<ScanEvent>): ScanEvent {
  return { eventName: '', sha: '', before: '', baseSha: '', headSha: '', ...fields };
}

describe('scanRange', () => {
  describe('pull_request', () => {
    it('scans from the base to the head of the pull request', () => {
      const { hasCommit } = clone(MERGE, BASE, HEAD);
      const pullRequest = event({
        eventName: 'pull_request',
        sha: MERGE,
        baseSha: BASE,
        headSha: HEAD,
      });
      expect(scanRange(pullRequest, hasCommit)).toEqual({
        revisions: `${BASE}..${HEAD}`,
        reason: 'pull request: from its base to its head',
      });
    });

    it.each([
      ['the base is missing', { baseSha: '', headSha: HEAD }],
      ['the head is missing', { baseSha: BASE, headSha: '' }],
      ['the base is not in the clone', { baseSha: NOT_IN_CLONE, headSha: HEAD }],
      ['the head is not in the clone', { baseSha: BASE, headSha: NOT_IN_CLONE }],
    ])('scans the full history of the commit under test when %s', (_situation, shas) => {
      const { hasCommit } = clone(MERGE, BASE, HEAD);
      const range = scanRange(event({ eventName: 'pull_request', sha: MERGE, ...shas }), hasCommit);
      expect(range).toEqual({
        revisions: MERGE,
        reason: `pull request without a known base and head: the full history of ${MERGE}`,
      });
    });
  });

  describe('push', () => {
    it('scans from the previous commit of the branch to the pushed one', () => {
      const { hasCommit } = clone(PUSHED, BEFORE);
      const push = event({ eventName: 'push', sha: PUSHED, before: BEFORE });
      expect(scanRange(push, hasCommit)).toEqual({
        revisions: `${BEFORE}..${PUSHED}`,
        reason: 'push: from the previous commit of the branch to the pushed one',
      });
    });

    it.each([
      ['SHA-1', PUSHED, ZERO],
      ['SHA-256', SHA256_PUSHED, '0'.repeat(64)],
    ])(
      'scans a new branch or tag (%s, before is all zeros) from origin/v2-planning',
      (_objectFormat, sha, zero) => {
        const { hasCommit } = clone(sha, BASE_BRANCH_REF);
        const range = scanRange(event({ eventName: 'push', sha, before: zero }), hasCommit);
        expect(range.revisions).toBe(`origin/v2-planning..${sha}`);
        expect(range.reason).toBe(
          'new branch or tag: the commits that origin/v2-planning does not have',
        );
      },
    );

    it('scans the full history of a new branch or tag when origin/v2-planning is missing', () => {
      const { hasCommit } = clone(PUSHED);
      const range = scanRange(event({ eventName: 'push', sha: PUSHED, before: ZERO }), hasCommit);
      expect(range).toEqual({
        revisions: PUSHED,
        reason: `new branch or tag without origin/v2-planning: the full history of ${PUSHED}`,
      });
    });

    it.each([
      ['before is not in the clone (a force push)', NOT_IN_CLONE],
      ['before is empty (a missing input, not a new branch)', ''],
      ['before is no object name', 'HEAD~1'],
    ])('scans the full history of the pushed commit when %s', (_situation, before) => {
      const { hasCommit } = clone(PUSHED, BEFORE, BASE_BRANCH_REF);
      const range = scanRange(event({ eventName: 'push', sha: PUSHED, before }), hasCommit);
      expect(range).toEqual({
        revisions: PUSHED,
        reason: `push whose previous commit is missing or not in the clone (a force push): the full history of ${PUSHED}`,
      });
    });

    it('scans the full history of HEAD when the pushed commit is missing', () => {
      const { hasCommit } = clone(BEFORE);
      const range = scanRange(event({ eventName: 'push', sha: '', before: BEFORE }), hasCommit);
      expect(range).toEqual({
        revisions: 'HEAD',
        reason: 'push without a known pushed commit: the full history of HEAD',
      });
    });

    it('scans the full history of HEAD when the pushed commit is not in the clone', () => {
      const { hasCommit } = clone(BEFORE);
      const range = scanRange(
        event({ eventName: 'push', sha: NOT_IN_CLONE, before: BEFORE }),
        hasCommit,
      );
      expect(range.revisions).toBe('HEAD');
    });
  });

  it.each(['workflow_dispatch', 'schedule', 'merge_group'])(
    'scans the full history of the commit under test on a %s event',
    (eventName) => {
      const { hasCommit } = clone(PUSHED, BEFORE, BASE_BRANCH_REF);
      const range = scanRange(event({ eventName, sha: PUSHED, before: BEFORE }), hasCommit);
      expect(range).toEqual({
        revisions: PUSHED,
        reason: `${eventName} event: the full history of ${PUSHED}`,
      });
    },
  );

  it('scans the full history of HEAD when nothing is known', () => {
    const { hasCommit } = clone();
    expect(scanRange(event({}), hasCommit)).toEqual({
      revisions: 'HEAD',
      reason: 'no event name: the full history of HEAD',
    });
  });

  it('never passes an input that is no object name to git, such as an option', () => {
    const { hasCommit, asked } = clone(PUSHED);
    const option = '--output=stolen.txt';
    const pushes = [
      event({ eventName: 'push', sha: option, before: option }),
      event({ eventName: 'push', sha: PUSHED, before: option }),
      event({ eventName: 'pull_request', sha: option, baseSha: option, headSha: option }),
    ];
    const ranges = pushes.map((push) => scanRange(push, hasCommit));
    expect(asked).not.toContain(option);
    expect(ranges.map((range) => range.revisions)).toEqual(['HEAD', PUSHED, 'HEAD']);
  });
});
