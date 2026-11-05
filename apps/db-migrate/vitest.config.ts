import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only, next to the code; the database paths are covered by the API's integration
    // project (apps/api/test/integration/tenancy, 01 §4).
    include: ['src/**/*.test.ts'],
    // A run that finds no test files fails instead of passing silently.
    passWithNoTests: false,
    // A focused test (.only) fails every run, also outside CI, instead of skipping the others.
    allowOnly: false,
    // UTC+12:45 with DST: code that uses the host's zone fails on every machine.
    env: { TZ: 'Pacific/Chatham' },
    // A JUnit report for CI, written locally too: it is an output of the Turbo task, so a cached
    // run restores it.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
  },
});
