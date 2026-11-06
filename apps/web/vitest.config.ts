import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The app's tsconfig preserves JSX for Next; the tests compile it themselves.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // A run that finds no test files fails instead of passing silently.
    passWithNoTests: false,
    // A focused test (.only) fails every run, also outside CI, instead of skipping the others.
    allowOnly: false,
    // UTC+12:45 with DST: code that uses the host's zone fails on every machine.
    env: { TZ: 'Pacific/Chatham' },
    // A JUnit report for CI, written locally too: an output of the Turbo task.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
  },
});
