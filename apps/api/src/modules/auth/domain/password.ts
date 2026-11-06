import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/** ADR 0004 §4: at least m = 19 MiB, t = 2, p = 1. In the hash, so they can rise later. */
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_BYTES = 32;
const NONCE_BYTES = 16;

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** The same password from any keyboard: an Arabic letter has more than one encoding. */
function normalized(password: string): string {
  return password.normalize('NFKC');
}

function derive(
  password: string,
  nonce: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      { message: normalized(password), nonce, memory, passes, parallelism, tagLength },
      (error, tag) => {
        if (error === null) resolve(tag);
        else reject(error);
      },
    );
  });
}

function unpadded(value: Buffer): string {
  return value.toString('base64').replace(/=+$/, '');
}

/** A hash in the PHC string format, which other argon2 tools read too. */
export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(NONCE_BYTES);
  const tag = await derive(password, nonce, MEMORY_KIB, PASSES, PARALLELISM, TAG_BYTES);
  const parameters = `m=${String(MEMORY_KIB)},t=${String(PASSES)},p=${String(PARALLELISM)}`;
  return `$argon2id$v=19$${parameters}$${unpadded(nonce)}$${unpadded(tag)}`;
}

/** Whether a password fits a hash; a hash in another format fits nothing. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parts = PHC.exec(hash);
  if (parts === null) return false;
  const [, memory, passes, parallelism, nonce = '', expected = ''] = parts;
  const stored = Buffer.from(expected, 'base64');
  const tag = await derive(
    password,
    Buffer.from(nonce, 'base64'),
    Number(memory),
    Number(passes),
    Number(parallelism),
    stored.length,
  );
  return timingSafeEqual(tag, stored);
}
