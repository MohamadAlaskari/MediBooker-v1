import { defineConfig } from 'eslint/config';
import { plugin } from '../plugin/index.js';

/**
 * Guardrails for React UI code, used together with base(). The web and mobile apps extend it
 * with their framework rules.
 * @returns {import('eslint/config').Config[]}
 */
export function react() {
  return defineConfig(
    {
      name: 'medibooker/react/guardrails',
      files: ['**/*.{ts,tsx,js,jsx}'],
      ignores: ['**/*.{test,spec}.{ts,tsx,js,jsx}'],
      plugins: { medibooker: plugin },
      rules: {
        'medibooker/no-hex-colors': 'error',
        'medibooker/no-physical-direction-classes': 'error',
      },
    },
    {
      name: 'medibooker/react/jsx-in-javascript',
      files: ['**/*.{js,jsx}'],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    },
  );
}
