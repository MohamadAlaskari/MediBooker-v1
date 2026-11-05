import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the repo scripts: never crawl the packages (they test themselves).
    dir: 'scripts',
    include: ['**/*.test.ts'],
    // A run that finds no test files fails instead of passing silently.
    passWithNoTests: false,
    // A focused test (.only) fails every run, also outside CI, instead of skipping the others.
    allowOnly: false,
    // The scripts tests start Node and gitleaks processes, which is slow on Windows.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // A JUnit report for CI, written locally too: it is an output of the Turbo task, so a cached
    // run restores it.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
    // The gate of docs/architecture/06-testing.md §8 for the modules behind the hooks and the CI
    // secret scans; `test:root` runs with --coverage. The CLIs run in child processes, which V8
    // coverage does not see, so only scripts/lib counts. Its pure decisions need every branch.
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['scripts/lib/**/*.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
        'scripts/lib/{scan-range,shallow-clone}.ts': {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  },
});
