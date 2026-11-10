import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import type { ObjectKey } from '../../src/modules/storage/object-key.js';
import {
  DOWNLOAD_CACHE_CONTROL,
  type ObjectInfo,
  ObjectStorage,
  type ObjectStorageDescription,
  type SignedRequest,
  type StoredObject,
} from '../../src/modules/storage/object-storage.js';

interface HeldObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** What one signature allows: this object, this method, until then. */
interface Signature {
  readonly object: string;
  readonly method: SignedRequest['method'];
  readonly expiresAt: Temporal.Instant;
  /** The response headers a download gets from its URL. */
  readonly responseHeaders: Readonly<Record<string, string>>;
}

function nameOf({ practiceId, path }: ObjectKey): string {
  return `${practiceId}/${path}`;
}

/**
 * The port in memory, for unit tests. It stays honest through the contract suite: `send` refuses what
 * a real provider refuses, by method, expiry and the table of what it signed, so a test that uses a
 * signed request wrongly fails here too (`test/support/object-storage-contract.ts`).
 */
export class InMemoryObjectStorage extends ObjectStorage {
  private readonly objects = new Map<string, HeldObject>();
  private readonly signatures = new Map<string, Signature>();

  describe(): ObjectStorageDescription {
    return { provider: 'memory', place: 'this process' };
  }

  get(key: ObjectKey): Promise<StoredObject | undefined> {
    const held = this.objects.get(nameOf(key));
    if (held === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      size: held.bytes.length,
      contentType: held.contentType,
      // Nothing here copies: what a signed upload brings is bytes.
      copied: false,
      body: Readable.from(Buffer.from(held.bytes), { objectMode: false }),
    });
  }

  head(key: ObjectKey): Promise<ObjectInfo | undefined> {
    const held = this.objects.get(nameOf(key));
    if (held === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      size: held.bytes.length,
      contentType: held.contentType,
      copied: false,
    });
  }

  delete(key: ObjectKey): Promise<void> {
    this.objects.delete(nameOf(key));
    return Promise.resolve();
  }

  /** The request a browser would send. Answers as a provider does, in a Response. */
  send(request: SignedRequest, body: Uint8Array = new Uint8Array()): Promise<Response> {
    const url = new URL(request.url);
    const object = url.pathname.slice(1);
    const signature = this.signatures.get(url.searchParams.get('signature') ?? '');
    if (
      signature?.object !== object ||
      signature.method !== request.method ||
      Temporal.Instant.compare(this.clock.now(), signature.expiresAt) >= 0
    ) {
      return Promise.resolve(new Response(null, { status: 403 }));
    }
    return Promise.resolve(
      request.method === 'PUT'
        ? this.signedPut(object, request, body)
        : this.signedGet(object, signature),
    );
  }

  protected async store(
    key: ObjectKey,
    content: Uint8Array | Readable,
    contentType: string,
  ): Promise<void> {
    const bytes = content instanceof Uint8Array ? Uint8Array.from(content) : await buffer(content);
    this.objects.set(nameOf(key), { bytes, contentType });
  }

  protected removeAllOf(practiceId: string): Promise<void> {
    for (const object of this.objects.keys()) {
      if (object.startsWith(`${practiceId}/`)) this.objects.delete(object);
    }
    return Promise.resolve();
  }

  protected signedUpload(
    key: ObjectKey,
    contentType: string,
    expiresAt: Temporal.Instant,
  ): Promise<SignedRequest> {
    return Promise.resolve({
      method: 'PUT',
      url: this.sign(key, 'PUT', expiresAt, {}),
      headers: { 'content-type': contentType },
      expiresAt,
    });
  }

  protected signedDownload(
    key: ObjectKey,
    response: { readonly contentType: string; readonly downloadName: string },
    expiresAt: Temporal.Instant,
  ): Promise<SignedRequest> {
    return Promise.resolve({
      method: 'GET',
      url: this.sign(key, 'GET', expiresAt, {
        'content-type': response.contentType,
        'content-disposition': `attachment; filename="${response.downloadName}"`,
        'cache-control': DOWNLOAD_CACHE_CONTROL,
      }),
      headers: {},
      expiresAt,
    });
  }

  private sign(
    key: ObjectKey,
    method: SignedRequest['method'],
    expiresAt: Temporal.Instant,
    responseHeaders: Readonly<Record<string, string>>,
  ): string {
    const signature = randomUUID();
    const object = nameOf(key);
    this.signatures.set(signature, { object, method, expiresAt, responseHeaders });
    return `memory://objects/${object}?signature=${signature}`;
  }

  private signedPut(object: string, request: SignedRequest, body: Uint8Array): Response {
    // Write once, as the port promises for every provider.
    if (this.objects.has(object)) return new Response(null, { status: 403 });
    const contentType = request.headers['content-type'] ?? 'application/octet-stream';
    this.objects.set(object, { bytes: Uint8Array.from(body), contentType });
    return new Response(null, { status: 201 });
  }

  private signedGet(object: string, signature: Signature): Response {
    const held = this.objects.get(object);
    if (held === undefined) return new Response(null, { status: 404 });
    return new Response(Buffer.from(held.bytes), {
      status: 200,
      headers: signature.responseHeaders,
    });
  }
}
