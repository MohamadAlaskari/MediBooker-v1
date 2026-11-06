/**
 * The PostgreSQL image of the integration tests, pinned by its multi-arch index digest.
 * compose.dev.yaml pins the same image for local development; Renovate moves both. Prettier would
 * wrap the value, so the two lines its manager matches stay as they are.
 */
// prettier-ignore
// renovate: datasource=docker depName=postgres
export const POSTGRES_IMAGE = 'postgres:18.6-trixie@sha256:bd5dfa494a5a259704365813dbfa5fa6b3e69be7348d43b547f540c730478583';
