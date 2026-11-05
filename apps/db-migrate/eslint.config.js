import { base, vitest } from '@medibooker/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig(base({ tsconfigRootDir: import.meta.dirname }), vitest(), {
  name: 'medibooker/db-migrate/cli',
  files: ['src/cli.ts'],
  // The command-line entry: its output goes to the console (JSON lines only, 02 §6).
  rules: { 'no-console': 'off' },
});
