# 0011. Error model

Status: Accepted — 2026-11-06

## Context

Web and app show messages in Arabic and English, so the API must answer with stable codes, not sentences. Errors are also a leak risk for health data: Nest puts an excerpt of a malformed body and the full URL with its query string into an exception's message and `getResponse()`.

## Decision

1. **Every error is `application/problem+json`** (RFC 9457) with `type` (a URN), `title`, `status`, `detail`, `code`, `requestId`, and optional `params` and `errors`. Clients branch on `code`; 422 is not used.
2. **One catalogue** (`common/errors/error-catalog.ts`) maps each code to its status and title, so a code and a status cannot disagree. A code is never reused with another meaning. Feature codes enter in the commit that first throws them.
3. **Services throw `DomainException(code, { detail, params, fieldErrors, cause })`.** Every other error is mapped by its status only; `ProblemDetailsFilter` never copies `exception.message` or `getResponse()`.
4. **Field errors** carry a path (`items[0].startsAt`), a field code and constant text, never the submitted value, and a response lists at most 100. An unknown property is `UNKNOWN_FIELD`, so a `practiceId` in a body is refused: the practice comes only from the path. The pipe skips a body typed as an interface or `import type`, so a route rule fails for any whole `@Body()` or `@Query()` without a class; a list body needs a wrapper DTO.
5. **Logging stays as in F03:** an exception no code path expected is logged once, at error, with a constant message and the error serializer's allowlist. A 4xx `DomainException` and an `HttpException` are not logged.
6. **An untranslated Prisma error** maps to `CONFLICT` (P2002, P2003, P2034) or `NOT_FOUND` (P2025) and is still logged, because a service should have translated it.

## Consequences

- A client needs one error parser for the whole API, and a new language needs only translation files.
- Every error answers `Cache-Control: no-store` and `X-Request-Id`.
- Shared field decorators (`common/validation`) wait for their first consumer. Until then a DTO uses class-validator directly and may set `context: { code, params }`.

Details: [05 §1](../architecture/05-errors-i18n-tokens.md#1-error-system).
