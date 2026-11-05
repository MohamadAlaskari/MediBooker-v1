import { base, nest, plugin, vitest } from '@medibooker/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  base({ tsconfigRootDir: import.meta.dirname }),
  nest(),
  vitest(),
  {
    // The tenancy layer reads time only from the Clock, so its tests step a FixedClock (02 §5).
    name: 'medibooker/api/tenancy-clock',
    files: ['src/common/tenancy/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    plugins: { medibooker: plugin },
    rules: { 'medibooker/no-system-clock': 'error' },
  },
  {
    // main.ts parses the environment once; everything else receives the parsed Env (02 §3).
    name: 'medibooker/api/environment',
    files: ['src/**/*.ts'],
    ignores: ['src/main.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Only src/main.ts reads process.env; inject ENV instead (02 §3).',
        },
      ],
    },
  },
);
