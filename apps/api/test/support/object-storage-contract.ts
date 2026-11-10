import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import type { FixedClock } from '../../src/common/time/fixed-clock.js';
import { ObjectKey } from '../../src/modules/storage/object-key.js';
import type { ObjectStorage, SignedRequest } from '../../src/modules/storage/object-storage.js';

/** What the suite needs of one adapter. `setup` gives a fresh one for every test. */
export interface ObjectStorageUnderTest {
  readonly storage: ObjectStorage;
  /** The clock the storage signs with. */
  readonly clock: FixedClock;
  /** Sends a signed request as a browser would. */
  readonly send: (request: SignedRequest, body?: Uint8Array) => Promise<Response>;
}

/** `send` of a real provider. */
export function sendByFetch(request: SignedRequest, body?: Uint8Array): Promise<Response> {
  return fetch(request.url, { method: request.method, headers: request.headers, body });
}

const BYTES = Buffer.from('synthetic bytes of a test file');
const OTHER_BYTES = Buffer.from('other synthetic bytes');
const CONTENT_TYPE = 'application/pdf';
const OTHER_CONTENT_TYPE = 'image/png';
const SECONDS = 300;
const DOWNLOAD_NAME = 'attachment-1.pdf';

function keyIn(practiceId: string = randomUUID()): ObjectKey {
  return ObjectKey.of(practiceId, `attachments/${randomUUID()}/original`);
}

async function bytesOf(storage: ObjectStorage, key: ObjectKey): Promise<Buffer | undefined> {
  const object = await storage.get(key);
  return object === undefined ? undefined : await buffer(object.body);
}

async function everythingOf(storage: ObjectStorage, key: ObjectKey): Promise<unknown> {
  const object = await storage.get(key);
  if (object === undefined) return undefined;
  const { size, contentType, copied, body } = object;
  return { size, contentType, copied, bytes: await buffer(body) };
}

function signUpload(storage: ObjectStorage, key: ObjectKey): Promise<SignedRequest> {
  return storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: SECONDS });
}

function signDownload(storage: ObjectStorage, key: ObjectKey): Promise<SignedRequest> {
  return storage.signDownload(key, {
    contentType: CONTENT_TYPE,
    downloadName: DOWNLOAD_NAME,
    seconds: SECONDS,
  });
}

/** The same request on another object: its URL with one part replaced. */
function aimedElsewhere(request: SignedRequest, from: string, to: string): SignedRequest {
  const url = request.url.replace(from, to);
  expect(url).not.toBe(request.url);
  return { ...request, url };
}

/**
 * What the port promises, whichever provider runs: `describeObjectStorageContract('name', setup)` is
 * the fourth step of adding a provider (ADR 0015). A provider may refuse with any status, so the suite
 * asks for a refusal and for the content to stay, not for a number.
 */
