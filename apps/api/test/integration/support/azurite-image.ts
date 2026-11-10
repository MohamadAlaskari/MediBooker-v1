/**
 * The Azurite image of the integration tests, pinned by its multi-arch index digest. compose.dev.yaml
 * pins the same image for local development; Renovate moves both. Prettier would wrap the value, so
 * the two lines its manager matches stay as they are.
 */
// prettier-ignore
// renovate: datasource=docker depName=mcr.microsoft.com/azure-storage/azurite
export const AZURITE_IMAGE = 'mcr.microsoft.com/azure-storage/azurite:3.37.0@sha256:830430c1da1a2d537e08f3e6764dd1f5ae00cf0346bcaf625b968ec3f0971fd5';
