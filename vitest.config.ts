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
  },
});
