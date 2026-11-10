import type { Readable } from 'node:stream';
import type { Clock } from '../../common/time/clock.js';
import { assertPracticeId, type ObjectKey } from './object-key.js';

/** The longest a signed URL lives (R02). */
const MAX_SIGNED_SECONDS = 300;

/** A plain media type without parameters. */
const CONTENT_TYPE = /^[a-z]+\/[a-z0-9.+-]+$/;

/** Travels in the URL, and health data never goes into a URL: never a patient's file name. */
const DOWNLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface ObjectInfo {
  readonly size: number;
  readonly contentType: string;
  /**
   * It came as a copy of another object, not as uploaded bytes. A signed upload on Azure also lets
   * its holder copy into the key, and a copy can finish after a check: R02 refuses such an object.
   */
  readonly copied: boolean;
}

/** How long a browser may keep a download: not at all, on a shared computer too (RT-94). */
export const DOWNLOAD_CACHE_CONTROL = 'private, no-store';

export interface StoredObject extends ObjectInfo {
  /** Read it to its end or destroy it: until then it holds a connection. */
  readonly body: Readable;
}

/** Which provider and which place. Never a key. */
export interface ObjectStorageDescription {
  readonly provider: string;
  readonly place: string;
}

export interface SignedRequest {
  readonly method: 'GET' | 'PUT';
  readonly url: string;
  /** What the caller must send along. Provider-specific headers live here, so no client knows the provider. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Temporal.Instant;
}

export interface SignUploadOptions {
  readonly contentType: string;
  readonly seconds: number;
}

export interface SignDownloadOptions extends SignUploadOptions {
  readonly downloadName: string;
}

export type ObjectStorageFailure = 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'REFUSED' | 'FAILED';

/**
 * What went wrong, in terms every provider shares. Its message is the failure and it has no cause: a
 * provider's error can hold the request, with its URL and headers.
 */
export class ObjectStorageError extends Error {
  constructor(
    readonly failure: ObjectStorageFailure,
    readonly providerStatus?: number,
    readonly providerCode?: string,
  ) {
    super(failure);
    this.name = 'ObjectStorageError';
  }
}

function assertContentType(contentType: string): void {
  if (!CONTENT_TYPE.test(contentType)) throw new TypeError('not a content type');
}

/**
 * The port of file storage (ADR 0015): one adapter per provider, and no feature knows which one runs.
 * The rules on lifetime, content type and download name stand here, in template methods, so that a
 * new provider cannot forget them. A bad argument is a programming error and throws a TypeError or a
 * RangeError, never an ObjectStorageError.
 */
export abstract class ObjectStorage {
  constructor(protected readonly clock: Clock) {}

  /** For the check command and logs. */
  abstract describe(): ObjectStorageDescription;

  /** undefined when nothing is there. */
  abstract get(key: ObjectKey): Promise<StoredObject | undefined>;

  abstract head(key: ObjectKey): Promise<ObjectInfo | undefined>;

  /** Nothing there is fine. */
  abstract delete(key: ObjectKey): Promise<void>;

  /** Stores it, replacing what is there. */
  async put(key: ObjectKey, content: Uint8Array | Readable, contentType: string): Promise<void> {
    assertContentType(contentType);
    await this.store(key, content, contentType);
  }

  /** Everything of one practice, for when it leaves (ADR 0005). Nothing there is fine; other practices are untouched. */
  async deleteAllOf(practiceId: string): Promise<void> {
    assertPracticeId(practiceId);
    await this.removeAllOf(practiceId);
  }

  /** Write once: this URL creates the object and cannot replace it. At most 300 seconds. */
  async signUpload(
    key: ObjectKey,
    { contentType, seconds }: SignUploadOptions,
  ): Promise<SignedRequest> {
    assertContentType(contentType);
    return await this.signedUpload(key, contentType, this.expiryAfter(seconds));
  }

  /** Read only. `downloadName` travels in the URL, so it is never a patient's file name. At most 300 seconds. */
  async signDownload(
    key: ObjectKey,
    { contentType, downloadName, seconds }: SignDownloadOptions,
  ): Promise<SignedRequest> {
    assertContentType(contentType);
    if (!DOWNLOAD_NAME.test(downloadName)) throw new TypeError('not a download name');
    return await this.signedDownload(key, { contentType, downloadName }, this.expiryAfter(seconds));
  }

  protected abstract store(
    key: ObjectKey,
    content: Uint8Array | Readable,
    contentType: string,
  ): Promise<void>;

  protected abstract removeAllOf(practiceId: string): Promise<void>;

  protected abstract signedUpload(
    key: ObjectKey,
    contentType: string,
    expiresAt: Temporal.Instant,
  ): Promise<SignedRequest>;

  protected abstract signedDownload(
    key: ObjectKey,
    response: { readonly contentType: string; readonly downloadName: string },
    expiresAt: Temporal.Instant,
  ): Promise<SignedRequest>;

  private expiryAfter(seconds: number): Temporal.Instant {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SIGNED_SECONDS) {
      throw new RangeError('a signed URL lives 1 to 300 seconds');
    }
    return this.clock.now().add({ seconds });
  }
}
