import { randomBytes } from 'node:crypto';
import { constants, copyFileSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// It imports nothing, so the menu still needs only Node and Docker.
import {
  parseAzureConnectionString,
  type AzureConnectionProblem,
} from '../../../apps/api/src/modules/storage/azure/azure-connection-string.ts';
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

/** What compose reads for a key, without its quotes: the shell beats the file. Empty: nothing. */
function composeValue(
  stack: Stack,
  root: string,
  key: string,
  fromShell: string | undefined,
): string {
  const text = readEnvFile(stack, root);
  const value = fromShell ?? (text === undefined ? undefined : envValue(text, key));
  return value?.replace(/^["']|["']$/g, '') ?? '';
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
  const url = composeValue(stack, root, 'SMTP_URL', shell.SMTP_URL);
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

/** Sets or removes these keys in the stack's environment file. */
function updateEnvFile(
  stack: Stack,
  root: string,
  values: Readonly<Record<string, string | undefined>>,
): void {
  const file = path.join(root, stack.envFile);
  const text = withEnvValues(readFileSync(file, 'utf8'), values);
  // A new file: for its owner only from the first byte, where the file system knows owners, and a
  // crash leaves the old one whole, which in production holds the passwords of the database.
  const temporary = `${file}.tmp`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}

/** Sets the mail server of the stack's environment file or, without a mailbox, removes it. */
export function writeMailServer(stack: Stack, root: string, mailbox: Mailbox | undefined): void {
  updateEnvFile(
    stack,
    root,
    mailbox === undefined
      ? { SMTP_URL: undefined, MAIL_FROM: undefined, MAIL_ALLOWED_RECIPIENTS: undefined }
      : {
          SMTP_URL: smtpUrlOf(mailbox),
          MAIL_FROM: `"MediBooker <${mailbox.address}>"`,
          MAIL_ALLOWED_RECIPIENTS: [...new Set([mailbox.address, ...mailbox.allowed])].join(','),
        },
  );
}

/** The form of a practice's address name, as medibooker-db judges it (`apps/db-migrate/src/lib/slugs.ts`). */
const PRACTICE_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Names the practice the stack's API and web serve (ADR 0016), for example after "Praxis anlegen".
 * Only a value of that form reaches the file, which also holds the database's passwords: nothing
 * else could start a line of its own there.
 */
export function writePracticeSlug(stack: Stack, root: string, slug: string): void {
  if (!PRACTICE_SLUG.test(slug)) throw new Error('not the address name of a practice');
  updateEnvFile(stack, root, { PRACTICE_SLUG: slug });
}

/** What the menu says when the API's parser refuses a string. Never a part of the string. */
const AZURE_STRING_PROBLEMS: Readonly<Record<AzureConnectionProblem, string>> = {
  not_a_connection_string: 'Das ist kein Connection String.',
  shared_access_signature_cannot_sign:
    'Ein String mit SharedAccessSignature kann nicht signieren: bitte den mit AccountKey.',
  development_shortcut_points_at_loopback:
    'UseDevelopmentStorage meint den Emulator, kein Azure-Konto.',
  account_name_invalid: 'AccountName fehlt oder ist kein Name eines Speicherkontos.',
  account_key_invalid: 'AccountKey fehlt oder ist kein gültiges Base64.',
  blob_endpoint_invalid: 'Der Blob-Endpunkt fehlt oder ist nicht lesbar.',
};

/** The account of the Azurite emulator, whose key is public. */
const EMULATOR_ACCOUNT = 'devstoreaccount1';

/**
 * What a connection string holds, and what neither an environment file nor compose changes: no $, #,
 * quote, backslash or space. compose would print a $ doubled, so it could not even show the value.
 */
const LITERAL_STRING = /^[A-Za-z0-9+/=;:._-]+$/;

/**
 * Why the menu does not take this string for a stack without an emulator; undefined when it does.
 * The API's own parser, so both read the same thing: the API would refuse the same string only by
 * not starting. The rest it does not refuse here, because this stack runs with APP_ENV local.
 */
export function azureStringProblem(value: string): string | undefined {
  const connection = parseAzureConnectionString(value);
  if (typeof connection === 'string') return AZURE_STRING_PROBLEMS[connection];
  if (connection.accountName === EMULATOR_ACCOUNT) return 'Das ist das Konto des Emulators.';
  if (!connection.blobEndpoint.startsWith('https://')) return 'Azure braucht https.';
  return LITERAL_STRING.test(value) ? undefined : 'Der String enthält Zeichen, die er nicht hat.';
}

/**
 * The name of the Azure account this stack's files go to; undefined: none is entered. Only the name,
 * for showing: the whole string holds the key.
 */
export function storageAccountOf(
  stack: Stack,
  root: string,
  shell: { readonly STORAGE_AZURE_CONNECTION_STRING?: string | undefined } = process.env,
): string | undefined {
  const value = composeValue(
    stack,
    root,
    'STORAGE_AZURE_CONNECTION_STRING',
    shell.STORAGE_AZURE_CONNECTION_STRING,
  );
  if (value === '') return undefined;
  const connection = parseAzureConnectionString(value);
  return typeof connection === 'string' ? '(String nicht lesbar)' : connection.accountName;
}

/** Sets the Azure account of the stack's environment file or, without a string, removes it. */
export function writeStorageAccount(
  stack: Stack,
  root: string,
  connectionString: string | undefined,
): void {
  updateEnvFile(
    stack,
    root,
    connectionString === undefined
      ? { STORAGE_PROVIDER: undefined, STORAGE_AZURE_CONNECTION_STRING: undefined }
      : {
          STORAGE_PROVIDER: 'azure',
          STORAGE_AZURE_CONNECTION_STRING: `'${connectionString}'`,
        },
  );
}
