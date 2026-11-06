import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** Generated folders, all gitignored; the next build or test run writes them again. */
const CACHE_FOLDERS = ['.turbo', '.next', 'dist', 'coverage', 'reports'];
const WEB_REPORT_FOLDERS = ['playwright-report', 'test-results'];

function workspaces(root: string): readonly string[] {
  return ['apps', 'packages'].flatMap((parent) => {
    const folder = path.join(root, parent);
    if (!existsSync(folder)) return [];
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(folder, entry.name));
  });
}

function existing(paths: readonly string[]): readonly string[] {
  return paths.filter((candidate) => existsSync(candidate));
}

/** The cache folders that exist, at the root and in every workspace. */
export function cachePaths(root: string): readonly string[] {
  return existing(
    [root, ...workspaces(root)].flatMap((folder) =>
      [...CACHE_FOLDERS, ...WEB_REPORT_FOLDERS].map((name) => path.join(folder, name)),
    ),
  );
}

/** The node_modules folders that exist, the root's last: the others link into it. */
export function nodeModulesPaths(root: string): readonly string[] {
  return existing([...workspaces(root), root].map((folder) => path.join(folder, 'node_modules')));
}

/** Deletes the folders. A path outside the root is a bug and stops before anything is deleted. */
export function removeFolders(root: string, folders: readonly string[]): void {
  for (const folder of folders) {
    const relative = path.relative(root, folder);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to delete outside the repository: ${folder}`);
    }
  }
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
}
