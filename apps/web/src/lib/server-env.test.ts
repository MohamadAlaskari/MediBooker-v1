import { describe, expect, it } from 'vitest';
import { parseServerEnv } from './server-env';

const VALID = {
  API_INTERNAL_URL: 'http://127.0.0.1:3001',
  PUBLIC_SITE_URL: 'https://practice.example',
  APP_ENV: 'local',
};

describe('parseServerEnv (03 §2)', () => {
  it('accepts a complete environment', () => {
    expect(parseServerEnv({ ...VALID, OTHER: 'ignored' })).toEqual(VALID);
  });

  it('names the wrong keys and never a value', () => {
    expect(() =>
      parseServerEnv({ ...VALID, API_INTERNAL_URL: 'secret-value', APP_ENV: 'dev' }),
    ).toThrow('Invalid web server environment: API_INTERNAL_URL, APP_ENV');
    expect(() => parseServerEnv({ ...VALID, API_INTERNAL_URL: 'secret-value' })).not.toThrow(
      /secret-value/,
    );
  });

  it('refuses a missing key', () => {
    expect(() =>
      parseServerEnv({ APP_ENV: 'local', PUBLIC_SITE_URL: VALID.PUBLIC_SITE_URL }),
    ).toThrow('API_INTERNAL_URL');
  });
});
