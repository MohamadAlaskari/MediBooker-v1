import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../../common/time/fixed-clock.js';
import { ObjectKey } from '../object-key.js';
import { ObjectStorageError } from '../object-storage.js';
import {
  AZURE_LIMITS,
  type AzureLimits,
  AzureBlobStorage,
  objectStorageErrorOf,
} from './azure-blob-storage.js';

const NOW = Temporal.Instant.from('2027-03-28T01:30:00Z');
const key = ObjectKey.of('0a1b2c3d-0000-4000-8000-00000000000f', 'attachments/first/original');
const CONTENT_TYPE = 'application/pdf';
const BYTES = Buffer.from('synthetic bytes');

/** Short limits, so a test of a silent server takes a moment. The real ones have their own test. */
const SHORT: AzureLimits = { callMs: 150, transferMs: 150, silenceMs: 150 };

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const running: Server[] = [];

afterEach(() => {
  for (const server of running.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

/** Just enough of Azure's HTTP: `handler` answers every request, or stays silent. */
async function fakeAzure(handler: Handler): Promise<string> {
  const server = createServer(handler);
  running.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${String(port)}/devstoreaccount1`;
}

function storageOn(blobEndpoint: string, limits: AzureLimits = SHORT): AzureBlobStorage {
  return new AzureBlobStorage(
    new FixedClock(NOW),
    { accountName: 'devstoreaccount1', accountKey: 'a2V5', blobEndpoint },
    limits,
  );
}

/** Answers with Azure's error header and no body, as a HEAD gets it. */
function answer(status: number, code?: string): Handler {
  return (request, response) => {
    request.resume();
    response.writeHead(status, code === undefined ? {} : { 'x-ms-error-code': code });
    response.end();
  };
}

/** The container exists for every call, and `blobs` answers what concerns the blob. */
function containerThen(blobs: Handler): Handler {
  return (request, response) => {
    if (request.url?.includes('restype=container') === true) {
      request.resume();
      response.writeHead(201, { etag: '"c"', 'last-modified': 'Sun, 28 Mar 2027 01:30:00 GMT' });
      response.end();
      return;
    }
    blobs(request, response);
  };
}

/** The headers of a download, as `download()` needs them. */
function downloadHeaders(size: number): Record<string, string> {
  return { 'content-length': String(size), etag: '"b"', 'content-type': CONTENT_TYPE };
}

async function failureOf(attempt: Promise<unknown>): Promise<ObjectStorageError> {
  const outcome = await attempt.then(
    () => new Error('it should have failed'),
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(ObjectStorageError);
  return outcome as ObjectStorageError;
}

/** Everything a logged or printed error could show. */
function everythingIn(error: unknown): string {
  return inspect(error, { depth: 8, showHidden: true, getters: true });
}

describe('objectStorageErrorOf', () => {
  it.each([
    [undefined, 'UNAVAILABLE'],
    [408, 'UNAVAILABLE'],
    [429, 'UNAVAILABLE'],
    [500, 'UNAVAILABLE'],
    [503, 'UNAVAILABLE'],
    [401, 'REFUSED'],
    [403, 'REFUSED'],
    [400, 'FAILED'],
    [404, 'FAILED'],
    [409, 'FAILED'],
    [412, 'FAILED'],
  ])('maps the status %s to %s', (statusCode, failure) => {
    expect(objectStorageErrorOf({ statusCode })).toMatchObject({
      failure,
      providerStatus: statusCode,
    });
  });

  it("reads the code of an answer with a body, of one without, and of the network's", () => {
    expect(objectStorageErrorOf({ statusCode: 409, code: 'A' }).providerCode).toBe('A');
    expect(
      objectStorageErrorOf({ statusCode: 404, details: { errorCode: 'BlobNotFound' } })
        .providerCode,
    ).toBe('BlobNotFound');
    expect(objectStorageErrorOf({ code: 'ECONNREFUSED' })).toMatchObject({
      failure: 'UNAVAILABLE',
      providerCode: 'ECONNREFUSED',
    });
  });

  it('takes nothing else of it: no message, no request, no cause', () => {
    const secret = 'https://files.example.test/practice?sig=hidden';
    const providerError = Object.assign(new Error(secret), {
      statusCode: 403,
      code: 'AuthorizationFailure',
      request: { url: secret, headers: { authorization: secret } },
      cause: new Error(secret),
    });
    const error = objectStorageErrorOf(providerError);
    expect(error.message).toBe('REFUSED');
    expect(error.cause).toBeUndefined();
    expect(everythingIn(error)).not.toContain('hidden');
  });

  it('keeps only what looks like a code, because logs show it', () => {
    for (const code of ['sig=hidden value', 'a'.repeat(65), '', 7, { nested: 'x' }]) {
      expect(objectStorageErrorOf({ statusCode: 500, code }).providerCode).toBeUndefined();
    }
    expect(objectStorageErrorOf({ statusCode: 500, code: 'Server.Busy_1-x' }).providerCode).toBe(
      'Server.Busy_1-x',
    );
  });

  it.each([null, undefined, 'text', 7])('makes do with %s', (thrown) => {
    expect(objectStorageErrorOf(thrown)).toMatchObject({ failure: 'UNAVAILABLE' });
  });
});

describe('AzureBlobStorage', () => {
  it('does no network call when it is constructed', () => {
    // Port 9 refuses every connection, and nothing asks it.
    const storage = storageOn('http://127.0.0.1:9/devstoreaccount1');
    expect(storage.describe()).toEqual({
      provider: 'azure',
      place: 'devstoreaccount1 at 127.0.0.1:9',
    });
  });

  it('never leaves a silent server minutes to answer a call', () => {
    expect(AZURE_LIMITS.callMs).toBeLessThanOrEqual(30_000);
    expect(AZURE_LIMITS.silenceMs).toBeLessThanOrEqual(30_000);
    expect(AZURE_LIMITS.transferMs).toBeLessThanOrEqual(120_000);
  });

  describe('a server that accepts and never answers', () => {
    const silent: Handler = () => undefined;

    it.each([
      ['head', (storage: AzureBlobStorage) => storage.head(key)],
      ['get', (storage: AzureBlobStorage) => storage.get(key)],
      ['delete', (storage: AzureBlobStorage) => storage.delete(key)],
      ['deleteAllOf', (storage: AzureBlobStorage) => storage.deleteAllOf(key.practiceId)],
      ['put', (storage: AzureBlobStorage) => storage.put(key, BYTES, CONTENT_TYPE)],
      [
        'signUpload',
        (storage: AzureBlobStorage) =>
          storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: 60 }),
      ],
    ])('ends %s in UNAVAILABLE', async (_name, call) => {
      const error = await failureOf(call(storageOn(await fakeAzure(silent))));
      expect(error.failure).toBe('UNAVAILABLE');
      expect(error.providerStatus).toBeUndefined();
    });

    it('ends the upload of bytes in UNAVAILABLE when only the blob stays silent', async () => {
      const storage = storageOn(await fakeAzure(containerThen(silent)));
      const error = await failureOf(storage.put(key, BYTES, CONTENT_TYPE));
      expect(error.failure).toBe('UNAVAILABLE');
    });

    it("ends the upload of a stream in UNAVAILABLE, where the SDK's uploadStream would wait forever", async () => {
      const storage = storageOn(await fakeAzure(containerThen(silent)));
      const error = await failureOf(storage.put(key, Readable.from([BYTES]), CONTENT_TYPE));
      expect(error.failure).toBe('UNAVAILABLE');
    });

    it('ends the commit of a stream in UNAVAILABLE', async () => {
      const blocksOnly: Handler = (request, response) => {
        if (request.url?.includes('comp=block&') === true) {
          request.resume();
          response.writeHead(201, {});
          response.end();
        }
      };
      const storage = storageOn(await fakeAzure(containerThen(blocksOnly)));
      const error = await failureOf(storage.put(key, Readable.from([BYTES]), CONTENT_TYPE));
      expect(error.failure).toBe('UNAVAILABLE');
    });
  });

  describe('what a server answers', () => {
    it('reads BlobNotFound and ContainerNotFound as nothing there, for head, get and delete', async () => {
      for (const code of ['BlobNotFound', 'ContainerNotFound']) {
        const storage = storageOn(await fakeAzure(answer(404, code)));
        expect(await storage.head(key)).toBeUndefined();
        expect(await storage.get(key)).toBeUndefined();
        await expect(storage.delete(key)).resolves.toBeUndefined();
      }
    });

    it('does not take another 404 for nothing there: a wrong address must not look like an empty store', async () => {
      for (const code of [undefined, 'ResourceNotFound']) {
        const storage = storageOn(await fakeAzure(answer(404, code)));
        expect(await failureOf(storage.head(key))).toMatchObject({
          failure: 'FAILED',
          providerStatus: 404,
          providerCode: code,
        });
      }
    });

    it('answers REFUSED for 401 and 403', async () => {
      for (const status of [401, 403]) {
        const storage = storageOn(await fakeAzure(answer(status, 'AuthorizationFailure')));
        expect(await failureOf(storage.head(key))).toMatchObject({
          failure: 'REFUSED',
          providerStatus: status,
          providerCode: 'AuthorizationFailure',
        });
      }
    });

    it('tries a busy server three times, then answers UNAVAILABLE', async () => {
      let requests = 0;
      const storage = storageOn(
        await fakeAzure((request, response) => {
          requests += 1;
          answer(503, 'ServerBusy')(request, response);
        }),
        AZURE_LIMITS,
      );
      expect(await failureOf(storage.head(key))).toMatchObject({
        failure: 'UNAVAILABLE',
        providerStatus: 503,
        providerCode: 'ServerBusy',
      });
      expect(requests).toBe(3);
    });

    it('answers FAILED for a conflict when it creates a container', async () => {
      const storage = storageOn(await fakeAzure(answer(409, 'ContainerBeingDeleted')));
      expect(await failureOf(storage.put(key, BYTES, CONTENT_TYPE))).toMatchObject({
        failure: 'FAILED',
        providerStatus: 409,
        providerCode: 'ContainerBeingDeleted',
      });
    });

    it('takes an existing container as fine, without a cache: it asks for every upload', async () => {
      const created: string[] = [];
      const storage = storageOn(
        await fakeAzure((request, response) => {
          if (request.url?.includes('restype=container') === true) {
            created.push(request.url);
            answer(409, 'ContainerAlreadyExists')(request, response);
            return;
          }
          request.resume();
          response.writeHead(201, {});
          response.end();
        }),
      );
      await storage.put(key, BYTES, CONTENT_TYPE);
      await storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: 60 });
      expect(created).toHaveLength(2);
    });

    it('sends the blob and its container to the place the key says, and stores the type', async () => {
      const seen: { url: string; headers: IncomingMessage['headers'] }[] = [];
      const storage = storageOn(
        await fakeAzure((request, response) => {
          seen.push({ url: request.url ?? '', headers: request.headers });
          request.resume();
          response.writeHead(201, {});
          response.end();
        }),
      );
      await storage.put(key, BYTES, CONTENT_TYPE);
      expect(seen[0]?.url.startsWith(`/devstoreaccount1/practice-${key.practiceId}?`)).toBe(true);
      expect(
        seen[1]?.url.startsWith(`/devstoreaccount1/practice-${key.practiceId}/${key.path}`),
      ).toBe(true);
      expect(seen[1]?.headers['x-ms-blob-content-type']).toBe(CONTENT_TYPE);
    });
  });

  describe('a stream on its way up', () => {
    it('sends it in blocks and commits them in order, with the type on the commit', async () => {
      const blocks: string[] = [];
      let commit: { body: string; contentType: unknown } | undefined;
      const storage = storageOn(
        await fakeAzure(
          containerThen((request, response) => {
            const url = new URL(request.url ?? '', 'http://fake');
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => chunks.push(chunk));
            request.on('end', () => {
              if (url.searchParams.get('comp') === 'block') {
                blocks.push(url.searchParams.get('blockid') ?? '');
              } else {
                commit = {
                  body: Buffer.concat(chunks).toString(),
                  contentType: request.headers['x-ms-blob-content-type'],
                };
              }
              response.writeHead(201, {});
              response.end();
            });
          }),
        ),
      );
      const eightMegabytes = Buffer.alloc(8 * 1024 * 1024);
      await storage.put(
        key,
        Readable.from([eightMegabytes, Buffer.from('rest')]),
        'application/pdf',
      );
      expect(blocks).toHaveLength(2);
      expect(new Set(blocks.map((block) => Buffer.from(block, 'base64').length)).size).toBe(1);
      expect(commit?.contentType).toBe('application/pdf');
      const order = blocks.map((block) => commit?.body.indexOf(block) ?? -1);
      expect(order[0]).toBeGreaterThanOrEqual(0);
      expect(order[1]).toBeGreaterThan(order[0] ?? 0);
    });

    it('fails with our error when the stream fails', async () => {
      const storage = storageOn(await fakeAzure(containerThen(answer(201))));
      const failing = new Readable({
        read() {
          this.destroy(new Error('sig=hidden'));
        },
      });
      const error = await failureOf(storage.put(key, failing, CONTENT_TYPE));
      expect(error.failure).toBe('UNAVAILABLE');
      expect(everythingIn(error)).not.toContain('hidden');
    });
  });

  describe('a body on its way down', () => {
    const HALF = 10;
    const SIZE = 2 * HALF;

    /** Sends half of the body and breaks the connection. */
    const breaking: Handler = (request, response) => {
      request.resume();
      response.writeHead(200, downloadHeaders(SIZE));
      response.write(Buffer.alloc(HALF), () => {
        response.destroy();
      });
    };

    it('gives size, type and bytes of an object', async () => {
      const storage = storageOn(
        await fakeAzure((request, response) => {
          request.resume();
          response.writeHead(200, downloadHeaders(BYTES.length));
          response.end(BYTES);
        }),
      );
      const object = await storage.get(key);
      expect(object).toMatchObject({ size: BYTES.length, contentType: CONTENT_TYPE });
      expect(await buffer(object!.body)).toEqual(BYTES);
    });

    it('fails with our error, not the one of the SDK, when the connection breaks', async () => {
      const storage = storageOn(await fakeAzure(breaking), AZURE_LIMITS);
      const object = await storage.get(key);
      const error = await failureOf(buffer(object!.body));
      expect(error.failure).toBe('UNAVAILABLE');
      expect(error.message).toBe('UNAVAILABLE');
      expect(error.cause).toBeUndefined();
      expect(everythingIn(error)).not.toContain('aborted');
    });

    it('does not end the process when a read fails before anybody reads', async () => {
      const storage = storageOn(await fakeAzure(breaking), AZURE_LIMITS);
      const object = await storage.get(key);
      // Long enough for the break to arrive. An unheard 'error' would fail this run as an uncaught
      // exception, and the check below would pass all the same.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const error = await failureOf(buffer(object!.body));
      expect(error.failure).toBe('UNAVAILABLE');
    });

    it('ends a read that goes silent in UNAVAILABLE', async () => {
      const storage = storageOn(
        await fakeAzure((request, response) => {
          request.resume();
          response.writeHead(200, downloadHeaders(SIZE));
          response.write(Buffer.alloc(HALF));
        }),
      );
      const object = await storage.get(key);
      const error = await failureOf(buffer(object!.body));
      expect(error.failure).toBe('UNAVAILABLE');
    });

    it('lets a slow reader take its time: only waiting for the provider counts', async () => {
      // More than the body buffers, so it stops asking the provider while the reader holds on.
      const large = Buffer.alloc(4 * 1024 * 1024);
      const storage = storageOn(
        await fakeAzure((request, response) => {
          request.resume();
          response.writeHead(200, downloadHeaders(large.length));
          response.end(large);
        }),
      );
      const object = await storage.get(key);
      let bytes = 0;
      let paused = false;
      for await (const chunk of object!.body) {
        bytes += (chunk as Buffer).length;
        if (!paused) {
          paused = true;
          await new Promise((resolve) => setTimeout(resolve, SHORT.silenceMs * 2));
        }
      }
      expect(bytes).toBe(large.length);
    });

    it('ends the request when a reader closes the body, read or not', async () => {
      for (const readFirst of [true, false]) {
        let closed = (): void => undefined;
        const connectionClosed = new Promise<void>((resolve) => {
          closed = resolve;
        });
        const storage = storageOn(
          await fakeAzure((request, response) => {
            request.resume();
            response.on('close', closed);
            response.writeHead(200, downloadHeaders(SIZE));
            response.write(Buffer.alloc(HALF));
          }),
          AZURE_LIMITS,
        );
        const object = await storage.get(key);
        if (readFirst) {
          await new Promise((resolve) => object!.body.once('readable', resolve));
        }
        object!.body.destroy();
        await connectionClosed;
        expect(object!.body.destroyed).toBe(true);
      }
    });
  });

  describe('a signed URL', () => {
    const upload = (storage: AzureBlobStorage) =>
      storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: 60 });
    const download = (storage: AzureBlobStorage) =>
      storage.signDownload(key, {
        contentType: CONTENT_TYPE,
        downloadName: 'report-1.pdf',
        seconds: 60,
      });

    function queryOf(url: string): URLSearchParams {
      return new URL(url).searchParams;
    }

    it('for an upload may create only, and says what to send', async () => {
      const request = await upload(storageOn(await fakeAzure(answer(201))));
      expect(request.method).toBe('PUT');
      expect(request.expiresAt.equals(NOW.add({ seconds: 60 }))).toBe(true);
      expect(request.headers).toEqual({
        'x-ms-blob-type': 'BlockBlob',
        'content-type': CONTENT_TYPE,
      });
      const query = queryOf(request.url);
      expect(query.get('sp')).toBe('c');
      expect(query.get('sr')).toBe('b');
      expect(query.get('se')).toBe('2027-03-28T01:31:00Z');
      // No start time: a clock behind Azure's would make a fresh URL fail.
      expect(query.has('st')).toBe(false);
    });

    it('for a download may read only, and needs no network', async () => {
      const request = await download(storageOn('http://127.0.0.1:9/devstoreaccount1'));
      expect(request.method).toBe('GET');
      expect(request.headers).toEqual({});
      const query = queryOf(request.url);
      expect(query.get('sp')).toBe('r');
      expect(query.get('rsct')).toBe(CONTENT_TYPE);
      expect(query.get('rscd')).toBe('attachment; filename="report-1.pdf"');
      expect(query.get('se')).toBe('2027-03-28T01:31:00Z');
    });

    it('holds its path in the form of the key, and never the account key', async () => {
      const { url } = await download(storageOn('http://127.0.0.1:9/devstoreaccount1'));
      expect(new URL(url).pathname).toBe(
        `/devstoreaccount1/practice-${key.practiceId}/${key.path}`,
      );
      expect(url).not.toContain('a2V5');
    });

    it('uses https only as its protocol where the endpoint has it, and both on the emulator', async () => {
      const onEmulator = await download(storageOn('http://127.0.0.1:9/devstoreaccount1'));
      expect(queryOf(onEmulator.url).get('spr')).toBe('https,http');
      const onAzure = await download(storageOn('https://files.example.test'));
      expect(queryOf(onAzure.url).get('spr')).toBe('https');
    });

    it('goes to the public URL when there is one, with the same signature', async () => {
      const endpoint = 'http://azurite:10000/devstoreaccount1';
      const direct = await download(storageOn(endpoint));
      const clock = new FixedClock(NOW);
      const connection = { accountName: 'devstoreaccount1', accountKey: 'a2V5' };
      const viaPublic = await download(
        new AzureBlobStorage(clock, {
          ...connection,
          blobEndpoint: endpoint,
          publicBlobUrl: 'http://localhost:10000/devstoreaccount1',
        }),
      );
      expect(viaPublic.url.startsWith('http://localhost:10000/devstoreaccount1/practice-')).toBe(
        true,
      );
      expect(queryOf(viaPublic.url).get('sig')).toBe(queryOf(direct.url).get('sig'));
    });
  });
});
