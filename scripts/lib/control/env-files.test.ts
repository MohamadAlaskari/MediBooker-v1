import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureEnvFile, envValue, isSwaggerEnabled, productionEnvFile } from './env-files.ts';
import { STACKS } from './stacks.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'medibooker-env-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('productionEnvFile', () => {
  it('sets every password compose asks for, each with its own value', () => {
    let counter = 0;
    const text = productionEnvFile(() => {
      counter += 1;
      return `secret${String(counter)}`;
    });
    const compose = readFileSync(new URL('../../../compose.prod.yaml', import.meta.url), 'utf8');
    const devCompose = readFileSync(new URL('../../../compose.dev.yaml', import.meta.url), 'utf8');
    const used = [...`${compose}${devCompose}`.matchAll(/\$\{([A-Z_]+)(?::[?-][^}]*)?\}/g)].map(
      (match) => match[1] ?? '',
    );
    const missing = [...new Set(used)].filter((key) => envValue(text, key) === undefined);
    expect(missing).toEqual([]);
    expect(new Set([...text.matchAll(/=(secret\d+)/g)].map((match) => match[1])).size).toBe(5);
  });

  it('keeps the Swagger UI off', () => {
    expect(
      envValue(
        productionEnvFile(() => 'x'),
        'OPENAPI_UI_ENABLED',
      ),
    ).toBe('false');
  });
});

describe('ensureEnvFile', () => {
  it('copies the placeholders for development', () => {
    writeFileSync(path.join(root, '.env.example'), 'POSTGRES_PASSWORD=changeme\n');
    expect(ensureEnvFile(STACKS.dev, root)).toBe(true);
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('POSTGRES_PASSWORD=changeme\n');
  });

  it('writes random secrets for production, different on each machine', () => {
    expect(ensureEnvFile(STACKS.prod, root)).toBe(true);
    const first = readFileSync(path.join(root, '.env.prod'), 'utf8');
    const password = envValue(first, 'POSTGRES_PASSWORD') ?? '';
    expect(password).toMatch(/^[0-9a-f]{48}$/);
    rmSync(path.join(root, '.env.prod'));
    ensureEnvFile(STACKS.prod, root);
    const second = readFileSync(path.join(root, '.env.prod'), 'utf8');
    expect(envValue(second, 'POSTGRES_PASSWORD')).not.toBe(password);
  });

  it.each(['dev', 'prod'] as const)('never overwrites the file of %s', (mode) => {
    writeFileSync(path.join(root, '.env.example'), 'FROM_THE_TEMPLATE=1\n');
    const file = path.join(root, STACKS[mode].envFile);
    writeFileSync(file, 'KEPT=1\n');
    expect(ensureEnvFile(STACKS[mode], root)).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('KEPT=1\n');
  });
});

describe('ensureEnvFile without a template', () => {
  it('reports the real problem instead of claiming the file exists', () => {
    expect(() => ensureEnvFile(STACKS.dev, root)).toThrow(/ENOENT/);
  });
});

describe('envValue', () => {
  it('reads a key, the last assignment wins, and other keys do not match', () => {
    const text = 'A=1\r\nAB=2\nA=3\n# A=4\n';
    expect(envValue(text, 'A')).toBe('3');
    expect(envValue(text, 'AB')).toBe('2');
    expect(envValue(text, 'B')).toBeUndefined();
  });
});

describe('isSwaggerEnabled', () => {
  it('is always on in development', () => {
    expect(isSwaggerEnabled(STACKS.dev, root)).toBe(true);
  });

  it('follows .env.prod in production', () => {
    expect(isSwaggerEnabled(STACKS.prod, root)).toBe(false);
    writeFileSync(path.join(root, '.env.prod'), 'OPENAPI_UI_ENABLED=false\n');
    expect(isSwaggerEnabled(STACKS.prod, root)).toBe(false);
    writeFileSync(path.join(root, '.env.prod'), 'OPENAPI_UI_ENABLED=true\n');
    expect(isSwaggerEnabled(STACKS.prod, root)).toBe(true);
  });
});
