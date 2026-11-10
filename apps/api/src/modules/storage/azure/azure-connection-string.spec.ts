import { describe, expect, it } from 'vitest';
import { blobUrlOf, parseAzureConnectionString } from './azure-connection-string.js';

const ACCOUNT = 'AccountName=medibookerfiles;AccountKey=a2V5';

describe('parseAzureConnectionString', () => {
  it('reads a string as the Azure portal writes it, with the endpoint it derives', () => {
    expect(
      parseAzureConnectionString(
        `DefaultEndpointsProtocol=https;${ACCOUNT};EndpointSuffix=core.windows.net`,
      ),
    ).toEqual({
      accountName: 'medibookerfiles',
      accountKey: 'a2V5',
      blobEndpoint: 'https://medibookerfiles.blob.core.windows.net',
    });
  });

  it('defaults the suffix, which the SDK would refuse', () => {
    expect(parseAzureConnectionString(`DefaultEndpointsProtocol=https;${ACCOUNT}`)).toMatchObject({
      blobEndpoint: 'https://medibookerfiles.blob.core.windows.net',
    });
  });

  it("keeps another cloud's suffix", () => {
    expect(
      parseAzureConnectionString(
        `DefaultEndpointsProtocol=https;${ACCOUNT};EndpointSuffix=core.chinacloudapi.cn`,
      ),
    ).toMatchObject({ blobEndpoint: 'https://medibookerfiles.blob.core.chinacloudapi.cn' });
  });

  it('prefers a written blob endpoint and needs no protocol then, which the SDK would read as a SAS string', () => {
    expect(
      parseAzureConnectionString(
        `DefaultEndpointsProtocol=http;${ACCOUNT};BlobEndpoint=https://files.example.test/`,
      ),
    ).toMatchObject({ blobEndpoint: 'https://files.example.test' });
    expect(
      parseAzureConnectionString(`${ACCOUNT};BlobEndpoint=http://azurite:10000/devstoreaccount1`),
    ).toMatchObject({ blobEndpoint: 'http://azurite:10000/devstoreaccount1' });
  });

  it('splits at the first = only, so base64 padding survives', () => {
    for (const accountKey of ['a2V5AA==', 'a2V5YWE=', 'a+V/']) {
      expect(
        parseAzureConnectionString(
          `DefaultEndpointsProtocol=https;AccountName=medibookerfiles;AccountKey=${accountKey}`,
        ),
      ).toMatchObject({ accountKey });
    }
  });

  it("ignores other services' endpoints, unknown settings, empty parts and spaces around a part", () => {
    expect(
      parseAzureConnectionString(
        ` QueueEndpoint=http://other.example.test; ;TableEndpoint=x;Something=else;\n${ACCOUNT};DefaultEndpointsProtocol=https; `,
      ),
    ).toEqual({
      accountName: 'medibookerfiles',
      accountKey: 'a2V5',
      blobEndpoint: 'https://medibookerfiles.blob.core.windows.net',
    });
  });

  it('refuses a string that is none, and a setting without a name', () => {
    for (const value of ['', 'no-equals-sign', `${ACCOUNT};=x`, `${ACCOUNT};stray`]) {
      const result = parseAzureConnectionString(value);
      expect(result === 'not_a_connection_string' || result === 'account_name_invalid').toBe(true);
    }
    expect(parseAzureConnectionString(`${ACCOUNT};=x`)).toBe('not_a_connection_string');
    expect(parseAzureConnectionString(`${ACCOUNT};stray`)).toBe('not_a_connection_string');
  });

  it('refuses a setting that comes twice: the SDK reads the first, other readers the last', () => {
    expect(
      parseAzureConnectionString(`${ACCOUNT};AccountName=other;DefaultEndpointsProtocol=https`),
    ).toBe('not_a_connection_string');
  });

  it('refuses a SAS with its own reason, also next to a key: it cannot sign', () => {
    for (const value of [
      'BlobEndpoint=https://files.example.test;SharedAccessSignature=sv=2026&sig=x',
      `${ACCOUNT};SharedAccessSignature=sv=2026&sig=x;DefaultEndpointsProtocol=https`,
    ]) {
      expect(parseAzureConnectionString(value)).toBe('shared_access_signature_cannot_sign');
    }
  });

  it('refuses the development shortcut with its own reason, wherever it stands', () => {
    for (const value of [
      'UseDevelopmentStorage=true',
      'UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://proxy.example.test',
      `${ACCOUNT};UseDevelopmentStorage=true;DefaultEndpointsProtocol=https`,
    ]) {
      expect(parseAzureConnectionString(value)).toBe('development_shortcut_points_at_loopback');
    }
  });

  it('refuses a missing or an impossible account name, which would become the host of an endpoint', () => {
    for (const accountName of [
      '',
      'ab',
      'a'.repeat(25),
      'UPPER',
      'evil.example.test/',
      'a-b',
      'é',
    ]) {
      expect(
        parseAzureConnectionString(
          `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=a2V5`,
        ),
      ).toBe('account_name_invalid');
    }
    expect(parseAzureConnectionString('DefaultEndpointsProtocol=https;AccountKey=a2V5')).toBe(
      'account_name_invalid',
    );
    // The SDK tests with startsWith, so this would crash it; here it is simply another setting.
    expect(
      parseAzureConnectionString(
        'DefaultEndpointsProtocol=https;AccountNameX=medibookerfiles;AccountKey=a2V5',
      ),
    ).toBe('account_name_invalid');
  });

  it('refuses a key that is no canonical base64, which the SDK would decode without a word', () => {
    for (const accountKey of [
      '',
      'a',
      'a2V',
      'a2V5=',
      'a2V5===',
      'a-V_',
      'a2 V5',
      'a2V5é',
      '====',
    ]) {
      expect(
        parseAzureConnectionString(
          `DefaultEndpointsProtocol=https;AccountName=medibookerfiles;AccountKey=${accountKey}`,
        ),
      ).toBe('account_key_invalid');
    }
    expect(
      parseAzureConnectionString('DefaultEndpointsProtocol=https;AccountName=medibookerfiles'),
    ).toBe('account_key_invalid');
  });

  it('refuses a string that names no blob endpoint, or an impossible one', () => {
    for (const rest of [
      '',
      'DefaultEndpointsProtocol=ftp',
      // The SDK lowers the case of the protocol; nothing portal-written needs that.
      'DefaultEndpointsProtocol=HTTPS',
      'DefaultEndpointsProtocol=https;EndpointSuffix=evil.example.test/x',
      'DefaultEndpointsProtocol=https;EndpointSuffix=',
      'BlobEndpoint=',
      'BlobEndpoint=files.example.test',
      'BlobEndpoint=ftp://files.example.test',
    ]) {
      expect(parseAzureConnectionString(`${ACCOUNT};${rest}`)).toBe('blob_endpoint_invalid');
    }
  });

  it('never repeats a value in its answer', () => {
    const answer = parseAzureConnectionString('AccountName=a1b;AccountKey=hidden!;');
    expect(answer).toBe('account_key_invalid');
  });
});

