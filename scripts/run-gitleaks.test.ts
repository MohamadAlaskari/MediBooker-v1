import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INSTALL_HINT } from './lib/gitleaks.ts';

const SCRIPT = path.join(import.meta.dirname, 'run-gitleaks.ts');

let emptyDir = '';

beforeAll(() => {
  emptyDir = mkdtempSync(path.join(tmpdir(), 'medibooker-no-gitleaks-'));
});

afterAll(() => {
  rmSync(emptyDir, { recursive: true, force: true });
});

/** The current environment with an empty PATH. Windows spells the name Path, so drop every casing. */
function environmentWithoutGitleaks(): NodeJS.ProcessEnv {
  const entries = Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH');
  return { ...Object.fromEntries(entries), PATH: emptyDir };
}

describe('scripts/run-gitleaks.ts', () => {
  it('fails closed: exits 1 with the install hint when gitleaks is not on PATH', () => {
    const run = spawnSync(process.execPath, [SCRIPT], {
      cwd: emptyDir,
      env: environmentWithoutGitleaks(),
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(INSTALL_HINT);
  });
});
