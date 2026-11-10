/**
 * Lint canary of the storage guard (ADR 0015): an import of a provider SDK outside its adapter, which
 * the API's ESLint configuration must report. It carries a disable comment, and an unused disable
 * comment fails the lint (reportUnusedDisableDirectives), so `pnpm lint` fails when the rule stops
 * reporting, also for a type-only import. Nothing imports or runs this file.
 */
// eslint-disable-next-line no-restricted-imports -- canary: proves the guard against the installed SDK
import type { BlobServiceClient } from '@azure/storage-blob';

export type StorageRulesCanary = BlobServiceClient;
