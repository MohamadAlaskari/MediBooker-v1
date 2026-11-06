import { base, vitest } from '@medibooker/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig(base({ tsconfigRootDir: import.meta.dirname }), vitest(), {
  name: 'medibooker/api-client/orval',
  files: ['orval.config.ts'],
  // Orval finds its configuration through the default export.
  rules: { 'import-x/no-default-export': 'off' },
});
