/**
 * An account signed in for a Bearer header, with its address confirmed unless said otherwise: what
 * the free times need since B07. Synthetic addresses only; each account signs up from its own client
 * address, because signing up has a limit per address.
 */
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import type { Server } from 'node:http';
import request from 'supertest';
import { withClient } from './sql.js';

const API = '/api/v1';
const PASSWORD = 'synthetic correct horse battery';

export interface SignedInAccount {
  readonly email: string;
  readonly token: string;
}

export async function signedInAccount(
  server: Server,
  platformOwnerUrl: string,
  {
    email,
    clientAddress,
    confirmed = true,
  }: { readonly email: string; readonly clientAddress: string; readonly confirmed?: boolean },
): Promise<SignedInAccount> {
  await request(server)
    .post(`${API}/auth/register`)
    .set('X-Forwarded-For', clientAddress)
    .send({ email, password: PASSWORD, locale: 'en', privacyNoticeVersion: PRIVACY_NOTICE_VERSION })
    .expect(202);
  if (confirmed) {
    await withClient(platformOwnerUrl, (client) =>
      client.query('UPDATE users SET email_verified_at = now() WHERE lower(email) = lower($1)', [
        email,
      ]),
    );
  }
  const login = await request(server)
    .post(`${API}/auth/login`)
    .set('X-Forwarded-For', clientAddress)
    .send({ email, password: PASSWORD, delivery: 'body' })
    .expect(200);
  return { email, token: (login.body as { tokens: { accessToken: string } }).tokens.accessToken };
}
