import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { JAVASCRIPT_FILES, TYPESCRIPT_FILES } from './file-patterns.js';

/** Build output, caches and generated code are never linted. */
const IGNORED_PATTERNS = [
  '**/dist/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/generated/**',
  '**/.next/**',
  '**/.expo/**',
];

/**
 * The preset for every package: ESLint and strict, type-aware typescript-eslint rules, import
 * hygiene and, last, eslint-config-prettier. The guardrails of the local plugin come with the
 * nest() and react() presets.
 * @param {{ tsconfigRootDir: string }} options the package root, usually `import.meta.dirname`
 * @returns {import('eslint/config').Config[]}
 */
export function base({ tsconfigRootDir }) {
  return defineConfig(
    globalIgnores(IGNORED_PATTERNS, 'medibooker/base/ignores'),
    {
      // A disable comment that no longer suppresses anything fails lint instead of piling up.
      name: 'medibooker/base/linter-options',
      linterOptions: { reportUnusedDisableDirectives: 'error' },
    },
    js.configs.recommended,
    {
      name: 'medibooker/base/typescript',
      files: TYPESCRIPT_FILES,
      extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
      },
    },
    {
      name: 'medibooker/base/javascript',
      files: JAVASCRIPT_FILES,
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
    },
    {
      name: 'medibooker/base/imports',
      plugins: { 'import-x': importX },
      settings: { 'import-x/resolver-next': [createTypeScriptImportResolver()] },
      rules: {
        'import-x/no-duplicates': 'error',
        'import-x/no-self-import': 'error',
      },
    },
    {
      name: 'medibooker/base/rules',
      rules: {
        eqeqeq: 'error',
        'no-console': 'error',
      },
    },
    prettier,
  );
}
