/**
 * Checks the rules of docs/architecture/07-docker-ci-cd.md §3 on every workflow and composite
 * action of .github, and that the custom managers of renovate.json still match the lines they
 * move. actionlint checks syntax and expressions; these checks hold the rules it does not know,
 * such as ci-ok needing every job, and run on every push without Docker.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const GITHUB_DIR = path.join(REPO_ROOT, '.github');

type Mapping = Record<string, unknown>;

interface YamlFile {
  /** The path relative to the repository root, with forward slashes. */
  name: string;
  text: string;
  document: Mapping;
}

function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asMapping(value: unknown, where: string): Mapping {
  if (!isMapping(value)) {
    throw new Error(`${where} is not a mapping`);
  }
  return value;
}

function asList(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${where} is not a list`);
  }
  return value;
}

function readText(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readYaml(relativePath: string): YamlFile {
  const text = readText(relativePath);
  return { name: relativePath, text, document: asMapping(parse(text), relativePath) };
}

const workflows = readdirSync(path.join(GITHUB_DIR, 'workflows'))
  .filter((name) => name.endsWith('.yml'))
  .sort()
  .map((name) => readYaml(`.github/workflows/${name}`));

const actions = readdirSync(path.join(GITHUB_DIR, 'actions'))
  .sort()
  .map((name) => readYaml(`.github/actions/${name}/action.yml`));

/** A job of a workflow, with its id. */
interface Job {
  id: string;
  job: Mapping;
  steps: Mapping[];
}

function jobsOf(workflow: YamlFile): Job[] {
  const jobs = asMapping(workflow.document.jobs, `${workflow.name}: jobs`);
  return Object.entries(jobs).map(([id, value]) => {
    const job = asMapping(value, `${workflow.name}: ${id}`);
    const steps = asList(job.steps, `${workflow.name}: ${id}.steps`).map((step, index) =>
      asMapping(step, `${workflow.name}: ${id}.steps[${String(index)}]`),
    );
    return { id, job, steps };
  });
}

function stepsOf(action: YamlFile): Mapping[] {
  const runs = asMapping(action.document.runs, `${action.name}: runs`);
  return asList(runs.steps, `${action.name}: runs.steps`).map((step, index) =>
    asMapping(step, `${action.name}: runs.steps[${String(index)}]`),
  );
}

const allJobs = workflows.flatMap((workflow) =>
  jobsOf(workflow).map((job) => ({ ...job, where: `${workflow.name}: ${job.id}` })),
);

const allSteps = [
  ...allJobs.flatMap(({ steps, where }) => steps.map((step) => ({ step, where }))),
  ...actions.flatMap((action) => stepsOf(action).map((step) => ({ step, where: action.name }))),
];

function usesOf(step: Mapping): string | undefined {
  return typeof step.uses === 'string' ? step.uses : undefined;
}

function runOf(step: Mapping): string {
  return typeof step.run === 'string' ? step.run : '';
}

function isCheckout(step: Mapping): boolean {
  return usesOf(step)?.startsWith('actions/checkout@') === true;
}

describe('.github', () => {
  it('holds the workflows and composite actions that these checks read', () => {
    expect(workflows.map((workflow) => workflow.name)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/codeql.yml',
      '.github/workflows/scheduled.yml',
    ]);
    expect(actions.map((action) => action.name)).toEqual([
      '.github/actions/gitleaks/action.yml',
      '.github/actions/setup/action.yml',
    ]);
  });

  it('pins every action to a full commit SHA with its version, or uses a local one', () => {
    const pinned = /^uses: [\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;
    const lines = [...workflows, ...actions].flatMap((file) =>
      file.text
        .split('\n')
        .map((line) => line.trim().replace(/^- /, ''))
        .filter((line) => line.startsWith('uses:'))
        .map((line) => ({ line, where: file.name })),
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const { line, where } of lines) {
      expect(pinned.test(line) || /^uses: \.\/[\w./-]+$/.test(line), `${where}: ${line}`).toBe(
        true,
      );
    }
  });

  it('runs no container step (docker://)', () => {
    for (const { step, where } of allSteps) {
      expect(usesOf(step)?.startsWith('docker://') ?? false, `${where}: uses`).toBe(false);
    }
  });

  it('pins every *_IMAGE by tag and digest', () => {
    const imageLine = /^\s*([A-Z][A-Z0-9_]*_IMAGE): (\S+)$/gm;
    const pinned = /^[a-z0-9][a-z0-9./_-]*:[A-Za-z0-9][A-Za-z0-9._-]*@sha256:[0-9a-f]{64}$/;
    const images = workflows.flatMap((workflow) => [...workflow.text.matchAll(imageLine)]);
    expect(images.map((match) => match[1])).toEqual(['ACTIONLINT_IMAGE', 'RENOVATE_IMAGE']);
    for (const [line, , image] of images) {
      expect(pinned.test(image ?? ''), `ci.yml: ${line}`).toBe(true);
    }
  });

  it('checks out without persisted credentials everywhere', () => {
    const checkouts = allSteps.filter(({ step }) => isCheckout(step));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const { step, where } of checkouts) {
      const options = asMapping(step.with, `${where}: checkout.with`);
      expect(options['persist-credentials'], `${where}: persist-credentials`).toBe(false);
    }
  });
});

describe.each(workflows)('$name', (workflow) => {
  it('grants contents: read at the top level', () => {
    expect(workflow.document.permissions).toEqual({ contents: 'read' });
  });

  it('has no pull_request_target trigger', () => {
    expect(Object.keys(asMapping(workflow.document.on, `${workflow.name}: on`))).not.toContain(
      'pull_request_target',
    );
  });

  it.each(jobsOf(workflow))('$id: runs on ubuntu-26.04 with a timeout', ({ job }) => {
    expect(job['runs-on']).toBe('ubuntu-26.04');
    expect(job['timeout-minutes']).toEqual(expect.any(Number));
  });
});

describe('ci.yml', () => {
  const [ci] = workflows.filter((workflow) => workflow.name === '.github/workflows/ci.yml');
  const jobs = ci === undefined ? [] : jobsOf(ci);
  const ciOk = jobs.find((job) => job.id === 'ci-ok')?.job ?? {};

  it('ci-ok needs every other job, so a new job cannot fail unnoticed', () => {
    const others = jobs.map((job) => job.id).filter((id) => id !== 'ci-ok');
    expect([...asList(ciOk.needs, 'ci-ok.needs')].sort()).toEqual(others.sort());
  });

  it('ci-ok runs always, under its own name, without permissions', () => {
    expect(ciOk.name).toBe('ci-ok');
    expect(ciOk.if).toMatch(/^\$\{\{ always\(\) \}\}$/);
    expect(ciOk.permissions).toEqual({});
  });

  it('a job that references a secret runs no repository or package code', () => {
    const withSecrets = allJobs.filter(({ job }) => /\$\{\{\s*secrets\./.test(JSON.stringify(job)));
    expect(withSecrets.map(({ where }) => where)).toEqual([
      '.github/workflows/ci.yml: config-lint',
    ]);
    for (const { steps, where } of withSecrets) {
      for (const step of steps) {
        expect(usesOf(step)?.startsWith('./') ?? false, `${where}: uses`).toBe(false);
        expect(runOf(step), `${where}: run`).not.toMatch(/\b(?:pnpm|npm|npx|node|turbo)\b/);
      }
    }
  });
});

describe('the range and history scans', () => {
  const scanning = allJobs.filter(({ steps }) =>
    steps.some((step) => /scan-secrets\.ts (?:range|history)\b/.test(runOf(step))),
  );

  it('run in security, secrets-history and the weekly secrets job', () => {
    expect(scanning.map(({ where }) => where)).toEqual([
      '.github/workflows/ci.yml: security',
      '.github/workflows/ci.yml: secrets-history',
      '.github/workflows/scheduled.yml: secrets',
    ]);
  });

  it.each(scanning)('$where: checks out the full history (fetch-depth: 0)', ({ steps, where }) => {
    const checkouts = steps.filter(isCheckout);
    expect(checkouts).toHaveLength(1);
    const options = asMapping(checkouts[0]?.with, `${where}: checkout.with`);
    expect(options['fetch-depth']).toBe(0);
  });
});

describe('the custom managers of renovate.json', () => {
  interface CustomManager {
    managerFilePatterns: string[];
    matchStrings: string[];
    datasourceTemplate?: string;
    depNameTemplate?: string;
  }
  const renovate = asMapping(JSON.parse(readText('renovate.json')), 'renovate.json');
  const managers = asList(renovate.customManagers, 'customManagers') as CustomManager[];

  /** The matches of every match string of the manager for the file pattern, in the file. */
  function matchesOf(filePattern: string, file: string): RegExpMatchArray[] {
    const manager = managers.find((candidate) =>
      candidate.managerFilePatterns.includes(filePattern),
    );
    const text = readText(file);
    return (manager?.matchStrings ?? []).flatMap((matchString) => [
      ...text.matchAll(new RegExp(matchString, 'g')),
    ]);
  }

  const action = '.github/actions/gitleaks/action.yml';
  const [gitleaksMatch] = matchesOf(action, action);
  const ciVersion = gitleaksMatch?.groups?.currentValue ?? '';

  it('match the gitleaks version and checksum of the gitleaks action, together', () => {
    expect(matchesOf(action, action)).toHaveLength(1);
    expect(ciVersion).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(gitleaksMatch?.groups?.currentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('match both gitleaks install lines of getting-started.md, at the version that CI pins', () => {
    const guide = 'docs/dev/getting-started.md';
    const versions = matchesOf(guide, guide).map((match) => match.groups?.currentValue);
    expect(versions).toEqual([ciVersion.slice(1), ciVersion.slice(1)]);
  });

  it('match every *_IMAGE line of the workflows', () => {
    const images = matchesOf('.github/workflows/*.yml', '.github/workflows/ci.yml');
    expect(images.map((match) => match.groups?.depName)).toEqual([
      'rhysd/actionlint',
      'ghcr.io/renovatebot/renovate',
    ]);
  });

  it('match the PostgreSQL image of the integration tests once, by tag and digest', () => {
    const file = 'apps/api/test/integration/support/postgres-image.ts';
    const manager = managers.find((candidate) => candidate.managerFilePatterns.includes(file));
    expect(manager?.datasourceTemplate).toBe('docker');
    expect(manager?.depNameTemplate).toBe('postgres');
    const images = matchesOf(file, file);
    expect(images).toHaveLength(1);
    expect(images[0]?.groups?.currentValue).toMatch(/^\d+\.\d+-[a-z]+$/);
    expect(images[0]?.groups?.currentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // config:best-practices ignores **/test/**, which would hide the file from every manager;
    // the ignorePaths of renovate.json replace that list.
    const ignorePaths = asList(renovate.ignorePaths, 'ignorePaths') as string[];
    expect(ignorePaths.filter((pattern) => path.posix.matchesGlob(file, pattern))).toEqual([]);
  });

  it('match the Azurite image of the integration tests once, as compose.dev.yaml pins it', () => {
    const file = 'apps/api/test/integration/support/azurite-image.ts';
    const manager = managers.find((candidate) => candidate.managerFilePatterns.includes(file));
    expect(manager?.datasourceTemplate).toBe('docker');
    expect(manager?.depNameTemplate).toBe('mcr.microsoft.com/azure-storage/azurite');
    const images = matchesOf(file, file);
    expect(images).toHaveLength(1);
    const { currentValue, currentDigest } = images[0]?.groups ?? {};
    expect(currentValue).toMatch(/^\d+\.\d+\.\d+$/);
    expect(currentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Renovate moves both in one pull request; until it does, they must not differ.
    expect(readText('compose.dev.yaml')).toContain(
      `image: mcr.microsoft.com/azure-storage/azurite:${currentValue ?? ''}@${currentDigest ?? ''}\n`,
    );
  });
});
