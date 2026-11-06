import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import config, { SECURITY_HEADERS } from '../next.config';

async function headersFor(appEnv: string): Promise<unknown> {
  vi.stubEnv('APP_ENV', appEnv);
  return config(PHASE_PRODUCTION_BUILD).headers?.();
}

describe('next.config (03 §3)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the same headers for every environment: Next writes them at build time', async () => {
    const local = await headersFor('local');
    expect(await headersFor('production')).toEqual(local);
    expect(local).toEqual([{ source: '/:path*', headers: SECURITY_HEADERS }]);
  });

  it('sends HSTS, closes the opener and hides the framework', () => {
    expect(SECURITY_HEADERS.map(({ key }) => key)).toEqual(
      expect.arrayContaining(['Strict-Transport-Security', 'Cross-Origin-Opener-Policy']),
    );
    expect(config(PHASE_PRODUCTION_BUILD).poweredByHeader).toBe(false);
  });

  it('proxies the API only in the development server', () => {
    expect(config(PHASE_PRODUCTION_BUILD).rewrites).toBeUndefined();
    expect(config(PHASE_DEVELOPMENT_SERVER).rewrites).toBeDefined();
  });
});
