/**
 * Control menu "Datei-Speicher prüfen": every step a file takes, with synthetic bytes under a new
 * practice id, so a wrong key shows at once and not only when a patient's file fails. One JSON line
 * with the failed step and its codes, never a URL, a key or a provider's message; exit 1 when a step
 * failed. Whatever it stored is removed at the end, also after a failure. Reads the environment of
 * the API, like main.ts.
 */
import { randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { SystemClock } from '../common/time/system-clock.js';
import { parseEnv } from '../config/env.schema.js';
import { loadWorkspaceEnv } from '../config/load-env.js';
import { ObjectKey } from '../modules/storage/object-key.js';
import { objectStorageFor } from '../modules/storage/object-storage.factory.js';
import { ObjectStorageError, type SignedRequest } from '../modules/storage/object-storage.js';

loadWorkspaceEnv(import.meta.dirname, process.env.NODE_ENV);

const BYTES = Buffer.from('Synthetic bytes of the storage check.');
const CONTENT_TYPE = 'application/pdf';
const DOWNLOAD_NAME = 'storage-check.pdf';
const SECONDS = 60;

const env = parseEnv(process.env);
// This runs inside the API container, where the public URL's localhost is not Azurite.
const storage = objectStorageFor(
  { ...env, STORAGE_AZURE_PUBLIC_BLOB_URL: undefined },
  new SystemClock(),
);
const practiceId = randomUUID();
const stored = ObjectKey.of(practiceId, 'check/stored');
const uploaded = ObjectKey.of(practiceId, 'check/uploaded');

/** Not its error: a failed fetch can name the host in its cause. */
async function send(request: SignedRequest, body?: Uint8Array): Promise<Response> {
  try {
    return await fetch(request.url, { method: request.method, headers: request.headers, body });
  } catch {
    throw new ObjectStorageError('UNAVAILABLE');
  }
}

function confirm(condition: boolean, status?: number): void {
  if (!condition) throw new ObjectStorageError('FAILED', status);
}

const STEPS: readonly (readonly [string, () => Promise<void>])[] = [
  ['put', () => storage.put(stored, BYTES, CONTENT_TYPE)],
  [
    'head',
    async () => {
      const info = await storage.head(stored);
      confirm(info?.size === BYTES.length && info.contentType === CONTENT_TYPE);
    },
  ],
  [
    'get',
    async () => {
      const object = await storage.get(stored);
      confirm(object !== undefined && (await buffer(object.body)).equals(BYTES));
    },
  ],
  [
    'signed-upload',
    async () => {
      const request = await storage.signUpload(uploaded, {
        contentType: CONTENT_TYPE,
        seconds: SECONDS,
      });
      const response = await send(request, BYTES);
      confirm(response.ok, response.status);
    },
  ],
  [
    'second-signed-upload-refused',
    async () => {
      const request = await storage.signUpload(uploaded, {
        contentType: CONTENT_TYPE,
        seconds: SECONDS,
      });
      const response = await send(request, BYTES);
      confirm(!response.ok, response.status);
    },
  ],
  [
    'signed-download',
    async () => {
      const request = await storage.signDownload(uploaded, {
        contentType: CONTENT_TYPE,
        downloadName: DOWNLOAD_NAME,
        seconds: SECONDS,
      });
      const response = await send(request);
      const bytes = Buffer.from(await response.arrayBuffer());
      const disposition = response.headers.get('content-disposition');
      confirm(
        response.ok && bytes.equals(BYTES) && disposition?.includes(DOWNLOAD_NAME) === true,
        response.status,
      );
    },
  ],
  [
    'delete',
    async () => {
      await storage.delete(stored);
      confirm((await storage.head(stored)) === undefined);
    },
  ],
  ['delete-all', () => storage.deleteAllOf(practiceId)],
];

const done: string[] = [];
let failure: Readonly<Record<string, unknown>> | undefined;
for (const [step, run] of STEPS) {
  try {
    await run();
    done.push(step);
  } catch (error) {
    const known = error instanceof ObjectStorageError;
    failure = {
      step,
      failure: known ? error.failure : 'FAILED',
      providerStatus: known ? error.providerStatus : undefined,
      providerCode: known ? error.providerCode : undefined,
    };
    break;
  }
}

if (failure !== undefined) {
  // What the failure left behind. It says nothing new when this fails as well.
  await storage.deleteAllOf(practiceId).catch(() => undefined);
}

process.stdout.write(
  `${JSON.stringify({
    command: 'storage:check',
    ok: failure === undefined,
    ...storage.describe(),
    steps: done,
    ...failure,
  })}\n`,
);
process.exitCode = failure === undefined ? 0 : 1;
