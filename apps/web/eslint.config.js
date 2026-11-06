import { base, react, vitest } from '@medibooker/eslint-config';
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
    name: 'medibooker/web/next-conventions',
    // Next.js finds these files by name and calls their default exports.
    files: [
      'next.config.ts',
      'playwright.config.ts',
      'vitest.config.ts',
      'src/app/**',
      'src/proxy.ts',
    ],
    rules: { 'import-x/no-default-export': 'off' },
  },
);
