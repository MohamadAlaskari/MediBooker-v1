import packageJson from '../../package.json' with { type: 'json' };
import noHexColors from './rules/no-hex-colors.js';
import noPhysicalDirectionClasses from './rules/no-physical-direction-classes.js';
import noSystemClock from './rules/no-system-clock.js';

/**
 * The local `medibooker` plugin. Its rules guard the non-negotiables in CLAUDE.md: an injected
 * Clock in domain code, colours from design tokens and logical directions for RTL.
 * @type {import('eslint').ESLint.Plugin}
 */
export const plugin = {
  meta: {
    name: packageJson.name,
    version: packageJson.version,
    namespace: 'medibooker',
  },
  rules: {
    'no-hex-colors': noHexColors,
    'no-physical-direction-classes': noPhysicalDirectionClasses,
    'no-system-clock': noSystemClock,
  },
};
