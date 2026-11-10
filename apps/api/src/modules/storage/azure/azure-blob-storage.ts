import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  BlobSASPermissions,
  type BlobSASSignatureValues,
  BlobServiceClient,
  type BlockBlobClient,
  type ContainerClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import type { Clock } from '../../../common/time/clock.js';
import { dbInstantOf } from '../../../common/time/convert.js';
import type { ObjectKey } from '../object-key.js';
import {
  DOWNLOAD_CACHE_CONTROL,
  type ObjectInfo,
  ObjectStorage,
  type ObjectStorageDescription,
  ObjectStorageError,
  type ObjectStorageFailure,
  type SignedRequest,
  type StoredObject,
} from '../object-storage.js';
import type { AzureConnection } from './azure-connection-string.js';

/** Azure's answers for "nothing there": a missing object, or a practice that never stored one. */
const NOTHING_THERE: ReadonlySet<unknown> = new Set(['BlobNotFound', 'ContainerNotFound']);

/** A provider's code reaches logs and the check command: only what looks like a code. */
const PROVIDER_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** A stream goes up in blocks of about this size, and one block is what it holds in memory. */
const BLOCK_BYTES = 8 * 1024 * 1024;

const RETRY_OPTIONS = {
  maxTries: 3,
  tryTimeoutInMs: 30_000,
  retryDelayInMs: 500,
  maxRetryDelayInMs: 5000,
} as const;

/**
 * How long the API waits. `tryTimeoutInMs` does not bound this: it only tells the server how long it
 * may take, and a request to a server that stays silent was still waiting after ten times that value
 * (measured, F09). An abort signal does end it.
 */
export const AZURE_LIMITS = {
  /** One call that moves no file, with its retries. */
  callMs: 30_000,
  /** One upload, or one block of a stream: longer than all tries of RETRY_OPTIONS together. */
  transferMs: 120_000,
  /** The next chunk of a download, while the reader waits for one. */
  silenceMs: 30_000,
} as const;

export type AzureLimits = Readonly<Record<keyof typeof AZURE_LIMITS, number>>;

export interface AzureBlobConnection extends AzureConnection {
  /** Where a browser reaches the blob endpoint when the API reaches it elsewhere (compose). */
  readonly publicBlobUrl?: string | undefined;
}

function failureOf(status: number | undefined): ObjectStorageFailure {
  if (status === undefined || status >= 500 || status === 408 || status === 429) {
    return 'UNAVAILABLE';
  }
  return status === 401 || status === 403 ? 'REFUSED' : 'FAILED';
}

/** What the SDK's errors carry. A failure of the network has no status and only `code`. */
interface SdkFailure {
  readonly statusCode?: unknown;
  readonly code?: unknown;
  readonly details?: { readonly errorCode?: unknown };
}

/** Azure's code. An answer without a body, as to a HEAD, has it only in `details`, from its header. */
function codeOf(error: unknown): unknown {
  const { code, details } = (error ?? {}) as SdkFailure;
  return details?.errorCode ?? code;
}

/** Our error, with the status and the code of the SDK's and nothing else: a RestError holds the request. */
export function objectStorageErrorOf(error: unknown): ObjectStorageError {
  const status = ((error ?? {}) as SdkFailure).statusCode;
  const code = codeOf(error);
  const providerStatus = typeof status === 'number' ? status : undefined;
  return new ObjectStorageError(
    failureOf(providerStatus),
    providerStatus,
    typeof code === 'string' && PROVIDER_CODE.test(code) ? code : undefined,
  );
}

/**
 * The chunks a reader gets. A failure leaves as our error. A broken connection ends the SDK's stream
 * at once, but nothing of it ends a read that goes silent, so this waits a limited time for the next
 * chunk, and only while the reader wants one.
 */
async function* chunksOf(
  source: Readable,
  abort: () => void,
  silenceMs: number,
): AsyncGenerator<Uint8Array> {
  const chunks = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  try {
    for (;;) {
      const watchdog = setTimeout(abort, silenceMs);
      const next = await chunks.next().finally(() => {
        clearTimeout(watchdog);
      });
      if (next.done === true) return;
      yield next.value;
    }
  } catch (error) {
    throw objectStorageErrorOf(error);
  }
}

/** Cuts a stream into blocks. A larger chunk stays whole: Azure takes far larger blocks than this. */
async function* blocksOf(content: Readable): AsyncGenerator<Buffer> {
  let held: Buffer[] = [];
  let heldBytes = 0;
  for await (const chunk of content) {
    const bytes = Buffer.from(chunk as Uint8Array);
    held.push(bytes);
    heldBytes += bytes.length;
    if (heldBytes >= BLOCK_BYTES) {
      yield Buffer.concat(held);
      held = [];
      heldBytes = 0;
    }
  }
  if (heldBytes > 0) yield Buffer.concat(held);
}

