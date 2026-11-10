/**
 * The Azure adapter against a real Azurite, started with the command line of compose.dev.yaml (F09,
 * ADR 0015): the contract of the port, and what only a real service can show. Nothing here has run
 * against a real Azure account: that needs the user's credentials.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../../src/common/time/fixed-clock.js';
import { SystemClock } from '../../../src/common/time/system-clock.js';
import { AzureBlobStorage } from '../../../src/modules/storage/azure/azure-blob-storage.js';
import { ObjectKey } from '../../../src/modules/storage/object-key.js';
import { ObjectStorageError } from '../../../src/modules/storage/object-storage.js';
import { childEnv } from '../../support/child-env.js';
import {
  describeObjectStorageContract,
  sendByFetch,
} from '../../support/object-storage-contract.js';
import { UUID } from '../../support/patterns.js';
import { readContainerLog } from '../probes/container-log.js';
import { AZURITE_IMAGE } from '../support/azurite-image.js';
import { runNode } from '../support/run-node.js';

const API_DIR = path.resolve(import.meta.dirname, '../../..');
const HOOKS = pathToFileURL(path.join(API_DIR, 'test/support/ts-source-hooks.ts')).href;

const PORT = 10_000;

/** compose.dev.yaml's command: without --silent the access log would hold signed URLs. */
const COMMAND = [
  'azurite-blob',
  '--blobHost',
  '0.0.0.0',
  '--location',
  '/data',
  '--disableProductStyleUrl',
  '--skipApiVersionCheck',
  '--silent',
];

const ACCOUNT = 'devstoreaccount1';

/** The emulator's key, published by Microsoft in the Azurite documentation: no secret. */
const EMULATOR_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

const BYTES = Buffer.from('synthetic bytes of a test file');
const CONTENT_TYPE = 'application/pdf';

/** ObjectKey's rule for a path, written again: this test does not trust the code it checks. */
const OBJECT_PATH = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

let container: StartedTestContainer | undefined;
let port: number;
let blobEndpoint: string;

beforeAll(async () => {
  container = await new GenericContainer(AZURITE_IMAGE)
    .withCommand(COMMAND)
    .withExposedPorts(PORT)
    .withWaitStrategy(Wait.forLogMessage('successfully listens'))
    .start();
  port = container.getMappedPort(PORT);
  blobEndpoint = `http://127.0.0.1:${String(port)}/${ACCOUNT}`;
});

afterAll(async () => {
  await container?.stop();
});

function storageOn(
  endpoint: string,
  options: { readonly accountKey?: string; readonly publicBlobUrl?: string } = {},
): AzureBlobStorage {
  return new AzureBlobStorage(new SystemClock(), {
    accountName: ACCOUNT,
    accountKey: options.accountKey ?? EMULATOR_KEY,
    blobEndpoint: endpoint,
    publicBlobUrl: options.publicBlobUrl,
  });
}

function keyIn(practiceId: string = randomUUID()): ObjectKey {
  return ObjectKey.of(practiceId, `attachments/${randomUUID()}/original`);
}

/** The SDK itself, for what the port does not show on purpose. */
function service(): BlobServiceClient {
  return new BlobServiceClient(blobEndpoint, new StorageSharedKeyCredential(ACCOUNT, EMULATOR_KEY));
}

