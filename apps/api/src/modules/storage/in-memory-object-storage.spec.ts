import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from '../../../test/support/in-memory-object-storage.js';
import { describeObjectStorageContract } from '../../../test/support/object-storage-contract.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { ObjectKey } from './object-key.js';

const PRACTICE_ID = '00000000-0000-4000-8000-000000000001';
const SIGNED_AT = Temporal.Instant.from('2027-03-28T01:30:00Z');

describeObjectStorageContract('the in-memory adapter', () => {
  const clock = new FixedClock(SIGNED_AT);
  const storage = new InMemoryObjectStorage(clock);
  return {
    storage,
    clock,
    send: (request, body) => storage.send(request, body),
  };
});

describe('InMemoryObjectStorage', () => {
  const key = ObjectKey.of(PRACTICE_ID, 'attachments/first');
  const request = { contentType: 'application/pdf', seconds: 60 };

  it('takes a signed request until its expiry and refuses it from then on', async () => {
    const clock = new FixedClock(SIGNED_AT);
    const storage = new InMemoryObjectStorage(clock);
    const signed = await storage.signUpload(key, request);
    clock.advance({ seconds: 60 });
    expect((await storage.send(signed, new Uint8Array([1]))).status).toBe(403);
    clock.advance({ seconds: -1 });
    expect((await storage.send(signed, new Uint8Array([1]))).status).toBe(201);
  });

  it('refuses a request it never signed', async () => {
    const storage = new InMemoryObjectStorage(new FixedClock(SIGNED_AT));
    const signed = await storage.signUpload(key, request);
    const url = signed.url.slice(0, signed.url.indexOf('?'));
    expect((await storage.send({ ...signed, url })).status).toBe(403);
  });

  it('answers 404 for a signed download of nothing there', async () => {
    const storage = new InMemoryObjectStorage(new FixedClock(SIGNED_AT));
    const signed = await storage.signDownload(key, { ...request, downloadName: 'file.pdf' });
    expect((await storage.send(signed)).status).toBe(404);
  });
});
