# 0015. File storage behind a port: Azure Blob Storage, Azurite in development

Status: Accepted — 2026-11-07 (F09), the user's decision

## Context

Images and PDFs will come with R02 (attachments, BR-17), M01 (the practice logo) and M03 (staff photos). The user chose on 2026-11-07: Azure Blob Storage in production, Azurite on the developer's machine, and an abstraction so that another provider can be connected later ("als abstract aufbauen damit später egal welche kommt leicht zu provider verbinden"). Files of a practice are health data (`health-data-security`), and every practice has its own database (ADR 0005), so every file belongs to exactly one practice.

## Decision

1. **A port in the API:** `ObjectStorage` in `apps/api/src/modules/storage/object-storage.ts`, provided by `ObjectStorageModule`. Features use only the port. `put`, `get`, `head`, `delete`, `deleteAllOf(practiceId)` for a practice that leaves, and two signed requests: `signUpload` (write once) and `signDownload` (read only). A signed request carries the headers its caller must send, so no client knows the provider.
2. **A key names its practice:** `ObjectKey.of(practiceId, path)` with a lowercase UUID and a path of `[a-z0-9-]` segments, at most 200 characters, no dots: no traversal, and no file name with its extension. The characters do not stop a name from saying something, so a key is built from ids only (`attachments/<uuid>`), which R02 must keep to: a provider's logs see keys. How a key maps to a provider is the adapter's business: Azure uses one container per practice, `practice-<uuid>`.
3. **The rules live in the port, in template methods,** so that a new provider cannot forget them: a signed URL lives 1 to 300 seconds, a content type has no parameters, and a download name, which travels in the URL, matches `[A-Za-z0-9._-]`. The port limits its characters; that it is a neutral name such as `document-1.pdf` and never the patient's file name is the caller's duty.
4. **One adapter for Azure and Azurite,** `azure/azure-blob-storage.ts`, the only file allowed to import `@azure/storage-blob` (lint rule `medibooker/api/storage-provider`). It gets the parsed values of `azure/azure-connection-string.ts`, the one reader of the connection string, which the environment validates with, so nothing reads the string differently from what was checked. Uploads sign with permission `c` alone, which creates a blob and refuses to replace one; downloads with `r` alone, as an attachment.
5. **Errors in the port's terms:** `ObjectStorageError` with `NOT_CONFIGURED`, `UNAVAILABLE`, `REFUSED` or `FAILED`, a status and a code, never the provider's message or cause: a `RestError` holds the request.
6. **Configuration:** `STORAGE_PROVIDER` (`azure` or unset), `STORAGE_AZURE_CONNECTION_STRING` with `AccountName` and `AccountKey`, and `STORAGE_AZURE_PUBLIC_BLOB_URL` for where a browser reaches the endpoint when the API reaches it elsewhere. Unset, every call answers `NOT_CONFIGURED` and the API runs: bookings need no files. `https` everywhere except an emulator on `azurite`, `localhost` or `127.0.0.1` in `local` and `ci`; staging and production refuse the emulator.
7. **Development:** the `azurite` service of `compose.dev.yaml` with the emulator's published account, written into the compose file, so that no value in `.env` can point the development stack at a real account. The production stack takes an account only from `.env.prod`, which the menu writes ("Azure-Speicher eintragen").

### Adding a provider

1. A class that extends `ObjectStorage` and implements its protected methods, in its own folder.
2. A case in `objectStorageFor` (`object-storage.factory.ts`), the only place that knows the providers, and a value of `STORAGE_PROVIDER` with its own variables in the env schema.
3. Its SDK's name in the guard `medibooker/api/storage-provider` of `apps/api/eslint.config.js`.
4. A spec that runs `describeObjectStorageContract(name, setup)` from `test/support/object-storage-contract.ts` against it: the same checks the in-memory and the Azure adapter pass.

The menu's "Azure-Speicher eintragen" and the check command's wording are Azure's; a second provider in production would give the menu its own entry.

## Consequences

- **An account key, for now.** Microsoft recommends a user delegation SAS signed through Microsoft Entra ID with a managed identity. That needs hosting on Azure, and the hosting is open (D9). Changing to it is a change inside the adapter. Until then the key gives full access to the account: it lives only in `.env.prod`, moves to the secret store with OPS01 and is rotated there (RT-95).
- **What a SAS cannot do.** It cannot bind the size or the content type of an upload, and it cannot add `X-Content-Type-Options: nosniff` to a download (measured on Azurite 3.37.0; Azure not yet measured). So R02 checks size and type after the upload, before the file is visible, and serves downloads as attachments with the content type it checked.
- **A signed upload also allows a copy** (found by the security review). Permission `c` lets its holder send Copy Blob instead of bytes: on Azurite from any blob of the account, also another practice's; on Azure, as documented, from any public blob, and a copy can finish after a check. `ObjectInfo.copied` shows such an object, and R02 deletes and refuses it before any check. Whether Azure refuses a copy from the same account without a source signature is to be measured on the user's account.
- **The uploader chooses the object's other headers and metadata**, for example `Cache-Control` for a year. A signed download overrides type, disposition and `Cache-Control: private, no-store`; R02 rewrites the headers to the checked type and clears the metadata before a file is visible.
- **Bounded waits.** `tryTimeoutInMs` of the SDK only tells the server how long it may take; a server that accepts and stays silent held a request for minutes (measured). The adapter ends every call through an abort signal (`AZURE_LIMITS`), uploads a stream block by block, because the SDK's `uploadStream` passes no signal to its blocks, and ends a download whose next chunk does not come.
- **Azurite needs `--skipApiVersionCheck`**, because SDK 12.34.0 sends API version 2026-10-06, which Azurite 3.37.0 does not know, and `--disableProductStyleUrl`, because the host name `azurite` holds no account.
- The SDK adds about 400 ms and 22 MB to each start of the API, also without a provider, because the factory imports it.
- Nothing has run against a real Azure account yet: that needs the user's account, entered through the menu, and then "Datei-Speicher prüfen".

## Alternatives considered

- **An S3-compatible API first** (MinIO locally): many providers speak it, but the user chose Azure, and Azure does not.
- **The local file system:** no signed URLs for a browser, and no answer for several servers.
- **The provider's SDK directly in features:** every feature would know Azure, and a second provider would mean changing all of them.
