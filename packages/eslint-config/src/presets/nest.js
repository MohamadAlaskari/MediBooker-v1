import { defineConfig } from 'eslint/config';
import { importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';
import { plugin } from '../plugin/index.js';
import { TYPESCRIPT_FILES } from './file-patterns.js';

/**
 * Additions for the NestJS API, used together with base().
 * @returns {import('eslint/config').Config[]}
 */
export function nest() {
  return defineConfig(
    {
      name: 'medibooker/nest/typescript',
      files: TYPESCRIPT_FILES,
      plugins: { '@typescript-eslint': tseslint.plugin, 'import-x': importX },
      rules: {
        // Under ESM with decorators, an import cycle crashes at startup with a TDZ error.
        'import-x/no-cycle': 'error',
        // Nest modules are classes whose whole content is their decorator.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
    {
      // Domain code gets the time from the injected Clock. The Clock implementation lives
      // outside src/modules (for example src/common/clock); tests may read the clock.
      name: 'medibooker/nest/domain-clock',
      files: ['src/modules/**/*.ts'],
      ignores: ['**/*.spec.ts', '**/*.test.ts', '**/*-spec.ts'],
      plugins: { medibooker: plugin },
      rules: { 'medibooker/no-system-clock': 'error' },
    },
  );
}
