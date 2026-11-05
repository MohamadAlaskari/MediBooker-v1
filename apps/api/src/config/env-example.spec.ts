import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { type EnvSource, parseEnv } from './env.schema.js';
import { findWorkspaceRoot } from './load-env.js';

/**
 * The root `.env.example` is what every developer copies to `.env` (02 §7), so it must parse and
 * list exactly the API's variables. apps/api/turbo.json makes the file an input of this test.
 */
function readEnvExample(): EnvSource {
  const root = findWorkspaceRoot(import.meta.dirname);
  if (root === undefined) throw new Error('no workspace root above the API');
  return parseDotenv(readFileSync(path.join(root, '.env.example'), 'utf8'));
}

describe('the root .env.example', () => {
  it('parses into a valid local environment', () => {
    expect(parseEnv(readEnvExample())).toMatchObject({ APP_ENV: 'local', HOST: '127.0.0.1' });
  });

  it('lists exactly the variables of the API', () => {
    const variables = readEnvExample();
    expect(Object.keys(variables).sort()).toEqual(Object.keys(parseEnv(variables)).sort());
  });
});