async function failureOf(attempt: Promise<unknown>): Promise<ObjectStorageError> {
  const outcome = await attempt.then(
    () => new Error('it should have failed'),
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(ObjectStorageError);
  return outcome as ObjectStorageError;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

describeObjectStorageContract('Azure Blob Storage on Azurite', () => {
  const clock = new FixedClock(new SystemClock().now());
  return {
    storage: new AzureBlobStorage(clock, {
      accountName: ACCOUNT,
      accountKey: EMULATOR_KEY,
      blobEndpoint,
    }),
    clock,
    send: sendByFetch,
  };
});

describe('AzureBlobStorage on Azurite', () => {
  it('names the account and the host, and no key', () => {
    const description = storageOn(blobEndpoint).describe();
    expect(description).toEqual({
      provider: 'azure',
      place: `${ACCOUNT} at 127.0.0.1:${String(port)}`,
    });
    expect(JSON.stringify(description)).not.toContain(EMULATOR_KEY);
  });

  it('gives a stream back byte for byte across several blocks', async () => {
    const storage = storageOn(blobEndpoint);
    const key = keyIn();
    const bytes = randomBytes(9 * 1024 * 1024);
    const chunks = [bytes.subarray(0, 5_000_000), bytes.subarray(5_000_000)];
    await storage.put(key, Readable.from(chunks), CONTENT_TYPE);
    const object = await storage.get(key);
    expect(object?.size).toBe(bytes.length);
    expect((await buffer(object!.body)).equals(bytes)).toBe(true);
  });

  it('fails a put when its stream fails, and stores nothing', async () => {
    const storage = storageOn(blobEndpoint);
    const key = keyIn();
    const failing = new Readable({
      read() {
        this.destroy(new Error('synthetic stream failure'));
      },
    });
    const error = await failureOf(storage.put(key, failing, CONTENT_TYPE));
    expect(error.message).toBe('UNAVAILABLE');
    expect(await storage.head(key)).toBeUndefined();
  });

  it('creates a container without public access, for a put and for a signed upload', async () => {
    const storage = storageOn(blobEndpoint);
    const stored = keyIn();
    const signed = keyIn();
    await storage.put(stored, BYTES, CONTENT_TYPE);
    await storage.signUpload(signed, { contentType: CONTENT_TYPE, seconds: 60 });
    for (const key of [stored, signed]) {
      const policy = await service()
        .getContainerClient(`practice-${key.practiceId}`)
        .getAccessPolicy();
      expect(policy.blobPublicAccess).toBeUndefined();
    }
  });

  it('refuses a read without a signature', async () => {
    const storage = storageOn(blobEndpoint);
    const key = keyIn();
    await storage.put(key, BYTES, CONTENT_TYPE);
    const { url } = await storage.signDownload(key, {
      contentType: CONTENT_TYPE,
      downloadName: 'file.pdf',
      seconds: 60,
    });
    const response = await fetch(url.slice(0, url.indexOf('?')));
    expect(response.status).toBe(403);
    expect(Buffer.from(await response.arrayBuffer()).includes(BYTES)).toBe(false);
  });

  it('signs a write-once upload for this blob only, and a read-only download with its response headers', async () => {
    const storage = storageOn(blobEndpoint);
    const key = keyIn();
    const upload = await storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: 60 });
    const uploadQuery = new URL(upload.url).searchParams;
    expect([...uploadQuery.keys()].sort()).toEqual(['se', 'sig', 'sp', 'spr', 'sr', 'sv']);
    expect(uploadQuery.get('sp')).toBe('c');
    expect(uploadQuery.get('sr')).toBe('b');
    expect(upload.headers).toEqual({
      'x-ms-blob-type': 'BlockBlob',
      'content-type': CONTENT_TYPE,
    });
    expect(upload.url).not.toContain(EMULATOR_KEY);
    expect((await sendByFetch(upload, BYTES)).status).toBe(201);

    const download = await storage.signDownload(key, {
      contentType: 'text/plain',
      downloadName: 'report-1.pdf',
      seconds: 60,
    });
    const downloadQuery = new URL(download.url).searchParams;
    expect(downloadQuery.get('sp')).toBe('r');
    expect(downloadQuery.get('sr')).toBe('b');
    const response = await sendByFetch(download);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="report-1.pdf"');
    expect(response.headers.get('content-length')).toBe(String(BYTES.length));
    // Why R02 serves `nosniff` another way: Azurite does not send it and a SAS cannot add it.
    expect(response.headers.get('x-content-type-options')).toBeNull();
  });

  it('shows a copy that came through a signed upload, which R02 refuses', async () => {
    const storage = storageOn(blobEndpoint);
    const source = keyIn();
    await storage.put(source, BYTES, CONTENT_TYPE);
    const target = keyIn();
    const upload = await storage.signUpload(target, { contentType: CONTENT_TYPE, seconds: 60 });
    // Found by the security review: `c` also allows Copy Blob, here even from another practice.
    const sourceUrl = `${blobEndpoint}/practice-${source.practiceId}/${source.path}`;
    const response = await fetch(upload.url, {
      method: 'PUT',
      headers: { 'x-ms-copy-source': sourceUrl },
    });
    expect(response.status).toBe(202);
    expect(await storage.head(target)).toMatchObject({ copied: true });
    const object = await storage.get(target);
    object?.body.destroy();
    expect(object?.copied).toBe(true);
    expect(await storage.head(source)).toMatchObject({ copied: false });
  });

  it('needs the headers it returned: a PUT without them stores nothing', async () => {
    const storage = storageOn(blobEndpoint);
    const key = keyIn();
    const { url } = await storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: 60 });
    const response = await fetch(url, { method: 'PUT', body: BYTES });
    expect(response.status).toBe(400);
    expect(await storage.head(key)).toBeUndefined();
  });

  it('refuses a DELETE with a signed download, and the object stays', async () => {
    const storage = storageOn(blobEndpoint);
    const key = keyIn();
    await storage.put(key, BYTES, CONTENT_TYPE);
    const { url } = await storage.signDownload(key, {
      contentType: CONTENT_TYPE,
      downloadName: 'file.pdf',
      seconds: 60,
    });
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(403);
    expect((await storage.head(key))?.size).toBe(BYTES.length);
  });

  it('signs with the public URL on another host name, and the signature holds there', async () => {
    const publicBlobUrl = `http://localhost:${String(port)}/${ACCOUNT}`;
    const storage = storageOn(blobEndpoint, { publicBlobUrl });
    const key = keyIn();
    const upload = await storage.signUpload(key, { contentType: CONTENT_TYPE, seconds: 60 });
    expect(upload.url.startsWith(`${publicBlobUrl}/practice-${key.practiceId}/`)).toBe(true);
    expect((await sendByFetch(upload, BYTES)).status).toBe(201);
    const download = await storage.signDownload(key, {
      contentType: CONTENT_TYPE,
      downloadName: 'file.pdf',
      seconds: 60,
    });
    expect(download.url.startsWith(publicBlobUrl)).toBe(true);
    expect(Buffer.from(await (await sendByFetch(download)).arrayBuffer())).toEqual(BYTES);
  });

  it('answers REFUSED for a wrong key, with no secret in the error', async () => {
    const wrongKey = randomBytes(32).toString('base64');
    const storage = storageOn(blobEndpoint, { accountKey: wrongKey });
    for (const attempt of [
      () => storage.head(keyIn()),
      () => storage.get(keyIn()),
      () => storage.put(keyIn(), BYTES, CONTENT_TYPE),
      () => storage.delete(keyIn()),
      () => storage.deleteAllOf(randomUUID()),
    ]) {
      const error = await failureOf(attempt());
      expect(error).toMatchObject({
        failure: 'REFUSED',
        providerStatus: 403,
        providerCode: 'AuthorizationFailure',
      });
      expect(error.message).toBe('REFUSED');
      expect(error.cause).toBeUndefined();
      expect(inspect(error, { depth: 8, showHidden: true })).not.toContain(wrongKey);
    }
  });

  it('answers UNAVAILABLE for a closed port', async () => {
    const closed = createServer();
    const closedPort = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    const storage = storageOn(`http://127.0.0.1:${String(closedPort)}/${ACCOUNT}`);
    const error = await failureOf(storage.head(keyIn()));
    expect(error).toMatchObject({ failure: 'UNAVAILABLE', providerCode: 'ECONNREFUSED' });
    expect(error.providerStatus).toBeUndefined();
  });

  it(
    'answers UNAVAILABLE within its limit when a server accepts and never answers',
    { timeout: 60_000 },
    async () => {
      const silent = createServer();
      try {
        const silentPort = await listen(silent);
        const storage = storageOn(`http://127.0.0.1:${String(silentPort)}/${ACCOUNT}`);
        const started = performance.now();
        const error = await failureOf(storage.head(keyIn()));
        expect(error.failure).toBe('UNAVAILABLE');
        // The limit is 30 seconds. Without the abort signal this request would wait forever.
        expect(performance.now() - started).toBeLessThan(40_000);
      } finally {
        silent.close();
      }
    },
  );

  describe('the check command', () => {
    const run = (variables: NodeJS.ProcessEnv) =>
      runNode(['--import', HOOKS, path.join(API_DIR, 'src/cli/check-storage.ts')], {
        cwd: API_DIR,
        env: childEnv({
          // Reads no `.env`, so the run does not depend on the developer's file.
          NODE_ENV: 'production',
          APP_ENV: 'ci',
          PLATFORM_DATABASE_URL: 'postgresql://test:test@127.0.0.1:9/none',
          STORAGE_PROVIDER: '',
          STORAGE_AZURE_CONNECTION_STRING: '',
          STORAGE_AZURE_PUBLIC_BLOB_URL: '',
          ...variables,
        }),
      });

    function connectionString(accountKey: string): string {
      return `DefaultEndpointsProtocol=http;AccountName=${ACCOUNT};AccountKey=${accountKey};BlobEndpoint=${blobEndpoint};`;
    }

    async function containerNames(): Promise<ReadonlySet<string>> {
      const names = new Set<string>();
      for await (const { name } of service().listContainers()) names.add(name);
      return names;
    }

    it('passes every step, ignores the public URL and leaves nothing behind', async () => {
      const before = await containerNames();
      const { exitCode, stdout, stderr } = await run({
        STORAGE_PROVIDER: 'azure',
        STORAGE_AZURE_CONNECTION_STRING: connectionString(EMULATOR_KEY),
        // Nothing listens there: compose's address, which a container cannot use.
        STORAGE_AZURE_PUBLIC_BLOB_URL: 'http://localhost:9/devstoreaccount1',
      });
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        command: 'storage:check',
        ok: true,
        provider: 'azure',
        place: `${ACCOUNT} at 127.0.0.1:${String(port)}`,
        steps: [
          'put',
          'head',
          'get',
          'signed-upload',
          'second-signed-upload-refused',
          'signed-download',
          'delete',
          'delete-all',
        ],
      });
      expect(stdout).not.toContain(EMULATOR_KEY);
      expect(stdout).not.toContain('sig=');
      const added = [...(await containerNames())].filter((name) => !before.has(name));
      expect(added).toEqual([]);
    });

    it('names the failed step and its codes, with exit 1 and no key', async () => {
      const wrongKey = randomBytes(32).toString('base64');
      const { exitCode, stdout, stderr } = await run({
        STORAGE_PROVIDER: 'azure',
        STORAGE_AZURE_CONNECTION_STRING: connectionString(wrongKey),
      });
      expect(stderr).toBe('');
      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout)).toEqual({
        command: 'storage:check',
        ok: false,
        provider: 'azure',
        place: `${ACCOUNT} at 127.0.0.1:${String(port)}`,
        steps: [],
        step: 'put',
        failure: 'REFUSED',
        providerStatus: 403,
        providerCode: 'AuthorizationFailure',
      });
      expect(stdout).not.toContain(wrongKey);
    });

    it('says NOT_CONFIGURED when no provider is set', async () => {
      const { exitCode, stdout } = await run({});
      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout)).toEqual({
        command: 'storage:check',
        ok: false,
        provider: 'none',
        place: 'not configured',
        steps: [],
        step: 'put',
        failure: 'NOT_CONFIGURED',
      });
    });
  });

  // Last, so that it sees what every test above stored, through the adapter and through signed URLs.
  it("holds nothing in a stored object's whole path but what ObjectKey allows", async () => {
    const containers: string[] = [];
    const blobs: string[] = [];
    for await (const { name } of service().listContainers()) {
      containers.push(name);
      for await (const blob of service().getContainerClient(name).listBlobsFlat()) {
        blobs.push(blob.name);
      }
    }
    expect(containers.length).toBeGreaterThan(0);
    expect(blobs.length).toBeGreaterThan(0);
    for (const name of containers) {
      expect(name.startsWith('practice-')).toBe(true);
      expect(UUID.test(name.slice('practice-'.length))).toBe(true);
    }
    for (const name of blobs) expect(OBJECT_PATH.test(name)).toBe(true);
  });

  it("keeps no request in Azurite's log, where signed URLs would stand: what --silent is for", async () => {
    const log = await readContainerLog(container!.getId());
    expect(log).toContain('successfully listens');
    expect(log).not.toContain('sig=');
    expect(log).not.toContain('practice-');
  });
});
