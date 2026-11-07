import { defineConfig } from 'eslint/config';
import { plugin } from '../plugin/index.js';

const NO_WEB_STORAGE =
  'Web storage outlives a sign-out and is bound to nobody: keep state on the server (03 §13).';

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
        'no-restricted-globals': [
          'error',
          { name: 'localStorage', message: NO_WEB_STORAGE },
          { name: 'sessionStorage', message: NO_WEB_STORAGE },
        ],
        'no-restricted-properties': [
          'error',
          { object: 'window', property: 'localStorage', message: NO_WEB_STORAGE },
          { object: 'window', property: 'sessionStorage', message: NO_WEB_STORAGE },
          { object: 'globalThis', property: 'localStorage', message: NO_WEB_STORAGE },
          { object: 'globalThis', property: 'sessionStorage', message: NO_WEB_STORAGE },
        ],
      },
    },
    {
      name: 'medibooker/react/jsx-in-javascript',
      files: ['**/*.{js,jsx}'],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    },
  );
}
