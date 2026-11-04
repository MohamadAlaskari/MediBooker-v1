import { defineConfig, globalIgnores } from 'eslint/config';
import { base, vitest } from './src/index.js';

export default defineConfig(
  // Lint inputs for test/presets.test.ts; they break the rules on purpose.
  globalIgnores(['test/fixtures/**']),
  base({ tsconfigRootDir: import.meta.dirname }),
  vitest(),
);
