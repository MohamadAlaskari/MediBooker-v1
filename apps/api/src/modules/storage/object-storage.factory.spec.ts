import { describe, expect, it } from 'vitest';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { parseEnv } from '../../config/env.schema.js';
import { AzureBlobStorage } from './azure/azure-blob-storage.js';
import { ObjectKey } from './object-key.js';
import { objectStorageFor } from './object-storage.factory.js';
import { type ObjectStorage, ObjectStorageError } from './object-storage.js';
import { UnconfiguredObjectStorage } from './unconfigured-object-storage.js';

const clock = new FixedClock(Temporal.Instant.from('2027-03-28T01:30:00Z'));
const key = ObjectKey.of('0a1b2c3d-0000-4000-8000-00000000000f', 'attachments/first');
const FILE = { contentType: 'application/pdf', seconds: 60 };

/** A closed port on this machine: a call would fail, and constructing makes none. */
const AZURE_ENV = {
  ...TEST_ENV,
  STORAGE_PROVIDER: 'azure',
  STORAGE_AZURE_CONNECTION_STRING:
    'AccountName=devstoreaccount1;AccountKey=a2V5;BlobEndpoint=http://127.0.0.1:9/devstoreaccount1',
};

describe('objectStorageFor', () => {
  it('gives the unconfigured storage when no provider is set', () => {
    expect(objectStorageFor(parseEnv(TEST_ENV), clock)).toBeInstanceOf(UnconfiguredObjectStorage);
  });

  it('gives the Azure adapter with its parsed values', () => {
    const storage = objectStorageFor(parseEnv(AZURE_ENV), clock);
    expect(storage).toBeInstanceOf(AzureBlobStorage);
    expect(storage.describe()).toEqual({
      provider: 'azure',
      place: 'devstoreaccount1 at 127.0.0.1:9',
    });
  });

  it('signs with the public URL when one is set', async () => {
    const storage = objectStorageFor(
      parseEnv({
        ...AZURE_ENV,
        STORAGE_AZURE_PUBLIC_BLOB_URL: 'http://localhost:10000/devstoreaccount1',
      }),
      clock,
    );
    const download = await storage.signDownload(key, { ...FILE, downloadName: 'a.pdf' });
    expect(download.url.startsWith('http://localhost:10000/devstoreaccount1/')).toBe(true);
  });

  it('names no value when the settings are missing, which parseEnv does not let happen', () => {
    const env = { ...parseEnv(TEST_ENV), STORAGE_PROVIDER: 'azure' as const };
    expect(() => objectStorageFor(env, clock)).toThrow(new Error('no Azure connection string'));
  });
});

describe('UnconfiguredObjectStorage', () => {
  const storage: ObjectStorage = new UnconfiguredObjectStorage(clock);

  it('says that nothing is configured', () => {
    expect(storage.describe()).toEqual({ provider: 'none', place: 'not configured' });
  });

  it.each([
    ['get', () => storage.get(key)],
    ['head', () => storage.head(key)],
    ['delete', () => storage.delete(key)],
    ['put', () => storage.put(key, new Uint8Array(), FILE.contentType)],
    ['deleteAllOf', () => storage.deleteAllOf(key.practiceId)],
    ['signUpload', () => storage.signUpload(key, FILE)],
    ['signDownload', () => storage.signDownload(key, { ...FILE, downloadName: 'a.pdf' })],
  ])('rejects %s with NOT_CONFIGURED', async (_name, call) => {
    const refused = call();
    await expect(refused).rejects.toBeInstanceOf(ObjectStorageError);
    await expect(refused).rejects.toMatchObject({ failure: 'NOT_CONFIGURED' });
  });
});
