/**
 * The self-test of the secret scan (`node scripts/scan-secrets.ts self-test`): gitleaks must
 * report two secrets that are generated at run time, each with its own rule, and show neither.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { type GitleaksRun, SCAN_INSTALL_HINT, startFailure } from './gitleaks.ts';

/** A value generated for the self-test, the input that holds it and the rule that must report it. */
export interface SelfTestCase {
  ruleId: string;
  secret: string;
  input: string;
}

/** gitleaks' run on one case: its result, its output and its JSON report ('' when it wrote none). */
export interface SelfTestRun extends GitleaksRun {
  stdout: string;
  report: string;
}

/** The alphabet of gitleaks' aws-access-token rule after AKIA: A-Z and 2-7. */
const AWS_RULE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * The characters of the generated AWS key after AKIA: the rule's alphabet without L. gitleaks'
 * global allowlist skips a value that contains `false` (any case), and without L no key can
 * contain it. Derived, not written out: 31 characters assigned to a name with KEY in it are what
 * gitleaks' generic-api-key rule reports, so the staged scan and CI would block this file.
 */
export const AWS_KEY_ALPHABET = Array.from(AWS_RULE_ALPHABET)
  .filter((character) => character !== 'L')
  .join('');

/**
 * Two secrets, generated at run time and never written to a file or printed:
 * - an AWS access key id: AKIA and 16 different characters of AWS_KEY_ALPHABET. Different
 *   characters keep the Shannon entropy at 3.88 or more, above the rule's minimum of 3;
 *   independent draws fell below it in about one run in 5,000 (measured on 2026-11-05).
 * - `password = "<value>"`, whose value is a random group of four hex digits, three times, joined
 *   with hyphens. Its entropy is far too low for gitleaks' generic-api-key rule, so only
 *   medibooker-password-assignment can report it, and the hyphens keep it out of gitleaks' global
 *   allowlist of one repeated letter (such as aaaa-aaaa-aaaa without them).
 */
export function createSelfTestCases(): SelfTestCase[] {
  const awsKey = `AKIA${differentRandomCharacters(AWS_KEY_ALPHABET, 16)}`;
  const group = randomBytes(2).toString('hex');
  const password = [group, group, group].join('-');
  return [
    { ruleId: 'aws-access-token', secret: awsKey, input: `${awsKey}\n` },
    {
      ruleId: 'medibooker-password-assignment',
      secret: password,
      // Assembled at run time, so this file holds no assignment that the rule reports.
      input: `${['password', '=', `"${password}"`].join(' ')}\n`,
    },
  ];
}

/**
 * Why a self-test run failed, or undefined when it passed: gitleaks exits 1, reports the case
 * with its rule and no other, and shows the generated value nowhere, which proves --redact. The
 * reason never contains the value.
 */
export function selfTestFailure(testCase: SelfTestCase, run: SelfTestRun): string | undefined {
  // First, because Node sets no stdout and stderr when gitleaks did not start.
  const failure = startFailure(run, {
    missingBinary: SCAN_INSTALL_HINT,
    consequence: 'The self-test failed.',
  });
  if (failure !== undefined) {
    return failure;
  }
  const what = `the generated ${testCase.ruleId} value`;
  if (run.status !== 1) {
    return `gitleaks exited with ${String(run.status)} instead of 1 for ${what}.`;
  }
  if ([run.stdout, run.stderr, run.report].some((text) => text.includes(testCase.secret))) {
    return `gitleaks showed ${what}: --redact did not hide it.`;
  }
  const ruleIds = reportedRuleIds(run.report);
  if (ruleIds === undefined) {
    return `gitleaks wrote no JSON report of its findings for ${what}.`;
  }
  if (ruleIds.length === 0 || ruleIds.some((ruleId) => ruleId !== testCase.ruleId)) {
    const reported = ruleIds.length === 0 ? 'nothing' : ruleIds.join(', ');
    return `gitleaks reported ${reported} for ${what} instead of ${testCase.ruleId} alone.`;
  }
  return undefined;
}

/** `count` different characters of the alphabet in random order. */
function differentRandomCharacters(alphabet: string, count: number): string {
  const remaining = Array.from(alphabet);
  return Array.from({ length: count }, () =>
    remaining.splice(randomInt(remaining.length), 1).join(''),
  ).join('');
}

/** The RuleID of each finding in a gitleaks JSON report, or undefined when the text is none. */
function reportedRuleIds(report: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(report);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const ruleIds = parsed.map((finding: unknown) =>
    typeof finding === 'object' &&
    finding !== null &&
    'RuleID' in finding &&
    typeof finding.RuleID === 'string'
      ? finding.RuleID
      : undefined,
  );
  return ruleIds.every((ruleId) => ruleId !== undefined) ? ruleIds : undefined;
}
