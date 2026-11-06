/**
 * The registry of every API operation (02 §11, 06): a new operation is a reviewed change to this
 * file, checked against the OpenAPI document by `src/openapi/document.spec.ts`. A01 adds
 * `AUTHZ_MATRIX` for the protected operations, and P02's `CROSS_PRACTICE` follows with them.
 */

/** The operationIds that answer without sign-in. */
export const PUBLIC_OPERATIONS: readonly string[] = ['listPublicPractices', 'getPublicPractice'];
