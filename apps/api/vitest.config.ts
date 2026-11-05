import { readFileSync } from 'node:fs';
import type { Options as SwcOptions } from '@swc/core';
import swc from 'unplugin-swc';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The single SWC configuration, shared with `nest build`, so tests compile exactly like
// production (decorator metadata included).
const swcrcText = readFileSync(new URL('./.swcrc', import.meta.url), 'utf8');
const swcrc = JSON.parse(swcrcText) as SwcOptions;

// Vitest 5 caches compiled modules on disk (fsModuleCache, on by default). Its key covers plugin
// names and this file, but not plugin options or the .swcrc read above, so a changed .swcrc would
// keep serving modules compiled with the old settings. This puts the .swcrc into the key.
const swcrcInCacheKey: Plugin = {
  name: 'medibooker:swcrc-cache-key',
  configureVitest({ defineCacheKeyGenerator }) {
    defineCacheKeyGenerator(() => swcrcText);
  },
};

export default defineConfig({
  plugins: [swc.vite({ tsconfigFile: false, ...swcrc }), swcrcInCacheKey],
  test: {
    // A run that finds no test files fails instead of passing silently.
    passWithNoTests: false,
    // A focused test (.only) fails every run, also outside CI, instead of skipping the others.
    allowOnly: false,
    // UTC+12:45 with DST: code that uses the host's zone fails on every machine.
    env: { TZ: 'Pacific/Chatham' },
    // Booting a Nest application in beforeAll is slow on Windows.
    hookTimeout: 30_000,
    // Coverage is configured at the root so that `--project unit --coverage` applies it.
    // `include` makes untested files count; test files are excluded automatically.
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.ts', '**/*.d.ts'],
      thresholds: {
        lines: 80,
        branches: 70,
        'src/**/*.rules.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/e2e/**/*.e2e-spec.ts'],
        },
      },
    ],
  },
});
