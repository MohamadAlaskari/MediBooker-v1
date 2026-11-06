import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cachePaths, nodeModulesPaths, removeFolders } from './clean.ts';

let root: string;

function folder(...segments: readonly string[]): string {
  const target = path.join(root, ...segments);
  mkdirSync(target, { recursive: true });
  return target;
}

function relativeTo(paths: readonly string[]): readonly string[] {
  return paths.map((candidate) => path.relative(root, candidate).replaceAll('\\', '/')).sort();
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'medibooker-clean-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('cachePaths', () => {
  it('finds the generated folders of the root and of every workspace', () => {
    folder('.turbo');
    folder('coverage');
    folder('apps', 'web', '.next');
    folder('apps', 'web', 'playwright-report');
    folder('apps', 'api', 'dist');
    folder('packages', 'i18n', 'reports');
    folder('apps', 'api', 'src');
    expect(relativeTo(cachePaths(root))).toEqual([
      '.turbo',
      'apps/api/dist',
      'apps/web/.next',
      'apps/web/playwright-report',
      'coverage',
      'packages/i18n/reports',
    ]);
  });

  it('finds nothing in an empty repository', () => {
    expect(cachePaths(root)).toEqual([]);
  });

  it('ignores a file between the workspaces', () => {
    folder('apps');
    writeFileSync(path.join(root, 'apps', 'README.md'), 'text');
    expect(cachePaths(root)).toEqual([]);
  });
});

describe('nodeModulesPaths', () => {
  it('lists the root last, because the others link into it', () => {
    folder('node_modules');
    folder('apps', 'api', 'node_modules');
    folder('packages', 'i18n', 'node_modules');
    const paths = nodeModulesPaths(root);
    expect(relativeTo(paths)).toEqual([
      'apps/api/node_modules',
      'node_modules',
      'packages/i18n/node_modules',
    ]);
    expect(paths.at(-1)).toBe(path.join(root, 'node_modules'));
  });
});

describe('removeFolders', () => {
  it('deletes the folders and leaves the rest', () => {
    const cache = folder('.turbo');
    const source = folder('apps', 'api', 'src');
    writeFileSync(path.join(cache, 'file'), 'text');
    removeFolders(root, [cache]);
    expect(existsSync(cache)).toBe(false);
    expect(existsSync(source)).toBe(true);
  });

  it('refuses a path outside the repository before deleting anything', () => {
    const inside = folder('.turbo');
    const outside = path.join(root, '..', 'elsewhere');
    expect(() => {
      removeFolders(root, [inside, outside]);
    }).toThrow(/outside the repository/);
    expect(existsSync(inside)).toBe(true);
  });

  it('refuses the repository itself', () => {
    expect(() => {
      removeFolders(root, [root]);
    }).toThrow(/outside the repository/);
    expect(existsSync(root)).toBe(true);
  });
});
