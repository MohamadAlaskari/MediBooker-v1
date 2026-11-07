import { base, plugin, react, vitest } from '@medibooker/eslint-config';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig(
  globalIgnores(['.next/', 'next-env.d.ts', 'playwright-report/', 'test-results/']),
  base({ tsconfigRootDir: import.meta.dirname }),
  react(),
  vitest(),
  {
    name: 'medibooker/web/next',
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // A page shows the time of its practice, from the API: never the clock of this server (03 §8).
    name: 'medibooker/web/practice-time',
    files: ['src/app/**', 'src/features/**', 'src/lib/format.ts'],
    ignores: ['**/*.test.*'],
    plugins: { medibooker: plugin },
    rules: { 'medibooker/no-system-clock': 'error' },
  },
  {
    // The package's own cn reads our type tokens as colours and drops them. A component from the
    // shadcn CLI imports it: change that import, and map the classes to tokens (08 X07).
    name: 'medibooker/web/class-merge',
    files: ['src/**'],
    ignores: ['src/lib/utils.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'cn', message: 'Import cn from @/lib/utils: it knows our type tokens.' }],
        },
      ],
    },
  },
  {
    // The one exception, with its reasons at the top of the file and in 03 §13. Its lifetime is one
    // of this browser, so this browser's clock is the right one.
    name: 'medibooker/web/booking-choice',
    files: ['src/features/portal/booking-choice.ts'],
    plugins: { medibooker: plugin },
    rules: { 'no-restricted-properties': 'off', 'medibooker/no-system-clock': 'off' },
  },
  {
    // The stub's practices hold colours as the API sends them: data, not styling.
    name: 'medibooker/web/e2e-data',
    files: ['e2e/support/practices.ts'],
    plugins: { medibooker: plugin },
    rules: { 'medibooker/no-hex-colors': 'off' },
  },
  {
    name: 'medibooker/web/next-conventions',
    // Next.js finds these files by name and calls their default exports.
    files: [
      'next.config.ts',
      'postcss.config.mjs',
      'playwright.config.ts',
      'vitest.config.ts',
      'src/app/**',
      'src/proxy.ts',
    ],
    rules: { 'import-x/no-default-export': 'off' },
  },
);
