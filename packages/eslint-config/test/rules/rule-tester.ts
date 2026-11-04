import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

// RuleTester calls Mocha-style describe/it; run its cases as Vitest tests instead.
// RuleTester.itOnly falls back to it.only.
RuleTester.describe = describe;
RuleTester.it = it;

/**
 * Parses every case with the TypeScript parser and JSX enabled, so a case may use TypeScript
 * syntax and JSX like a .tsx file.
 */
export const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});
