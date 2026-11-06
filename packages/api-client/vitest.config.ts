import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // A run that finds no test files fails instead of passing silently.
    passWithNoTests: false,
    // A focused test (.only) fails every run, also outside CI, instead of skipping the others.
    allowOnly: false,
    // A JUnit report for CI, written locally too: an output of the Turbo task.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
    // `include` makes untested files count; test files are excluded automatically.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/index.ts', 'src/zod.ts', 'src/mocks.ts'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
