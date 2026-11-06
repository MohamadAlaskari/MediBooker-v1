# 0012. Contract pipeline and committed generated code

Status: Accepted — 2026-11-06

## Context

The web and the app call the same API. Hand-written types drift from the server unnoticed, and a client that only runs after a build step fails in a fresh clone or on a build worker. The same holds for the design tokens: two apps read them, and Figma is their source.

## Decision

1. **The contract is generated from the code:** NestJS decorators produce OpenAPI 3.1, committed as `apps/api/openapi.json`.
2. **Orval writes the client** into `packages/api-client/src/generated`, committed: models, fetch functions, TanStack Query hooks, zod schemas and MSW mocks. Nobody edits these files.
3. **`pnpm generate` writes everything generated** in order: design tokens, OpenAPI document, client. `pnpm check:drift`, part of `pnpm verify` and CI, fails when a generated file differs from git or is not in git.
4. **One way to fail:** the mutator `apiFetch` resolves with the body alone and throws `ApiError` on any failure, so a hook's error is always an `ApiError` ([05 §1.6](../architecture/05-errors-i18n-tokens.md#16-client-apierror-medibookerapi-client)). A cancel by the caller stays an abort, so TanStack Query recognises it.
5. **The client is a source package:** its `exports` point at TypeScript. Only bundlers consume it (Next `transpilePackages`, Metro, Vitest, Jest). `./mocks` is for tests; `msw` and `@faker-js/faker` are devDependencies, so no production install carries them.
6. **Form schemas come from `@medibooker/api-client/zod`.** There is no separate validation package.

## Consequences

- A DTO change shows up in the pull request three times: in the DTO, in `openapi.json` and in the generated client. A reviewer sees what a client will get.
- An unknown error code from a newer server is kept, and its message falls back by status, so a released app survives new codes.
- A generator upgrade rewrites generated files; Renovate's pull request runs `pnpm generate` through the drift check.
- Orval's mock index exports only the per-tag aggregate, so `src/mocks.ts` has one line per tag.
