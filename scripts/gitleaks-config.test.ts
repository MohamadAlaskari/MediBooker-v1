/**
 * Proves the custom rule in .gitleaks.toml with the real gitleaks binary on synthetic fixtures,
 * scanned with the same policy options as the pre-commit hook. The fixtures are written to a
 * temporary directory at test time, so no scan of the repository ever sees them. Their values
 * are assembled at run time, so this file contains no assignment that the rule reports either
 * (the last case checks that).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { policyArguments } from './lib/gitleaks.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const RULE_ID = 'medibooker-password-assignment';

/** Locally the cases skip without gitleaks; in CI they fail, so the rule is never left untested. */
const IN_CI = process.env.CI === 'true';
const GITLEAKS_INSTALLED = spawnSync('gitleaks', ['version']).error === undefined;
const SKIP_NOTE =
  'gitleaks is not on PATH; install it (docs/dev/getting-started.md), then run pnpm test --force. CI installs it.';

/** Synthetic; never a real secret. */
const SYNTHETIC_SECRET = ['Synth3tic', 'Not', 'Real', '42'].join('-');
const WITH_SEMICOLONS = ['Synth3tic', 'Not', 'Real', '42'].join(';');
const WITH_COMMAS = ['Synth3tic', 'Not', 'Real', '42'].join(',');

interface Fixture {
  name: string;
  file: string;
  content: string;
}

const REPORTED: Fixture[] = [
  {
    name: 'DB_PASSWORD=<value> in an env file',
    file: 'database.env',
    content: `DB_PASSWORD=${SYNTHETIC_SECRET}\n`,
  },
  {
    name: "password: '<value>' in a config object",
    file: 'db-config.js',
    content: `export const dbConfig = {\n  host: 'localhost',\n  password: '${SYNTHETIC_SECRET}',\n};\n`,
  },
  {
    name: 'a value that only starts like a zod schema',
    file: 'zod-like.env',
    content: `DB_PASSWORD=zod.${SYNTHETIC_SECRET}\n`,
  },
  {
    name: 'a quoted *_SECRET value',
    file: 'jwt.env',
    content: `JWT_SECRET="${SYNTHETIC_SECRET}"\n`,
  },
  {
    name: 'an unquoted passwd value in YAML, followed by a comment',
    file: 'mail.yml',
    content: `smtp:\n  passwd: ${SYNTHETIC_SECRET} # rotated monthly\n`,
  },
  {
    name: 'a "secret" key in JSON',
    file: 'settings.json',
    content: `{\n  "secret": "${SYNTHETIC_SECRET}"\n}\n`,
  },
  {
    name: 'pwd in an ini file with CRLF line endings',
    file: 'crlf.ini',
    content: `[database]\r\npwd = ${SYNTHETIC_SECRET}\r\n`,
  },
  {
    name: 'a connection URL with inline credentials',
    file: 'connection.env',
    content: `DATABASE_URL=postgresql://medibooker:${SYNTHETIC_SECRET}@localhost:5432/medibooker\n`,
  },
  {
    name: 'a connection URL with an empty user name',
    file: 'redis.env',
    content: `REDIS_URL=redis://:${SYNTHETIC_SECRET}@localhost:6379\n`,
  },
  {
    name: 'SMTP_PASS=<value> (a key that ends in _PASS)',
    file: 'smtp.env',
    content: `SMTP_PASS=${SYNTHETIC_SECRET}\n`,
  },
  {
    name: "pass: '<value>' in a mail transport config",
    file: 'mailer.js',
    content: `export const transport = {\n  auth: { user: 'mailer', pass: '${SYNTHETIC_SECRET}' },\n};\n`,
  },
  {
    name: 'DB_PASSPHRASE=<value>',
    file: 'passphrase.env',
    content: `DB_PASSPHRASE=${SYNTHETIC_SECRET}\n`,
  },
  {
    name: 'an unquoted value that contains semicolons',
    file: 'semicolons.env',
    content: `DB_PASSWORD=${WITH_SEMICOLONS}\n`,
  },
  {
    name: 'an unquoted YAML value that contains commas',
    file: 'commas.yml',
    content: `db:\n  password: ${WITH_COMMAS}\n`,
  },
  {
    name: "a literal fallback after ?? (process.env.X ?? '<value>')",
    file: 'nullish-fallback.ts',
    content: `export const dbConfig = {\n  password: process.env.DB_PASSWORD ?? '${SYNTHETIC_SECRET}',\n};\n`,
  },
  {
    name: "a literal fallback after || (process.env.X || '<value>')",
    file: 'or-fallback.js',
    content: `const secret = process.env.JWT_SECRET || '${SYNTHETIC_SECRET}';\n`,
  },
  {
    name: 'a literal shell default in an env file (${VAR:-<value>})',
    file: 'env-default.env',
    content: `DB_PASSWORD=\${DB_PASSWORD:-${SYNTHETIC_SECRET}}\n`,
  },
  {
    name: 'a literal shell default in a compose file',
    file: 'compose-default.yml',
    content: `services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-${SYNTHETIC_SECRET}}\n`,
  },
  {
    name: 'a value with an inline gitleaks:allow comment, which the scans ignore',
    file: 'inline-allow.ts',
    content: `const password = '${SYNTHETIC_SECRET}'; // gitleaks:allow\n`,
  },
];

