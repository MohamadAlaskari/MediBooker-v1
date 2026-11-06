import { randomBytes } from 'node:crypto';
import { constants, copyFileSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Stack } from './stacks.ts';

const PROD_SECRET_KEYS = [
  'POSTGRES_PASSWORD',
  'PLATFORM_OWNER_PASSWORD',
  'PLATFORM_APP_PASSWORD',
  'PROVISIONER_PASSWORD',
  'DEV_SECRET_SEED',
] as const;

/** The content of `.env.prod`: new random values; hex, because they end up inside URLs. */
export function productionEnvFile(random: () => string): string {
  return [
    '# Written by the control menu on the first start of the production stack. Gitignored.',
    '# The database keeps the passwords of its first start: delete this file only together with',
    '# the stack ("Alles dieses Betriebs entfernen").',
    ...PROD_SECRET_KEYS.map((key) => `${key}=${random()}`),
    'OPENAPI_UI_ENABLED=false',
    '',
  ].join('\n');
}

/**
 * Makes sure the stack's environment file exists: development copies the placeholders of
 * `.env.example`, production gets its own random secrets, never shown. True when it was created.
 */
export function ensureEnvFile(stack: Stack, root: string): boolean {
  const file = path.join(root, stack.envFile);
  try {
    // Exclusive creation, not a check first: an existing file is never overwritten.
    if (stack.mode === 'dev') {
      copyFileSync(path.join(root, '.env.example'), file, constants.COPYFILE_EXCL);
    } else {
      writeFileSync(
        file,
        productionEnvFile(() => randomBytes(24).toString('hex')),
        { mode: 0o600, flag: 'wx' },
      );
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** A line that assigns a key, in every form compose reads: also `export KEY=`, `KEY = ` and `KEY:`. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*[=:]\s*(.*)$/;

/** The value of a key in an environment file's text; the last assignment wins, as in compose. */
export function envValue(text: string, key: string): string | undefined {
  const values = text.split(/\r?\n/).flatMap((line) => {
    const match = ASSIGNMENT.exec(line);
    return match?.[1] === key ? [(match[2] ?? '').trim()] : [];
  });
  return values.at(-1);
}

/** The stack's environment file; undefined while it is not written yet. */
function readEnvFile(stack: Stack, root: string): string | undefined {
  try {
    return readFileSync(path.join(root, stack.envFile), 'utf8');
  } catch {
    return undefined;
  }
}

/** Whether this stack serves the Swagger UI. */
export function isSwaggerEnabled(stack: Stack, root: string): boolean {
  if (stack.mode === 'dev') return true;
  const text = readEnvFile(stack, root);
  return text !== undefined && envValue(text, 'OPENAPI_UI_ENABLED') === 'true';
}

/** What the menu offers when asked for the server of a mailbox. */
export const DEFAULT_MAIL_HOST = 'smtp.hostinger.com';
const MAILPIT_HOST = 'mailpit';
const IMPLICIT_TLS_PORT = 465;

/**
 * The host of the real mail server this stack sends through; undefined: its own Mailpit. Only the
 * host, for showing: the whole URL holds the password. The shell beats the file, as in compose.
 */
export function mailServerOf(
  stack: Stack,
  root: string,
  shell: { readonly SMTP_URL?: string | undefined } = process.env,
): string | undefined {
  const text = readEnvFile(stack, root);
  const value = shell.SMTP_URL ?? (text === undefined ? undefined : envValue(text, 'SMTP_URL'));
  const url = value?.replace(/^["']|["']$/g, '') ?? '';
  if (url === '') return undefined;
  if (!URL.canParse(url)) return '(SMTP_URL nicht lesbar)';
  const { hostname } = new URL(url);
  return hostname === MAILPIT_HOST ? undefined : hostname;
}

/** First character alphanumeric: this ends up as an argument of a command. */
export function isMailAddress(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}

export function isHostName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value);
}

export interface Mailbox {
  readonly address: string;
  readonly host: string;
  readonly password: string;
  /** Who may receive real e-mails besides the mailbox itself. */
  readonly allowed: readonly string[];
}

/** TLS from the first byte. Encoded: the address holds an @, and a password can hold anything. */
export function smtpUrlOf({ address, host, password }: Mailbox): string {
  const credentials = `${encodeURIComponent(address)}:${encodeURIComponent(password)}`;
  return `smtps://${credentials}@${host}:${String(IMPLICIT_TLS_PORT)}`;
}

/** The text of an environment file with these keys set, or removed; all other lines stay. */
export function withEnvValues(
  text: string,
  values: Readonly<Record<string, string | undefined>>,
): string {
  const kept = text.split(/\r?\n/).filter((line) => {
    const key = ASSIGNMENT.exec(line)?.[1];
    return key === undefined || !Object.hasOwn(values, key);
  });
  while (kept.at(-1) === '') kept.pop();
  const set = Object.entries(values).flatMap(([key, value]) =>
    value === undefined ? [] : [`${key}=${value}`],
  );
  return [...kept, ...set, ''].join('\n');
}

/** Sets the mail server of the stack's environment file or, without a mailbox, removes it. */
export function writeMailServer(stack: Stack, root: string, mailbox: Mailbox | undefined): void {
  const file = path.join(root, stack.envFile);
  const values =
    mailbox === undefined
      ? { SMTP_URL: undefined, MAIL_FROM: undefined, MAIL_ALLOWED_RECIPIENTS: undefined }
      : {
          SMTP_URL: smtpUrlOf(mailbox),
          MAIL_FROM: `"MediBooker <${mailbox.address}>"`,
          MAIL_ALLOWED_RECIPIENTS: [...new Set([mailbox.address, ...mailbox.allowed])].join(','),
        };
  const text = withEnvValues(readFileSync(file, 'utf8'), values);
  // A new file: for its owner only from the first byte, where the file system knows owners, and a
  // crash leaves the old one whole, which in production holds the passwords of the database.
  const temporary = `${file}.tmp`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}
