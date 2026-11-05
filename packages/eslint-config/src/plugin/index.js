import packageJson from '../../package.json' with { type: 'json' };
import noDynamicLogMessage from './rules/no-dynamic-log-message.js';
import noHexColors from './rules/no-hex-colors.js';
import noLogBindings from './rules/no-log-bindings.js';
import noPhysicalDirectionClasses from './rules/no-physical-direction-classes.js';
import noSystemClock from './rules/no-system-clock.js';
import requireLoggerClassName from './rules/require-logger-class-name.js';

/**
 * The local `medibooker` plugin. Its rules guard the non-negotiables in CLAUDE.md: an injected
 * Clock in domain code, colours from design tokens, logical directions for RTL and logs without
 * personal data.
 * @type {import('eslint').ESLint.Plugin}
 */
export const plugin = {
  meta: {
    name: packageJson.name,
    version: packageJson.version,
    namespace: 'medibooker',
  },
  rules: {
    'no-dynamic-log-message': noDynamicLogMessage,
    'no-hex-colors': noHexColors,
    'no-log-bindings': noLogBindings,
    'no-physical-direction-classes': noPhysicalDirectionClasses,
    'no-system-clock': noSystemClock,
    'require-logger-class-name': requireLoggerClassName,
  },
};