const NOT_REPORTED: Fixture[] = [
  { name: 'DB_PASSWORD=changeme', file: 'changeme.env', content: 'DB_PASSWORD=changeme\n' },
  {
    name: 'DB_PASSWORD=${DB_PASSWORD}',
    file: 'interpolated.env',
    content: 'DB_PASSWORD=${DB_PASSWORD}\n',
  },
  {
    name: 'DB_PASSWORD=${DB_PASSWORD:-} (an empty default)',
    file: 'empty-default.env',
    content: 'DB_PASSWORD=${DB_PASSWORD:-}\n',
  },
  {
    name: 'DB_PASSWORD=${DB_PASSWORD:?required}',
    file: 'required.env',
    content: 'DB_PASSWORD=${DB_PASSWORD:?required}\n',
  },
  {
    name: 'PGPASSWORD=$DB_PASSWORD (a shell variable)',
    file: 'shell-variable.sh',
    content: 'export PGPASSWORD=$DB_PASSWORD\n',
  },
  {
    name: 'password: process.env.DB_PASSWORD',
    file: 'env-config.js',
    content: 'export const dbConfig = {\n  password: process.env.DB_PASSWORD\n};\n',
  },
  {
    name: 'a generated zod schema of a password, as the last key of its object',
    file: 'auth.zod.ts',
    content: 'export const LoginBody = zod.object({\n  "password": zod.string().max(1024)\n});\n',
  },
  { name: 'an empty value', file: 'empty.env', content: 'DB_PASSWORD=\n' },
  { name: 'a value of 7 characters', file: 'short.env', content: 'DB_PASSWORD=Sh0rt-7\n' },
  {
    name: 'a <placeholder> in angle brackets',
    file: 'angle.env',
    content: 'DB_PASSWORD=<your-database-password>\n',
  },
  {
    name: 'a value that contains "example"',
    file: 'example.env',
    content: 'DB_PASSWORD=example-Passw0rd\n',
  },
  {
    name: 'a connection URL with a placeholder password',
    file: 'connection-placeholder.env',
    content: 'DATABASE_URL=postgresql://medibooker:changeme@localhost:5432/medibooker\n',
  },
  {
    name: 'a connection URL with an empty user name and a placeholder password',
    file: 'redis-placeholder.env',
    content: 'REDIS_URL=redis://:changeme@localhost:6379\n',
  },
  {
    name: 'a value read from a variable in code',
    file: 'user.ts',
    content: 'const user = {\n  email: dto.email,\n  password: dto.password,\n};\n',
  },
  {
    name: 'pass read from a variable in code',
    file: 'mail-user.ts',
    content: 'const auth = {\n  user: dto.user,\n  pass: dto.pass,\n};\n',
  },
  {
    name: 'an assignment from a variable that ends in ;',
    file: 'assign.ts',
    content: 'user.password = body.password;\n',
  },
  {
    name: 'keys that only contain "pass" (bypass, surpass)',
    file: 'bypass.ts',
    content: `const bypass = '${SYNTHETIC_SECRET}';\nconst scores = {\n  surpass: '${SYNTHETIC_SECRET}',\n};\n`,
  },
  {
    name: 'a quoted label with spaces (translation catalogs)',
    file: 'labels.json',
    content: '{\n  "password": "Enter your password"\n}\n',
  },
  {
    name: 'this test file itself',
    file: 'gitleaks-config.test.ts',
    content: readFileSync(import.meta.filename, 'utf8'),
  },
];

