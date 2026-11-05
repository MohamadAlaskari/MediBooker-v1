/**
 * Shared fixtures of the secret-scan tests: copies of the scripts beside a synthetic
 * .gitleaksignore, an environment without tools, and throw-away git repositories whose commits
 * hold secrets generated at run time. A generated value is never written to this repository and
 * never printed; a failing git call reports its arguments and git's stderr only.
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPTS_DIR = path.resolve(import.meta.dirname, '..');
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');

/** A synthetic commit-qualified fingerprint that is not pinned. */
export const THIRD_ENTRY =
  '0123456789abcdef0123456789abcdef01234567:apps/api/src/main.ts:generic-api-key:1';

/**
 * Copies the scripts (without tests) into <root>/scripts, with the repository's .gitleaks.toml, a
 * package.json that makes the scripts ES modules, and a .gitleaksignore of the given entries. The
 * copied CLIs take <root> as their repository root.
 */
export function copyScriptsInto(root: string, ignoreEntries: readonly string[]): void {
  cpSync(SCRIPTS_DIR, path.join(root, 'scripts'), {
    recursive: true,
    filter: (source) => !source.endsWith('.test.ts'),
  });
  copyFileSync(path.join(REPO_ROOT, '.gitleaks.toml'), path.join(root, '.gitleaks.toml'));
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(path.join(root, '.gitleaksignore'), `# synthetic\n${ignoreEntries.join('\n')}\n`);
}

/**
 * The given environment without PATH, which then names only `directory`: no gitleaks, no git.
 * Windows spells the variable Path, so every casing is dropped.
 */
export function environmentWithoutTools(
  environment: NodeJS.ProcessEnv,
  directory: string,
): NodeJS.ProcessEnv {
  return { ...withoutVariables(environment, (name) => name === 'PATH'), PATH: directory };
}

/**
 * The given environment without any GIT_* variable, so that a variable such as GIT_DIR or
 * GIT_INDEX_FILE, which git sets for a hook, cannot point git at another repository.
 */
export function environmentWithoutGitVariables(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withoutVariables(environment, (name) => name.startsWith('GIT_'));
}

/** A `password = "<value>"` line whose value (32 hex digits) is generated at run time. */
export function generatedPasswordAssignment(): { value: string; line: string } {
  const value = randomBytes(16).toString('hex');
  // Assembled at run time, so this file holds no assignment that the rule reports.
  return { value, line: `${['password', '=', `"${value}"`].join(' ')}\n` };
}

/**
 * A value of a random group of four hex digits, three times, joined with hyphens: too little
 * entropy for gitleaks' generic-api-key rule, so only medibooker-password-assignment reports it.
 */
export function generatedLowEntropyValue(): string {
  const group = randomBytes(2).toString('hex');
  return [group, group, group].join('-');
}

/** A throw-away git repository and the environment that every git and CLI call in it uses. */
export interface GitRepository {
  root: string;
  environment: NodeJS.ProcessEnv;
}

/**
 * A new repository in a new directory under `parent`, with branch main. Its git reads neither the
 * user's nor the system's configuration (no hooks, no signing, no line-ending conversion) and
 * commits with a synthetic identity. Every GIT_* variable of the caller is dropped.
 */
export function createRepository(parent: string): GitRepository {
  const root = mkdtempSync(path.join(parent, 'repo-'));
  const emptyConfig = path.join(parent, 'empty.gitconfig');
  writeFileSync(emptyConfig, '');
  const identity = { name: 'Synthetic Tester', email: 'synthetic-tester@example.test' };
  const environment: NodeJS.ProcessEnv = {
    ...environmentWithoutGitVariables(process.env),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
  const repository = { root, environment };
  git(repository, 'init', '--quiet', '--initial-branch=main');
  return repository;
}

/**
 * A clone of `origin` through the file:// protocol, which honours options such as --depth, in a
 * new directory under `parent`.
 */
export function cloneRepository(
  origin: GitRepository,
  parent: string,
  ...options: string[]
): GitRepository {
  const root = mkdtempSync(path.join(parent, 'clone-'));
  git(origin, 'clone', '--quiet', ...options, pathToFileURL(origin.root).href, root);
  return { root, environment: origin.environment };
}

/** Runs git in the repository and returns its trimmed output; throws when git fails. */
export function git(repository: GitRepository, ...args: string[]): string {
  const run = spawnSync('git', args, {
    cwd: repository.root,
    env: repository.environment,
    encoding: 'utf8',
  });
  if (run.error !== undefined || run.status !== 0) {
    const reason = run.error?.message ?? run.stderr;
    throw new Error(`git ${args.join(' ')} failed: ${reason}`);
  }
  return run.stdout.trim();
}

/** Writes the file (creating its directories), commits it, and returns the commit's id. */
export function commitFile(
  repository: GitRepository,
  file: string,
  content: string,
  message: string,
): string {
  const target = path.join(repository.root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  git(repository, 'add', '--', file);
  git(repository, 'commit', '--quiet', '--message', message);
  return git(repository, 'rev-parse', 'HEAD');
}

/** Deletes the file in a new commit and returns the commit's id. */
export function commitRemoval(repository: GitRepository, file: string, message: string): string {
  rmSync(path.join(repository.root, file));
  git(repository, 'add', '--all', '--', file);
  git(repository, 'commit', '--quiet', '--message', message);
  return git(repository, 'rev-parse', 'HEAD');
}

function withoutVariables(
  environment: NodeJS.ProcessEnv,
  isDropped: (upperCaseName: string) => boolean,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !isDropped(name.toUpperCase())),
  );
}
