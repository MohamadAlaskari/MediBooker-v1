import { base, vitest } from '@medibooker/eslint-config';
import { defineConfig } from 'eslint/config';

// Lints the repo scripts and the root config files (`pnpm lint:root`). ESLint 10 looks up the
// config from each linted file's directory, so every package keeps its own eslint.config.js.
export default defineConfig(base({ tsconfigRootDir: import.meta.dirname }), vitest(), {
  name: 'medibooker/root/scripts',
  files: ['scripts/**/*.ts'],
  // The scripts are command-line tools: their messages go to the console.
  rules: { 'no-console': 'off' },
});
