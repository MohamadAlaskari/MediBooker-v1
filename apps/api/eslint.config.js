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
    // main.ts and each command of cli/ parse the environment once; everything else receives the
    // parsed Env (02 §3).
    name: 'medibooker/api/environment',
    files: ['src/**/*.ts'],
    ignores: ['src/main.ts', 'src/cli/**', '**/*.spec.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Only src/main.ts and src/cli read process.env; inject ENV instead (02 §3).',
        },
      ],
    },
  },
  {
    // A provider's SDK stays behind the port, so another provider is one more adapter and no change
    // to a feature (ADR 0015). test/lint/storage-rules.canary.ts proves that this rule reports.
    name: 'medibooker/api/storage-provider',
    files: ['**/*.ts'],
    ignores: ['src/modules/storage/azure/**', 'test/integration/storage/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@azure/*'],
              message:
                'Only src/modules/storage/azure and its tests import a provider SDK; use the port ObjectStorage (ADR 0015).',
            },
          ],
        },
      ],
    },
  },
);