interface Finding {
  ruleId: string;
  file: string;
}

let fixtureDir = '';
let findings: Finding[] = [];

/** Scans a directory with the repository's policy and returns the findings (secrets redacted). */
function scanDirectory(directory: string): Finding[] {
  const run = spawnSync(
    'gitleaks',
    [
      'dir',
      '.',
      ...policyArguments(REPO_ROOT),
      '--log-level',
      'error',
      '--report-format',
      'json',
      '--report-path',
      '-',
      '--exit-code',
      '0',
    ],
    { cwd: directory, encoding: 'utf8' },
  );
  if (run.error !== undefined) {
    throw new Error(
      `gitleaks did not run (${run.error.message}). CI must install gitleaks before pnpm test.`,
    );
  }
  if (run.status !== 0) {
    throw new Error(`gitleaks failed with exit code ${String(run.status)}:\n${run.stderr}`);
  }
  return parseFindings(run.stdout);
}

function parseFindings(report: string): Finding[] {
  const parsed: unknown = JSON.parse(report);
  if (!Array.isArray(parsed)) {
    throw new Error(`gitleaks did not report a JSON array:\n${report}`);
  }
  return parsed.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('RuleID' in item) || !('File' in item)) {
      throw new Error(`Unexpected gitleaks finding: ${JSON.stringify(item)}`);
    }
    return { ruleId: String(item.RuleID), file: path.basename(String(item.File)) };
  });
}

function ruleIdsFor(file: string): string[] {
  return findings.filter((finding) => finding.file === file).map((finding) => finding.ruleId);
}

describe(`.gitleaks.toml rule ${RULE_ID}`, () => {
  beforeAll(() => {
    if (!GITLEAKS_INSTALLED && !IN_CI) {
      return; // every case skips itself
    }
    fixtureDir = mkdtempSync(path.join(tmpdir(), 'medibooker-gitleaks-'));
    for (const fixture of [...REPORTED, ...NOT_REPORTED]) {
      writeFileSync(path.join(fixtureDir, fixture.file), fixture.content);
    }
    findings = scanDirectory(fixtureDir);
  });

  afterAll(() => {
    if (fixtureDir !== '') {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  beforeEach((context) => {
    context.skip(!GITLEAKS_INSTALLED && !IN_CI, SKIP_NOTE);
  });

  it.each(REPORTED)('reports $name', ({ file }) => {
    expect(ruleIdsFor(file)).toContain(RULE_ID);
  });

  it.each(NOT_REPORTED)('no rule reports $name', ({ file }) => {
    expect(ruleIdsFor(file)).toEqual([]);
  });
});

describe('the allowlist of .gitleaks.toml', () => {
  // Assembled at run time, so this file holds neither value as one literal.
  const EMULATOR_KEY = [
    'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq',
    'K1SZFPTOtr',
    'KBHBeksoGMGw==',
  ].join('/');
  const OTHER_KEY = Buffer.from(`${SYNTHETIC_SECRET}-${SYNTHETIC_SECRET}`).toString('base64');
  const connectionString = (key: string): string =>
    `STORAGE_AZURE_CONNECTION_STRING: DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${key};BlobEndpoint=http://azurite:10000/devstoreaccount1;\n`;

  let directory = '';
  let found: Finding[] = [];

  beforeAll(() => {
    if (!GITLEAKS_INSTALLED && !IN_CI) return;
    directory = mkdtempSync(path.join(tmpdir(), 'medibooker-gitleaks-allow-'));
    writeFileSync(path.join(directory, 'emulator.yml'), connectionString(EMULATOR_KEY));
    writeFileSync(path.join(directory, 'other.yml'), connectionString(OTHER_KEY));
    found = scanDirectory(directory);
  });

  afterAll(() => {
    if (directory !== '') rmSync(directory, { recursive: true, force: true });
  });

  beforeEach((context) => {
    context.skip(!GITLEAKS_INSTALLED && !IN_CI, SKIP_NOTE);
  });

  it("lets the Azurite emulator's published key through", () => {
    expect(found.filter(({ file }) => file === 'emulator.yml')).toEqual([]);
  });

  it('still reports any other account key in the same place', () => {
    expect(found.filter(({ file }) => file === 'other.yml')).not.toEqual([]);
  });
});
