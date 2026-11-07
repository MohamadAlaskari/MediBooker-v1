import path from 'node:path';
import { ESLint, type Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { base, nest, react, vitest } from '../src/index.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const ERROR_SEVERITY = 2;

type Fixture = 'base' | 'nest' | 'react' | 'vitest';
type Lint = (file: string) => Promise<Linter.LintMessage[]>;

/**
 * Lints real files under test/fixtures/<fixture>/ the way a package does: the presets are the
 * whole config (no eslint.config.* is read), and cwd and tsconfigRootDir are the fixture root.
 * It throws when a file would not really be linted (ignored, or not parsed, for example because
 * the fixture's tsconfig does not include it), so an empty result always means "no problems".
 */
function createFixtureLinter(
  fixture: Fixture,
  presets: (tsconfigRootDir: string) => Linter.Config[],
): Lint {
  const cwd = path.join(FIXTURES, fixture);
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: presets(cwd) });
  return async (file) => {
    if (await eslint.isPathIgnored(path.join(cwd, file))) {
      throw new Error(`The presets ignore ${fixture}/${file}, so it would not be linted`);
    }
    const [result] = await eslint.lintFiles([file]);
    if (result === undefined) {
      throw new Error(`ESLint returned no result for ${fixture}/${file}`);
    }
    const fatal = result.messages.find((message) => message.fatal === true);
    if (fatal !== undefined) {
      throw new Error(`ESLint could not parse ${fixture}/${file}: ${fatal.message}`);
    }
    return result.messages;
  };
}

/**
 * Returns the sorted rule IDs of the errors whose rule ID starts with the prefix. Other
 * type-aware rules may report on JSX without React types, so each test looks at the rules it is
 * about. Counting errors only also proves that the preset sets these rules to 'error'.
 */
function errorRuleIds(messages: Linter.LintMessage[], prefix: string): string[] {
  return messages
    .filter((message) => message.severity === ERROR_SEVERITY)
    .map((message) => message.ruleId ?? '')
    .filter((ruleId) => ruleId.startsWith(prefix))
    .sort();
}

function guardrailRuleIds(messages: Linter.LintMessage[]): string[] {
  return errorRuleIds(messages, 'medibooker/');
}

describe('base preset', () => {
  const lint = createFixtureLinter('base', (root) => base({ tsconfigRootDir: root }));

  it('base: clean.ts has no messages at all, so typed linting works from the path with spaces', async () => {
    expect(await lint('clean.ts')).toEqual([]);
  });

  it('base: the TypeScript import resolver maps ./self-import.js to self-import.ts', async () => {
    const ruleIds = (await lint('self-import.ts')).map((message) => message.ruleId);
    expect(ruleIds).toContain('import-x/no-self-import');
  });

  it('base: an eslint-disable comment that suppresses nothing is an error', async () => {
    expect(await lint('unused-disable-directive.ts')).toEqual([
      expect.objectContaining({
        ruleId: null,
        severity: ERROR_SEVERITY,
        message: expect.stringContaining('Unused eslint-disable directive') as unknown,
      }),
    ]);
  });
});

describe('react preset', () => {
  const lint = createFixtureLinter('react', (root) => [
    ...base({ tsconfigRootDir: root }),
    ...react(),
  ]);

  it('react: violations.tsx reports medibooker/no-hex-colors and medibooker/no-physical-direction-classes', async () => {
    expect(guardrailRuleIds(await lint('violations.tsx'))).toEqual([
      'medibooker/no-hex-colors',
      'medibooker/no-physical-direction-classes',
      'medibooker/no-physical-direction-classes',
    ]);
  });

  it('react: compliant.tsx (ms-4, text-start, var(--...), href="#add") has no medibooker/* messages', async () => {
    expect(guardrailRuleIds(await lint('compliant.tsx'))).toEqual([]);
  });

  it('react: parses JSX in a .jsx file and reports medibooker/no-physical-direction-classes', async () => {
    // A parse error would appear as a message without a rule ID.
    const ruleIds = (await lint('violations.jsx')).map((message) => message.ruleId);
    expect(ruleIds).toEqual(['medibooker/no-physical-direction-classes']);
  });

  it('react: web storage is refused, by name and through window or globalThis', async () => {
    const ruleIds = (await lint('web-storage.tsx')).map((message) => message.ruleId);
    expect(ruleIds.filter((id) => id === 'no-restricted-globals')).toHaveLength(2);
    expect(ruleIds.filter((id) => id === 'no-restricted-properties')).toHaveLength(4);
  });
});

describe('nest preset', () => {
  const lint = createFixtureLinter('nest', (root) => [
    ...base({ tsconfigRootDir: root }),
    ...nest(),
  ]);

  it('nest: reports medibooker/no-system-clock for new Date() and Date.now() under src/modules', async () => {
    expect(guardrailRuleIds(await lint('src/modules/booking/booking.rules.ts'))).toEqual([
      'medibooker/no-system-clock',
      'medibooker/no-system-clock',
    ]);
  });

  it('nest: medibooker/no-system-clock skips spec files under src/modules', async () => {
    expect(await lint('src/modules/booking/booking.rules.spec.ts')).toEqual([]);
  });

  it('nest: medibooker/no-system-clock skips the Clock implementation in src/common/clock', async () => {
    expect(await lint('src/common/clock/system-clock.ts')).toEqual([]);
  });

  it('nest: a decorated class keeps the value import that dependency injection needs', async () => {
    expect(await lint('src/modules/booking/booking.service.ts')).toEqual([]);
  });

  it('nest: a type used only as a type is still reported by consistent-type-imports', async () => {
    expect(
      errorRuleIds(await lint('src/common/clock/clock-reader.ts'), '@typescript-eslint/'),
    ).toEqual(['@typescript-eslint/consistent-type-imports']);
  });

  it('nest: reports each logging rule once for its violation under src/modules', async () => {
    expect(guardrailRuleIds(await lint('src/modules/booking/booking.notifier.ts'))).toEqual([
      'medibooker/no-dynamic-log-message',
      'medibooker/no-log-bindings',
      'medibooker/require-logger-class-name',
    ]);
  });

  it('nest: medibooker/no-dynamic-log-message and medibooker/require-logger-class-name cover spec files', async () => {
    expect(guardrailRuleIds(await lint('src/modules/booking/booking.notifier.spec.ts'))).toEqual([
      'medibooker/no-dynamic-log-message',
      'medibooker/require-logger-class-name',
    ]);
  });

  it('nest: medibooker/no-log-bindings skips src/common/logging, where bindings belong', async () => {
    expect(await lint('src/common/logging/bind-log-fields.ts')).toEqual([]);
  });
});

describe('vitest preset', () => {
  const lint = createFixtureLinter('vitest', (root) => [
    ...base({ tsconfigRootDir: root }),
    ...vitest(),
  ]);

  it('vitest: reports vitest/no-focused-tests and vitest/no-disabled-tests as errors', async () => {
    expect(errorRuleIds(await lint('violations.test.ts'), 'vitest/')).toEqual([
      'vitest/no-disabled-tests',
      'vitest/no-disabled-tests',
      'vitest/no-focused-tests',
    ]);
  });

  it('vitest: compliant.test.ts (non-null assertion, it.todo, it.skipIf) has no messages at all', async () => {
    expect(await lint('compliant.test.ts')).toEqual([]);
  });
});
