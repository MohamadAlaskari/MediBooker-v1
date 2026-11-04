import vitestPlugin from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';

/**
 * Rules for Vitest test files, used together with base().
 * @returns {import('eslint/config').Config[]}
 */
export function vitest() {
  return defineConfig({
    name: 'medibooker/vitest',
    files: ['**/*.{test,spec}.{ts,tsx}', '**/*-spec.ts'],
    extends: [vitestPlugin.configs.recommended],
    rules: {
      // A committed .only or .skip silently drops tests from every run, so both fail lint
      // (recommended warns on .skip). Use it.todo() for a planned test; a conditional
      // it.skipIf(...) for an environment-dependent test stays allowed.
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      // A test may assert a value with `!`: if the value is missing, the test fails as it should.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  });
}