/** Copy Blob leaves these on the object, also a copy into a key through a signed upload. */
function isCopy({ copyId, copyStatus }: { copyId?: string; copyStatus?: string }): boolean {
  return copyId !== undefined || copyStatus !== undefined;
}

function containerNameOf(practiceId: string): string {
  return `practice-${practiceId}`;
}

/**
 * Azure Blob Storage, and Azurite in development. Every practice has its own container, so deleting
 * a practice's files is one call. The only file that imports the SDK, and it gets parsed values, never
 * the connection string (azure-connection-string.ts). Constructing it does no network call.
 */
export class AzureBlobStorage extends ObjectStorage {
  private readonly accountName: string;
  private readonly host: string;
  private readonly signedUrlBase: string;
  private readonly protocol: SASProtocol;
  private readonly credential: StorageSharedKeyCredential;
  private readonly service: BlobServiceClient;

  constructor(
    clock: Clock,
    connection: AzureBlobConnection,
    private readonly limits: AzureLimits = AZURE_LIMITS,
  ) {
    super(clock);
    const { accountName, accountKey, blobEndpoint, publicBlobUrl } = connection;
    this.accountName = accountName;
    this.host = new URL(blobEndpoint).host;
    this.signedUrlBase = publicBlobUrl ?? blobEndpoint;
    this.protocol = blobEndpoint.startsWith('https:')
      ? SASProtocol.Https
      : SASProtocol.HttpsAndHttp;
    this.credential = new StorageSharedKeyCredential(accountName, accountKey);
    this.service = new BlobServiceClient(blobEndpoint, this.credential, {
      retryOptions: RETRY_OPTIONS,
    });
  }

  describe(): ObjectStorageDescription {
    return { provider: 'azure', place: `${this.accountName} at ${this.host}` };
  }

  async get(key: ObjectKey): Promise<StoredObject | undefined> {
    const reading = new AbortController();
    const abort = (): void => {
      reading.abort();
    };
    // Up to the answer's headers only: the reading itself has its own limit in chunksOf.
    const deadline = setTimeout(abort, this.limits.callMs);
    const response = await this.guardedOrNothing(() =>
      this.blobOf(key).download(0, undefined, { abortSignal: reading.signal }),
    ).finally(() => {
      clearTimeout(deadline);
    });
    if (response === undefined) return undefined;
    return {
      size: response.contentLength ?? 0,
      contentType: response.contentType ?? DEFAULT_CONTENT_TYPE,
      copied: isCopy(response),
      // Only a browser build of the SDK answers without it.
      body: this.bodyOf(response.readableStreamBody as Readable, abort),
    };
  }

  async head(key: ObjectKey): Promise<ObjectInfo | undefined> {
    const properties = await this.guardedOrNothing(() =>
      this.blobOf(key).getProperties({ abortSignal: this.callLimit() }),
    );
    if (properties === undefined) return undefined;
    return {
      size: properties.contentLength ?? 0,
      contentType: properties.contentType ?? DEFAULT_CONTENT_TYPE,
      copied: isCopy(properties),
    };
  }

  async delete(key: ObjectKey): Promise<void> {
    await this.guardedOrNothing(() =>
      this.blobOf(key).deleteIfExists({ abortSignal: this.callLimit() }),
    );
  }

  protected async store(
    key: ObjectKey,
    content: Uint8Array | Readable,
    contentType: string,
  ): Promise<void> {
    const container = await this.ensuredContainer(key.practiceId);
    const blob = container.getBlockBlobClient(key.path);
    const blobHTTPHeaders = { blobContentType: contentType };
    await this.guarded(async () => {
      if (content instanceof Uint8Array) {
        await blob.uploadData(content, { blobHTTPHeaders, abortSignal: this.transferLimit() });
      } else {
        await this.uploadBlocks(blob, content, blobHTTPHeaders);
      }
    });
  }

  protected async removeAllOf(practiceId: string): Promise<void> {
    await this.guarded(() =>
      this.service
        .getContainerClient(containerNameOf(practiceId))
        .deleteIfExists({ abortSignal: this.callLimit() }),
    );
  }

