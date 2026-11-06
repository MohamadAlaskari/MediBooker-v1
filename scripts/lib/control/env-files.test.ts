import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureEnvFile,
  envValue,
  isHostName,
  isMailAddress,
  isSwaggerEnabled,
  mailServerOf,
  productionEnvFile,
  smtpUrlOf,
  withEnvValues,
  writeMailServer,
} from './env-files.ts';
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
    // Not what has a default (`:-`): the stacks run without those, the mail server for example.
    const used = [...`${compose}${devCompose}`.matchAll(/\$\{([A-Z_]+)(?::\?[^}]*)?\}/g)].map(
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

describe('the mail server', () => {
  const mailbox = {
    address: 'box@example.test',
    host: 'smtp.example.test',
    password: 'a$b#c%d@e:f/g h',
    allowed: ['two@example.test'],
  };

  it('is the Mailpit of the stack without an entry', () => {
    expect(mailServerOf(STACKS.dev, root)).toBeUndefined();
    writeFileSync(path.join(root, '.env'), '# SMTP_URL=smtp://commented.example.test\n');
    expect(mailServerOf(STACKS.dev, root)).toBeUndefined();
    writeFileSync(path.join(root, '.env'), 'SMTP_URL=smtp://mailpit:1025\n');
    expect(mailServerOf(STACKS.dev, root)).toBeUndefined();
  });

  it('shows the host only, never what the URL holds besides', () => {
    writeFileSync(path.join(root, '.env'), `SMTP_URL=${smtpUrlOf(mailbox)}\n`);
    expect(mailServerOf(STACKS.dev, root)).toBe('smtp.example.test');
    writeFileSync(path.join(root, '.env'), 'SMTP_URL="smtps://mail.example.test:465"\n');
    expect(mailServerOf(STACKS.dev, root)).toBe('mail.example.test');
    writeFileSync(path.join(root, '.env'), 'SMTP_URL=not a url\n');
    expect(mailServerOf(STACKS.dev, root)).toBe('(SMTP_URL nicht lesbar)');
  });

  it('builds a URL with TLS that gives address and password back unchanged', () => {
    const url = new URL(smtpUrlOf(mailbox));
    expect(url.protocol).toBe('smtps:');
    expect(url.hostname).toBe('smtp.example.test');
    expect(url.port).toBe('465');
    expect(decodeURIComponent(url.username)).toBe(mailbox.address);
    expect(decodeURIComponent(url.password)).toBe(mailbox.password);
  });

  it('writes only characters an environment file and compose take literally', () => {
    expect(smtpUrlOf(mailbox)).not.toMatch(/[$#"\s]/);
  });

  it('sets the keys of a stack, keeps everything else and removes them again', () => {
    const file = path.join(root, '.env');
    writeFileSync(file, 'A=1\r\nSMTP_URL=old\n# A comment\nMAIL_FROM="old"\nB=2\n\n');
    writeMailServer(STACKS.dev, root, mailbox);
    const written = readFileSync(file, 'utf8');
    expect(envValue(written, 'SMTP_URL')).toBe(smtpUrlOf(mailbox));
    expect(envValue(written, 'MAIL_FROM')).toBe('"MediBooker <box@example.test>"');
    expect(envValue(written, 'MAIL_ALLOWED_RECIPIENTS')).toBe('box@example.test,two@example.test');
    expect(written).not.toContain('old');
    expect(written).toContain('A=1\n# A comment\nB=2\n');
    writeMailServer(STACKS.dev, root, undefined);
    expect(readFileSync(file, 'utf8')).toBe('A=1\n# A comment\nB=2\n');
  });

  it('writes into the file of the stack it was asked for', () => {
    writeFileSync(path.join(root, '.env'), 'A=1\n');
    writeFileSync(path.join(root, '.env.prod'), 'B=2\n');
    writeMailServer(STACKS.prod, root, mailbox);
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('A=1\n');
    expect(mailServerOf(STACKS.prod, root)).toBe('smtp.example.test');
    expect(mailServerOf(STACKS.dev, root)).toBeUndefined();
  });

  it('lists the mailbox itself once, and leaves no temporary file behind', () => {
    writeFileSync(path.join(root, '.env'), 'A=1\n');
    writeMailServer(STACKS.dev, root, { ...mailbox, allowed: ['box@example.test'] });
    expect(envValue(readFileSync(path.join(root, '.env'), 'utf8'), 'MAIL_ALLOWED_RECIPIENTS')).toBe(
      'box@example.test',
    );
    expect(readdirSync(root)).toEqual(['.env']);
  });

  it('reads and removes every form of the key compose reads, so no password stays behind', () => {
    const file = path.join(root, '.env');
    for (const line of [
      'export SMTP_URL=smtps://one.example.test:465',
      'SMTP_URL = smtps://one.example.test:465',
      'SMTP_URL: smtps://one.example.test:465',
    ]) {
      writeFileSync(file, `A=1\n${line}\n`);
      expect(mailServerOf(STACKS.dev, root)).toBe('one.example.test');
      writeMailServer(STACKS.dev, root, undefined);
      expect(readFileSync(file, 'utf8')).toBe('A=1\n');
    }
  });

  it('believes the shell over the file, as compose does', () => {
    writeFileSync(path.join(root, '.env'), 'SMTP_URL=smtps://file.example.test:465\n');
    expect(mailServerOf(STACKS.dev, root, { SMTP_URL: 'smtps://shell.example.test:465' })).toBe(
      'shell.example.test',
    );
    expect(mailServerOf(STACKS.dev, root, { SMTP_URL: '' })).toBeUndefined();
    expect(mailServerOf(STACKS.dev, root, {})).toBe('file.example.test');
  });

  it('adds nothing for a key that is removed, and leaves other keys with the same start', () => {
    expect(withEnvValues('SMTP_URLS=1\n', { SMTP_URL: undefined })).toBe('SMTP_URLS=1\n');
  });

  it.each([
    ['box@example.test', true],
    ['first.last+tag@mail.example.test', true],
    ['-option@example.test', false],
    ['box@example', false],
    ['a b@example.test', false],
    ['one@example.test,two@example.test', false],
    ['', false],
  ])('takes %j as an address: %s', (value, expected) => {
    expect(isMailAddress(value)).toBe(expected);
  });

  it.each([
    ['smtp.example.test', true],
    ['-option', false],
    ['mail server', false],
    ['host/path', false],
    ['user@host', false],
  ])('takes %j as a host: %s', (value, expected) => {
    expect(isHostName(value)).toBe(expected);
  });
});
