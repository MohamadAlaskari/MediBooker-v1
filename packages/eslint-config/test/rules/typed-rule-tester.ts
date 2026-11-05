import path from 'node:path';
import { type Rule, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

// RuleTester calls Mocha-style describe/it; run its cases as Vitest tests instead.
RuleTester.describe = describe;
RuleTester.it = it;

/** The project that types the cases: loggers.d.ts and globals.d.ts. */
const FIXTURE_ROOT = path.join(import.meta.dirname, '..', 'fixtures', 'logging');

/** Every case names this file; the project service types the case's code as its text. */
const CASE_FILE = path.join(FIXTURE_ROOT, 'file.ts');

const typedRuleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: FIXTURE_ROOT },
  },
});

type Tests = Parameters<RuleTester['run']>[2];

/**
 * Runs a rule's cases with type information, as base() lints a TypeScript file: each case is the
 * text of test/fixtures/logging/file.ts. Every error names its message ID and, where the message
 * has placeholders, their data.
 */
export function runTypedRuleTests(
  name: string,
  rule: Rule.RuleModule,
  { valid, invalid }: Pick<Tests, 'valid' | 'invalid'>,
): void {
  typedRuleTester.run(name, rule, {
    valid: valid.map((test) => ({
      ...(typeof test === 'string' ? { code: test } : test),
      filename: CASE_FILE,
    })),
    invalid: invalid.map((test) => ({ ...test, filename: CASE_FILE })),
    assertionOptions: { requireMessage: 'messageId', requireData: 'error' },
  });
}
