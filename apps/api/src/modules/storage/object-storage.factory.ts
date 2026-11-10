import type { Clock } from '../../common/time/clock.js';
import type { Env } from '../../config/env.schema.js';
import { AzureBlobStorage } from './azure/azure-blob-storage.js';
import type { ObjectStorage } from './object-storage.js';
import { UnconfiguredObjectStorage } from './unconfigured-object-storage.js';

/** The only place that knows the providers. Another one is a class, a case and an env group (ADR 0015). */
export function objectStorageFor(env: Env, clock: Clock): ObjectStorage {
  switch (env.STORAGE_PROVIDER) {
    case undefined:
      return new UnconfiguredObjectStorage(clock);
    case 'azure': {
      const connection = env.STORAGE_AZURE_CONNECTION_STRING;
      // parseEnv requires it with this provider, which its type cannot say.
      if (connection === undefined) throw new Error('no Azure connection string');
      return new AzureBlobStorage(clock, {
        ...connection,
        publicBlobUrl: env.STORAGE_AZURE_PUBLIC_BLOB_URL,
      });
    }
  }
}