  protected async signedUpload(
    key: ObjectKey,
    contentType: string,
    expiresAt: Temporal.Instant,
  ): Promise<SignedRequest> {
    await this.ensuredContainer(key.practiceId);
    return {
      method: 'PUT',
      // `c` alone creates a blob and refuses to replace one: write once.
      url: await this.signedUrl(key, expiresAt, { permissions: BlobSASPermissions.parse('c') }),
      headers: { 'x-ms-blob-type': 'BlockBlob', 'content-type': contentType },
      expiresAt,
    };
  }

  protected async signedDownload(
    key: ObjectKey,
    response: { readonly contentType: string; readonly downloadName: string },
    expiresAt: Temporal.Instant,
  ): Promise<SignedRequest> {
    return {
      method: 'GET',
      // The uploader chose the object's other headers: these override the ones a browser acts on.
      url: await this.signedUrl(key, expiresAt, {
        permissions: BlobSASPermissions.parse('r'),
        contentType: response.contentType,
        contentDisposition: `attachment; filename="${response.downloadName}"`,
        cacheControl: DOWNLOAD_CACHE_CONTROL,
      }),
      headers: {},
      expiresAt,
    };
  }

  /**
   * A stream, block by block. Not the SDK's uploadStream: it hands no abort signal to the requests of
   * its blocks, so a silent server would hold it forever (measured, F09). A stream that never ends is
   * its owner's: this limits what the provider does, not what the caller's stream does.
   */
  private async uploadBlocks(
    blob: BlockBlobClient,
    content: Readable,
    blobHTTPHeaders: { readonly blobContentType: string },
  ): Promise<void> {
    const upload = randomUUID();
    const blockIds: string[] = [];
    for await (const block of blocksOf(content)) {
      const number = String(blockIds.length).padStart(8, '0');
      const blockId = Buffer.from(`${upload}-${number}`).toString('base64');
      await blob.stageBlock(blockId, block, block.length, { abortSignal: this.transferLimit() });
      blockIds.push(blockId);
    }
    await blob.commitBlockList(blockIds, { blobHTTPHeaders, abortSignal: this.callLimit() });
  }

  private bodyOf(source: Readable, abort: () => void): Readable {
    // Until a reader starts, this is the only listener: an unheard 'error' ends the process.
    source.on('error', () => undefined);
    const body = Readable.from(chunksOf(source, abort, this.limits.silenceMs), {
      objectMode: false,
    });
    // Also when a reader never started: closing the body ends the request behind it.
    body.once('close', () => {
      source.destroy();
    });
    return body;
  }

  /** No public access. No cache: uploads are rare, and a cache has to be invalidated. */
  private async ensuredContainer(practiceId: string): Promise<ContainerClient> {
    const container = this.service.getContainerClient(containerNameOf(practiceId));
    await this.guarded(() => container.createIfNotExists({ abortSignal: this.callLimit() }));
    return container;
  }

  private blobOf({ practiceId, path }: ObjectKey): BlockBlobClient {
    return this.service.getContainerClient(containerNameOf(practiceId)).getBlockBlobClient(path);
  }

  private signedUrl(
    { practiceId, path }: ObjectKey,
    expiresAt: Temporal.Instant,
    values: Pick<
      BlobSASSignatureValues,
      'permissions' | 'contentType' | 'contentDisposition' | 'cacheControl'
    >,
  ): Promise<string> {
    const containerName = containerNameOf(practiceId);
    return this.guarded(() => {
      const query = generateBlobSASQueryParameters(
        {
          containerName,
          blobName: path,
          // No start time: a clock behind Azure's would make a fresh URL fail.
          expiresOn: dbInstantOf(expiresAt),
          protocol: this.protocol,
          ...values,
        },
        this.credential,
      );
      const segments = path.split('/').map((segment) => encodeURIComponent(segment));
      return Promise.resolve(
        `${this.signedUrlBase}/${containerName}/${segments.join('/')}?${query.toString()}`,
      );
    });
  }

  private callLimit(): AbortSignal {
    return AbortSignal.timeout(this.limits.callMs);
  }

  private transferLimit(): AbortSignal {
    return AbortSignal.timeout(this.limits.transferMs);
  }

  /** Every call of the SDK goes through here: what leaves is our error, never the SDK's. */
  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw objectStorageErrorOf(error);
    }
  }

  /** The same for a read or a delete, where nothing there is an answer. Another 404 is not. */
  private async guardedOrNothing<T>(call: () => Promise<T>): Promise<T | undefined> {
    try {
      return await call();
    } catch (error) {
      if (NOTHING_THERE.has(codeOf(error))) return undefined;
      throw objectStorageErrorOf(error);
    }
  }
}
