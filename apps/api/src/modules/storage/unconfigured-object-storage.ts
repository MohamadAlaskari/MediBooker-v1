import {
  type ObjectInfo,
  ObjectStorage,
  type ObjectStorageDescription,
  ObjectStorageError,
  type SignedRequest,
  type StoredObject,
} from './object-storage.js';

function notConfigured(): Promise<never> {
  return Promise.reject(new ObjectStorageError('NOT_CONFIGURED'));
}

/** STORAGE_PROVIDER unset: the API runs, and everything that needs a file fails with NOT_CONFIGURED. */
export class UnconfiguredObjectStorage extends ObjectStorage {
  describe(): ObjectStorageDescription {
    return { provider: 'none', place: 'not configured' };
  }

  get(): Promise<StoredObject | undefined> {
    return notConfigured();
  }

  head(): Promise<ObjectInfo | undefined> {
    return notConfigured();
  }

  delete(): Promise<void> {
    return notConfigured();
  }

  protected store(): Promise<void> {
    return notConfigured();
  }

  protected removeAllOf(): Promise<void> {
    return notConfigured();
  }

  protected signedUpload(): Promise<SignedRequest> {
    return notConfigured();
  }

  protected signedDownload(): Promise<SignedRequest> {
    return notConfigured();
  }
}
