import { describe, expect, it } from 'vitest';
import { SCAN_INSTALL_HINT } from './gitleaks.ts';
import {
  AWS_KEY_ALPHABET,
  createSelfTestCases,
  selfTestFailure,
  type SelfTestCase,
  type SelfTestRun,
} from './secret-self-test.ts';

function spawnError(code: string): Error {
  return Object.assign(new Error(`spawnSync gitleaks ${code}`), { code });
}

describe('AWS_KEY_ALPHABET', () => {
  it("is aws-access-token's alphabet A-Z2-7 without L, so no key can contain FALSE", () => {
    // gitleaks' global allowlist skips a value that contains false in any case.
    const ruleAlphabet = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    expect(new Set(AWS_KEY_ALPHABET)).toEqual(
      new Set(ruleAlphabet.filter((character) => character !== 'L')),
    );
    expect(AWS_KEY_ALPHABET).toHaveLength(31);
  });
});

describe('createSelfTestCases', () => {
  const [awsCase, passwordCase] = createSelfTestCases();

  it('generates an AWS access key id: AKIA and 16 different characters of AWS_KEY_ALPHABET', () => {
    expect(awsCase?.ruleId).toBe('aws-access-token');
    expect(awsCase?.secret).toMatch(/^AKIA[A-Z2-7]{16}$/);
    const suffix = Array.from(awsCase?.secret.slice(4) ?? '');
    expect(suffix.every((character) => AWS_KEY_ALPHABET.includes(character))).toBe(true);
    expect(new Set(suffix).size).toBe(16);
    expect(awsCase?.input).toBe(`${awsCase?.secret ?? ''}\n`);
  });

  it('generates a password assignment with a random group of four hex digits, three times', () => {
    expect(passwordCase?.ruleId).toBe('medibooker-password-assignment');
    const [group] = passwordCase?.secret.split('-') ?? [];
    expect(group).toMatch(/^[0-9a-f]{4}$/);
    expect(passwordCase?.secret).toBe([group, group, group].join('-'));
    // Compared in parts, so that this file holds no assignment that the rule reports.
    const [key, operator, value] = passwordCase?.input.trimEnd().split(' ') ?? [];
    expect([key, operator, value]).toEqual(['password', '=', `"${passwordCase?.secret ?? ''}"`]);
    expect(passwordCase?.input.endsWith('\n')).toBe(true);
  });

  it('generates new values on every call', () => {
    const [nextAwsCase] = createSelfTestCases();
    expect(nextAwsCase?.secret).not.toBe(awsCase?.secret);
  });
});

describe('selfTestFailure', () => {
  /** A synthetic marker stands for the generated value; it is no secret. */
  const MARKER = 'synthetic-self-test-marker';
  const testCase: SelfTestCase = {
    ruleId: 'aws-access-token',
    secret: MARKER,
    input: `${MARKER}\n`,
  };
  // Only the field that the check reads. A key such as Secret with a quoted value would be
  // reported by the repository's own rule.
  const report = (...ruleIds: string[]): string =>
    JSON.stringify(ruleIds.map((ruleId) => ({ RuleID: ruleId })));
  const passing: SelfTestRun = {
    status: 1,
    signal: null,
    stdout: 'Finding:     REDACTED\nRuleID:      aws-access-token\n',
    stderr: '7:16AM WRN leaks found: 1\n',
    report: report('aws-access-token'),
  };

  it('passes when gitleaks exits 1 and reports the case with its rule alone, redacted', () => {
    expect(selfTestFailure(testCase, passing)).toBeUndefined();
  });

  it.each([
    [
      'gitleaks is missing',
      { ...passing, error: spawnError('ENOENT'), status: null },
      SCAN_INSTALL_HINT,
    ],
    [
      'gitleaks cannot start',
      { ...passing, error: spawnError('EACCES'), status: null },
      'gitleaks could not start (spawnSync gitleaks EACCES). The self-test failed.',
    ],
    [
      'gitleaks is stopped by a signal',
      { ...passing, status: null, signal: 'SIGTERM' as const },
      'gitleaks was stopped by SIGTERM. The self-test failed.',
    ],
    [
      'gitleaks exits 0',
      { ...passing, status: 0 },
      'gitleaks exited with 0 instead of 1 for the generated aws-access-token value.',
    ],
    [
      'gitleaks exits 2',
      { ...passing, status: 2 },
      'gitleaks exited with 2 instead of 1 for the generated aws-access-token value.',
    ],
    [
      'the printed finding shows the value',
      { ...passing, stdout: `Finding: ${MARKER}\n` },
      'gitleaks showed the generated aws-access-token value: --redact did not hide it.',
    ],
    [
      'the log shows the value',
      { ...passing, stderr: `7:16AM DBG finding=${MARKER}\n` },
      'gitleaks showed the generated aws-access-token value: --redact did not hide it.',
    ],
    [
      'the report shows the value',
      { ...passing, report: JSON.stringify([{ RuleID: 'aws-access-token', Match: MARKER }]) },
      'gitleaks showed the generated aws-access-token value: --redact did not hide it.',
    ],
    [
      'there is no report',
      { ...passing, report: '' },
      'gitleaks wrote no JSON report of its findings for the generated aws-access-token value.',
    ],
    [
      'the report is not a list of findings',
      { ...passing, report: JSON.stringify({ RuleID: 'aws-access-token' }) },
      'gitleaks wrote no JSON report of its findings for the generated aws-access-token value.',
    ],
    [
      'the report holds no finding',
      { ...passing, report: report() },
      'gitleaks reported nothing for the generated aws-access-token value instead of aws-access-token alone.',
    ],
    [
      'another rule reports it too',
      { ...passing, report: report('aws-access-token', 'generic-api-key') },
      'gitleaks reported aws-access-token, generic-api-key for the generated aws-access-token value instead of aws-access-token alone.',
    ],
  ] satisfies [string, SelfTestRun, string][])('fails when %s', (_name, run, reason) => {
    const failure = selfTestFailure(testCase, run);
    expect(failure).toBe(reason);
    expect(failure).not.toContain(MARKER);
  });
});
