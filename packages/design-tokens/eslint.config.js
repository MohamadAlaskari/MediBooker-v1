import { base, vitest } from '@medibooker/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig(base({ tsconfigRootDir: import.meta.dirname }), vitest(), {
  name: 'medibooker/design-tokens/cli',
  files: ['scripts/build-tokens.ts'],
  // The command-line entry: it reports what it wrote.
  rules: { 'no-console': 'off' },
});
