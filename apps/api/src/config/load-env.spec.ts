import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { findWorkspaceRoot, loadWorkspaceEnv } from './load-env.js';

const MARKER = 'MEDIBOOKER_LOAD_ENV_TEST_MARKER';

// A workspace root and an app folder below it, in a path with a space and a dot, like the
// developer checkout.
let root: string;
let appDir: string;

beforeAll(() => {
  root = path.join(mkdtempSync(path.join(tmpdir(), 'medibooker load-env.')), 'repo v2.x');
  appDir = path.join(root, 'apps', 'api', 'dist');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
});

afterAll(() => {
  rmSync(path.dirname(root), { recursive: true, force: true });
});

afterEach(() => {
  Reflect.deleteProperty(process.env, MARKER);
  rmSync(path.join(root, '.env'), { force: true });
});

describe('findWorkspaceRoot', () => {
  it('finds the nearest parent with pnpm-workspace.yaml', () => {
    expect(findWorkspaceRoot(appDir)).toBe(root);
  });

  it('returns undefined outside a workspace', () => {
    expect(findWorkspaceRoot(path.dirname(root))).toBeUndefined();
  });
});

describe('loadWorkspaceEnv', () => {
  it('loads the root .env outside production', () => {
    writeFileSync(path.join(root, '.env'), `${MARKER}=loaded\n`);
    loadWorkspaceEnv(appDir, 'development');
    expect(process.env[MARKER]).toBe('loaded');
  });

  it('keeps a value that is already set in the environment', () => {
    process.env[MARKER] = 'from-shell';
    writeFileSync(path.join(root, '.env'), `${MARKER}=from-file\n`);
    loadWorkspaceEnv(appDir, 'development');
    expect(process.env[MARKER]).toBe('from-shell');
  });

  it('never loads a file in production', () => {
    writeFileSync(path.join(root, '.env'), `${MARKER}=loaded\n`);
    loadWorkspaceEnv(appDir, 'production');
    expect(process.env[MARKER]).toBeUndefined();
  });

  it('does nothing when the root has no .env', () => {
    expect(() => {
      loadWorkspaceEnv(appDir, undefined);
    }).not.toThrow();
    expect(process.env[MARKER]).toBeUndefined();
  });

  it('does nothing outside a workspace', () => {
    expect(() => {
      loadWorkspaceEnv(path.dirname(root), 'development');
    }).not.toThrow();
  });
});
