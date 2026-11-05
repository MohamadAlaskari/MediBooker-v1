/**
 * The commits that the pushed-range secret scan covers (`node scripts/scan-secrets.ts range`),
 * decided from the GitHub event (ADR 0009). A missing or unknown input never skips the scan: it
 * falls back to the full history of the commit under test.
 */

/**
 * A new branch or tag is compared with this branch: its commits were scanned when they were
 * pushed there (ADR 0009). The CI checkout fetches it with `fetch-depth: 0`.
 */
export const BASE_BRANCH_REF = 'origin/v2-planning';

/** The inputs of the scan as the workflow passes them; an absent value is ''. */
export interface ScanEvent {
  /** GITHUB_EVENT_NAME, set by GitHub Actions. */
  eventName: string;
  /** GITHUB_SHA, set by GitHub Actions: the commit under test. */
  sha: string;
  /** SCAN_BEFORE: `github.event.before` of a push, all zeros for a new branch or tag. */
  before: string;
  /** SCAN_BASE_SHA: `github.event.pull_request.base.sha`. */
  baseSha: string;
  /** SCAN_HEAD_SHA: `github.event.pull_request.head.sha`. */
  headSha: string;
}

/** The revisions that gitleaks scans (`git log <revisions>`) and why, for the log. */
export interface ScanRange {
  revisions: string;
  reason: string;
}

/** Whether the clone has the commit; the CLI asks read-only `git cat-file -e <rev>^{commit}`. */
export type HasCommit = (revision: string) => boolean;

/**
 * A full object name. Only such a value reaches git, so an input such as `--output=<file>` can
 * never become a git option.
 */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** `before` of a push that created the branch or tag. */
const NEW_REF_BEFORE = /^(?:0{40}|0{64})$/;

export function scanRange(event: ScanEvent, hasCommit: HasCommit): ScanRange {
  const isKnownCommit = (value: string): boolean => OBJECT_ID.test(value) && hasCommit(value);
  const tip = isKnownCommit(event.sha) ? event.sha : 'HEAD';
  const fullHistory = (situation: string): ScanRange => ({
    revisions: tip,
    reason: `${situation}: the full history of ${tip}`,
  });

  if (event.eventName === 'pull_request') {
    return isKnownCommit(event.baseSha) && isKnownCommit(event.headSha)
      ? {
          revisions: `${event.baseSha}..${event.headSha}`,
          reason: 'pull request: from its base to its head',
        }
      : fullHistory('pull request without a known base and head');
  }
  if (event.eventName !== 'push') {
    return fullHistory(event.eventName === '' ? 'no event name' : `${event.eventName} event`);
  }
  if (!isKnownCommit(event.sha)) {
    return fullHistory('push without a known pushed commit');
  }
  if (NEW_REF_BEFORE.test(event.before)) {
    return hasCommit(BASE_BRANCH_REF)
      ? {
          revisions: `${BASE_BRANCH_REF}..${event.sha}`,
          reason: `new branch or tag: the commits that ${BASE_BRANCH_REF} does not have`,
        }
      : fullHistory(`new branch or tag without ${BASE_BRANCH_REF}`);
  }
  // An empty `before` is a missing input, not a new branch: comparing with BASE_BRANCH_REF would
  // scan nothing on a push to that branch itself.
  return isKnownCommit(event.before)
    ? {
        revisions: `${event.before}..${event.sha}`,
        reason: 'push: from the previous commit of the branch to the pushed one',
      }
    : fullHistory('push whose previous commit is missing or not in the clone (a force push)');
}
