/**
 * ESLint 10 flat-config presets for MediBooker v2.
 *
 * ESLint 10 looks up the config from each linted file's directory, so every package has its own
 * eslint.config.js that calls the presets it needs:
 *
 *   import { defineConfig } from 'eslint/config';
 *   import { base, nest, vitest } from '@medibooker/eslint-config';
 *
 *   export default defineConfig(base({ tsconfigRootDir: import.meta.dirname }), nest(), vitest());
 */
export { base } from './presets/base.js';
export { nest } from './presets/nest.js';
export { react } from './presets/react.js';
export { vitest } from './presets/vitest.js';
export { plugin } from './plugin/index.js';