describe('blobUrlOf', () => {
  it('gives the one written form, without a trailing slash', () => {
    expect(blobUrlOf('https://files.example.test')).toBe('https://files.example.test');
    expect(blobUrlOf('https://files.example.test/')).toBe('https://files.example.test');
    expect(blobUrlOf('http://azurite:10000/devstoreaccount1/')).toBe(
      'http://azurite:10000/devstoreaccount1',
    );
    expect(blobUrlOf('HTTP://AZURITE:10000/devstoreaccount1')).toBe(
      'http://azurite:10000/devstoreaccount1',
    );
    // What goes on is this form, not the spelling that `new URL` happens to accept.
    expect(blobUrlOf('http:azurite:10000/devstoreaccount1')).toBe(
      'http://azurite:10000/devstoreaccount1',
    );
  });

  it('refuses what is no plain http or https URL', () => {
    for (const value of [
      '',
      'files.example.test',
      'ftp://files.example.test',
      'file:///etc/passwd',
      'https://',
      'https://[::1]:10000',
      'https://user@files.example.test',
      'https://user:x@files.example.test',
      'https://files.example.test?query',
      'https://files.example.test/?',
      'https://files.example.test#fragment',
      'https://files.example.test/#',
      'https://ho%2Fst',
    ]) {
      expect(blobUrlOf(value)).toBeUndefined();
    }
  });
});
