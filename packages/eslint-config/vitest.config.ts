import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // test/fixtures holds lint inputs for test/presets.test.ts, some named *.test.ts; not tests.
    exclude: [...configDefaults.exclude, 'test/fixtures/**'],
    // A run that finds no test files fails instead of passing silently.
    passWithNoTests: false,
    // A focused test (.only, also a RuleTester case with `only: true`) fails every run, also
    // outside CI, instead of skipping the others.
    allowOnly: false,
    // Each ESLint instance in test/presets.test.ts starts a TypeScript project service,
    // which takes several seconds on Windows.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // A JUnit report for CI, written locally too: it is an output of the Turbo task, so a cached
    // run restores it.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
    // The package gate of docs/architecture/06-testing.md §8; `test` runs with --coverage.
    // `include` makes untested files count.
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/**/*.js'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