export function describeObjectStorageContract(
  name: string,
  setup: () => ObjectStorageUnderTest | Promise<ObjectStorageUnderTest>,
): void {
  describe(`${name}: the ObjectStorage contract`, () => {
    it('stores bytes and gives them back with their size and type', async () => {
      const { storage } = await setup();
      const key = keyIn();
      await storage.put(key, BYTES, CONTENT_TYPE);
      expect(await everythingOf(storage, key)).toEqual({
        size: BYTES.length,
        contentType: CONTENT_TYPE,
        copied: false,
        bytes: BYTES,
      });
    });

    it('stores a stream, in any number of chunks', async () => {
      const { storage } = await setup();
      const key = keyIn();
      const half = BYTES.length / 2;
      await storage.put(
        key,
        Readable.from([BYTES.subarray(0, half), BYTES.subarray(half)]),
        CONTENT_TYPE,
      );
      expect(await bytesOf(storage, key)).toEqual(BYTES);
      expect(await storage.head(key)).toEqual({
        size: BYTES.length,
        contentType: CONTENT_TYPE,
        copied: false,
      });
    });

    it('stores an empty object, as bytes and as a stream', async () => {
      const { storage } = await setup();
      const fromBytes = keyIn();
      const fromStream = keyIn();
      await storage.put(fromBytes, new Uint8Array(), CONTENT_TYPE);
      await storage.put(fromStream, Readable.from([]), CONTENT_TYPE);
      for (const key of [fromBytes, fromStream]) {
        expect(await storage.head(key)).toEqual({
          size: 0,
          contentType: CONTENT_TYPE,
          copied: false,
        });
        expect(await bytesOf(storage, key)).toEqual(Buffer.alloc(0));
      }
    });

    it('replaces what is there on another put', async () => {
      const { storage } = await setup();
      const key = keyIn();
      await storage.put(key, BYTES, CONTENT_TYPE);
      await storage.put(key, OTHER_BYTES, OTHER_CONTENT_TYPE);
      expect(await bytesOf(storage, key)).toEqual(OTHER_BYTES);
      expect(await storage.head(key)).toEqual({
        size: OTHER_BYTES.length,
        contentType: OTHER_CONTENT_TYPE,
        copied: false,
      });
    });

    it('answers undefined for nothing there, in a practice that stored something and in one that never did', async () => {
      const { storage } = await setup();
      const practiceId = randomUUID();
      await storage.put(keyIn(practiceId), BYTES, CONTENT_TYPE);
      for (const key of [keyIn(practiceId), keyIn()]) {
        expect(await storage.get(key)).toBeUndefined();
        expect(await storage.head(key)).toBeUndefined();
      }
    });

    it('deletes an object, and deleting it again or in a practice that never stored one is fine', async () => {
      const { storage } = await setup();
      const key = keyIn();
      await storage.put(key, BYTES, CONTENT_TYPE);
      await storage.delete(key);
      expect(await storage.head(key)).toBeUndefined();
      await expect(storage.delete(key)).resolves.toBeUndefined();
      await expect(storage.delete(keyIn())).resolves.toBeUndefined();
    });

    it('deletes everything of one practice and leaves another practice alone', async () => {
      const { storage } = await setup();
      const leaving = randomUUID();
      const first = keyIn(leaving);
      const second = keyIn(leaving);
      const other = keyIn();
      for (const key of [first, second, other]) await storage.put(key, BYTES, CONTENT_TYPE);
      await storage.deleteAllOf(leaving);
      expect(await storage.head(first)).toBeUndefined();
      expect(await storage.head(second)).toBeUndefined();
      expect(await bytesOf(storage, other)).toEqual(BYTES);
    });

    it('finds nothing wrong with deleting all of a practice that has nothing', async () => {
      const { storage } = await setup();
      await expect(storage.deleteAllOf(randomUUID())).resolves.toBeUndefined();
    });

    it('signs an upload that lives as long as asked and creates the object with its type', async () => {
      const { storage, clock, send } = await setup();
      const key = keyIn();
      const request = await storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: 120 });
      expect(request.method).toBe('PUT');
      expect(request.expiresAt.equals(clock.now().add({ seconds: 120 }))).toBe(true);
      expect((await send(request, BYTES)).ok).toBe(true);
      expect(await bytesOf(storage, key)).toEqual(BYTES);
      // Uploaded bytes, not a copy: what R02 accepts.
      expect(await storage.head(key)).toEqual({
        size: BYTES.length,
        contentType: CONTENT_TYPE,
        copied: false,
      });
    });

    it('never replaces an object through a signed upload, with its own URL or a new one', async () => {
      const { storage, send } = await setup();
      const key = keyIn();
      const request = await signUpload(storage, key);
      expect((await send(request, BYTES)).ok).toBe(true);
      expect((await send(request, OTHER_BYTES)).ok).toBe(false);
      expect((await send(await signUpload(storage, key), OTHER_BYTES)).ok).toBe(false);
      expect(await bytesOf(storage, key)).toEqual(BYTES);

      const stored = keyIn();
      await storage.put(stored, BYTES, CONTENT_TYPE);
      expect((await send(await signUpload(storage, stored), OTHER_BYTES)).ok).toBe(false);
      expect(await bytesOf(storage, stored)).toEqual(BYTES);
    });

    it('refuses an expired signed request, for an upload and for a download', async () => {
      const { storage, clock, send } = await setup();
      const now = clock.now();
      const stored = keyIn();
      await storage.put(stored, BYTES, CONTENT_TYPE);
      const notThere = keyIn();

      clock.set(now.subtract({ hours: 1 }));
      const upload = await signUpload(storage, notThere);
      const download = await signDownload(storage, stored);
      clock.set(now);

      expect((await send(upload, BYTES)).ok).toBe(false);
      expect(await storage.head(notThere)).toBeUndefined();
      expect((await send(download)).ok).toBe(false);
    });

    it('signs a download that reads with its name and type and cannot write', async () => {
      const { storage, clock, send } = await setup();
      const key = keyIn();
      await storage.put(key, BYTES, OTHER_CONTENT_TYPE);
      const request = await storage.signDownload(key, {
        contentType: CONTENT_TYPE,
        downloadName: DOWNLOAD_NAME,
        seconds: 60,
      });
      expect(request.method).toBe('GET');
      expect(request.expiresAt.equals(clock.now().add({ seconds: 60 }))).toBe(true);

      const response = await send(request);
      expect(response.ok).toBe(true);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
      expect(response.headers.get('content-type')).toBe(CONTENT_TYPE);
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${DOWNLOAD_NAME}"`,
      );
      // Whatever the uploader set: a browser keeps nothing of it.
      expect(response.headers.get('cache-control')).toBe('private, no-store');

      expect((await send({ ...request, method: 'PUT' }, OTHER_BYTES)).ok).toBe(false);
      expect(await bytesOf(storage, key)).toEqual(BYTES);
    });

    it('signs an upload that cannot read', async () => {
      const { storage, send } = await setup();
      const key = keyIn();
      const request = await signUpload(storage, key);
      expect((await send(request, BYTES)).ok).toBe(true);
      expect((await send({ ...request, method: 'GET' })).ok).toBe(false);
    });

    it("does not reach another practice's object with one practice's signed URL", async () => {
      const { storage, send } = await setup();
      const practiceA = randomUUID();
      const practiceB = randomUUID();
      const path = `attachments/${randomUUID()}/original`;
      const keyOfA = ObjectKey.of(practiceA, path);
      const keyOfB = ObjectKey.of(practiceB, path);
      await storage.put(keyOfA, BYTES, CONTENT_TYPE);
      await storage.put(keyOfB, OTHER_BYTES, CONTENT_TYPE);

      const download = await signDownload(storage, keyOfA);
      expect((await send(aimedElsewhere(download, practiceA, practiceB))).ok).toBe(false);

      const notThere = `attachments/${randomUUID()}/original`;
      const upload = await signUpload(storage, ObjectKey.of(practiceA, notThere));
      const aimed = aimedElsewhere(upload, practiceA, practiceB);
      expect((await send(aimed, BYTES)).ok).toBe(false);
      expect(await storage.head(ObjectKey.of(practiceB, notThere))).toBeUndefined();
    });

    it("does not reach another object of the practice with one object's signed URL", async () => {
      const { storage, send } = await setup();
      const practiceId = randomUUID();
      const signedFor = ObjectKey.of(practiceId, 'attachments/first');
      const other = ObjectKey.of(practiceId, 'attachments/second');
      await storage.put(signedFor, BYTES, CONTENT_TYPE);
      await storage.put(other, OTHER_BYTES, CONTENT_TYPE);
      const download = await signDownload(storage, signedFor);
      expect((await send(aimedElsewhere(download, 'first', 'second'))).ok).toBe(false);
    });

    it('takes the rules on lifetime, type and name from the port, so no adapter can forget them', async () => {
      const { storage } = await setup();
      const key = keyIn();
      await expect(
        storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: 301 }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        storage.signDownload(key, {
          contentType: CONTENT_TYPE,
          downloadName: 'blood test.pdf',
          seconds: 60,
        }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(storage.put(key, BYTES, 'text/html; charset=utf-8')).rejects.toBeInstanceOf(
        TypeError,
      );
      await expect(storage.deleteAllOf('not-a-practice')).rejects.toBeInstanceOf(TypeError);
    });
  });
}
