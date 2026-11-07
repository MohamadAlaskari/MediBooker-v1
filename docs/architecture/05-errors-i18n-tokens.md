# Errors, i18n and design tokens

Three systems that cross every layer: the error model from the API to the screen, the shared message catalogue with its RTL rules, and the design tokens with motion tokens and practice themes.

## 1. Error system

```text
service: throw new DomainException('SLOT_NOT_AVAILABLE') ─┐
Nest and HTTP errors, throttler, body parser ─────────────┤
tenancy: PracticeUnavailableError, missing context ───────┼─► ProblemDetailsFilter ─► problem+json, X-Request-Id
Prisma errors, unknown errors ────────────────────────────┘          │                      │
                                                         pino: code, constraint,   apiFetch ─► ApiError
                                                         5xx stack, no values               │
                                                                          errorMessageKey ─► errors.<CODE> (ar, en)
```

### 1.1 Catalogue

`apps/api/src/common/errors/error-catalog.ts` is the single source:

```ts
export const ERROR_CATALOG = {
  VALIDATION_FAILED: { status: 400, title: 'Validation failed' },
  SLOT_NOT_AVAILABLE: { status: 409, title: 'Slot not available' },
  // …
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
```

Foundation codes (X01):

| Code | Status | Also used for |
|---|---|---|
| `VALIDATION_FAILED` | 400 | malformed JSON, any unmapped 4xx |
| `UNAUTHENTICATED` | 401 | deny-by-default |
| `FORBIDDEN` | 403 | a caller with access to the practice but without the required role or capacity |
| `NOT_FOUND` | 404 | unknown routes; another user's or another practice's resource; an unknown, unpublished or offboarded practice |
| `CONFLICT` | 409 | unmapped unique or foreign-key violations, exhausted serialization retries |
| `PAYLOAD_TOO_LARGE` | 413 | body over 100 kB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | non-JSON body on POST, PUT, PATCH |
| `RATE_LIMITED` | 429 | with `Retry-After` |
| `INTERNAL_ERROR` | 500 | everything unexpected, including practice data access without a resolved practice |
| `SERVICE_UNAVAILABLE` | 503 | readiness and shutdown; a practice that is suspended, being moved or under restore review, whose database is unreachable or behind the code's schema, or whose market the deployment does not serve (with `Retry-After`, for that practice only; ADR 0005 §5) |

The five generic codes `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INTERNAL_ERROR` and `SERVICE_UNAVAILABLE` extend the `api-contract` list; X01 adds them to the skill and records the model in ADR 0011.

Feature codes from `api-contract` enter the catalogue in the commit that first throws them, together with their Arabic and English messages. Status policy:

| Status | Meaning | Codes |
|---|---|---|
| 400 | Input-level domain errors | `THEME_COLOR_INVALID`, `VERIFICATION_CODE_INVALID`, `GUARDIAN_DECLARATION_REQUIRED` |
| 401 | Authentication | `INVALID_CREDENTIALS`, `MFA_REQUIRED` |
| 403 | Account or permission state | `EMAIL_NOT_VERIFIED`, `ACCOUNT_LOCKED` |
| 404 | Hidden ownership | `NOT_A_MANAGED_PATIENT` |
| 409 | Business rule or state conflict | `ALREADY_JOINED`, `SLOT_NOT_AVAILABLE`, `BOOKING_LIMIT_REACHED`, `OUTSIDE_BOOKING_WINDOW`, `SERVICE_NOT_BOOKABLE`, `CANCELLATION_DEADLINE_PASSED`, `INVALID_STATUS_TRANSITION`, `SLOT_HAS_APPOINTMENT`, `IDEMPOTENCY_KEY_REUSED`, `PRACTICE_SLUG_TAKEN`, `CONSENT_REQUIRED`, `NOTIFICATION_PREFERENCE_LOCKED`, `PHONE_NOT_VERIFIED`, `SMS_NOT_ENABLED`, `NOTE_NOT_EDITABLE`, `FILE_NOT_READY`, `FILE_REJECTED` |
| 410 | Expired | `INVITATION_EXPIRED` |
| 413 · 415 | File limits | `FILE_TOO_LARGE` · `FILE_TYPE_NOT_ALLOWED` |

422 is not used; clients branch on `code`. A code is never reused with another meaning.

Field codes (`field-error-codes.ts`): `REQUIRED`, `INVALID_TYPE`, `INVALID_FORMAT` (with `params.format`: `email`, `uuid`, `date`, `datetime`, `pattern`), `INVALID_VALUE`, `TOO_SHORT`, `TOO_LONG`, `TOO_SMALL`, `TOO_LARGE`, `UNKNOWN_FIELD`. Domain field codes arrive with their feature, for example `SLUG_RESERVED`, `INSURANCE_NUMBER_INVALID`, `OVERLAPS_EXISTING`.

### 1.2 Throwing

- `throw new DomainException(code, { detail?, params?, fieldErrors?, cause? })`. The status comes from the catalogue, so code and status cannot disagree.
- `detail` is English text for developers and never contains personal data. `params` holds only public values, for example `{ maxFutureAppointments: 2 }`.
- Services translate expected database errors themselves: a unique violation on `practice_slugs` in the platform database becomes `PRACTICE_SLUG_TAKEN`; the `EXCLUDE` violation (23P01) on slots becomes `SLOT_NOT_AVAILABLE`, on opening hours a field error `OVERLAPS_EXISTING`.
- Another user's or another practice's resource is `NOT_FOUND`.

### 1.3 Rendering: `ProblemDetailsFilter`

A global `@Catch()` filter, registered as `APP_FILTER`:

| Source | Result |
|---|---|
| `DomainException` | Its catalogue entry, `detail`, `params`, field errors |
| `ThrottlerException` | `RATE_LIMITED` with `Retry-After` |
| `PracticeUnavailableError` (connection manager, schema guard) | `SERVICE_UNAVAILABLE` with `Retry-After: 30`; logged with the practice id and the reason code (`reasonCode`), never with connection details. F04's `PracticeContextInterceptor` answers it as a Nest `ServiceUnavailableException` (503) with the same `Retry-After: 30` and log line ([02 §5](02-api.md#practiceconnectionmanager)), which this filter renders by its status |
| Any other `HttpException`, and body-parser errors with a numeric `status` | By status only: 400 `VALIDATION_FAILED`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 429 `RATE_LIMITED`, 503 `SERVICE_UNAVAILABLE`; any other 4xx becomes 400 `VALIDATION_FAILED` |
| Prisma P2002, P2003, P2034 that the service did not translate | `CONFLICT` |
| Prisma P2025 | `NOT_FOUND` |
| Anything else, `PracticeContextMissingError` included | `INTERNAL_ERROR` |

For every error that is not a `DomainException`, `detail` is the catalogue title. The filter never copies `exception.message` or `getResponse()`: Nest puts an excerpt of a malformed body and the full URL with its query string there.

Headers: `Content-Type: application/problem+json; charset=utf-8`, `Cache-Control: no-store`, `X-Request-Id`.

```json
{
  "type": "urn:medibooker:problem:slot-not-available",
  "title": "Slot not available",
  "status": 409,
  "detail": "The slot was booked by another request.",
  "code": "SLOT_NOT_AVAILABLE",
  "requestId": "4f8c2a6e-6c1d-4f3b-9d55-2b8f0c7e1a90",
  "params": {},
  "errors": [{ "field": "items[0].startsAt", "code": "TOO_LONG", "message": "Too long", "params": { "max": 100 } }]
}
```

Responses never contain stack traces, SQL, constraint values or submitted values; the pipe runs with `validationError: { target: false, value: false }`. Logging of errors follows [02 §8](02-api.md#8-logging-and-redaction).

### 1.4 Validation mapping

`createValidationException()` walks the nested `ValidationError` tree:

- field paths in camelCase with brackets for array indices (`items[0].startsAt`);
- code and params from the field decorator's `context`;
- otherwise from the constraint name: `isNotEmpty`/`isDefined` → `REQUIRED`; `isString`/`isInt`/… → `INVALID_TYPE`; `isEmail`/`isUUID`/`isISO8601`/`matches` → `INVALID_FORMAT`; `isIn`/`isEnum` → `INVALID_VALUE`; `minLength`/`arrayMinSize` → `TOO_SHORT`; `maxLength`/`arrayMaxSize` → `TOO_LONG`; `min` → `TOO_SMALL`; `max` → `TOO_LARGE`; `whitelistValidation` → `UNKNOWN_FIELD`.

A `practiceId` field in a request body is therefore always `UNKNOWN_FIELD`: the practice comes only from the path (ADR 0005 §3).

### 1.5 Contract

- OpenAPI components `ProblemDetails` and `FieldError`, and the named enums `ErrorCode` (the whole catalogue) and `FieldErrorCode`.
- `@ApiErrors('SLOT_NOT_AVAILABLE', …)` groups codes by status; each response description lists its possible codes. Every operation documents 400, 429 and 500; protected operations also 401 and 403; practice-scoped operations also 503.
- Problem types are URNs (`urn:medibooker:problem:<kebab-code>`), independent of the hosting domain.

### 1.6 Client: `ApiError` (`@medibooker/api-client`)

`apiFetch`, the Orval mutator, throws an `ApiError { status, code, requestId?, params?, fieldErrors }`:

| Situation | `code` |
|---|---|
| problem+json response | the server's `code` |
| any other non-2xx body | `UNEXPECTED_RESPONSE` |
| rejected fetch | `NETWORK_ERROR` |
| abort after `timeoutMs` (default 20 s) | `TIMEOUT` |

- `isApiError(error, code?)` narrows.
- `errorMessageKey(error)` returns `errors.<CODE>` for a known code. An unknown code from a newer server falls back by status (401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 429 `RATE_LIMITED`, 5xx `INTERNAL_ERROR`, otherwise `UNEXPECTED_RESPONSE`), so released apps survive new codes.
- `applyFieldErrors(error, setError)` turns `items[0].startsAt` into the react-hook-form path `items.0.startsAt` and returns `false` when there are no field errors.
- `shouldRetryQuery(failureCount, error)`: queries retry at most twice and only on `NETWORK_ERROR`, `TIMEOUT` or 5xx (a 503 of one practice included), never on 4xx (429 included). Mutations never retry automatically; a booking retry by the user reuses the same `Idempotency-Key`. `createQueryClient()` uses it with `staleTime` 30 s; `createTestQueryClient()` uses it with `retryDelay: 0` and `gcTime: Infinity`.

### 1.7 Messages and UI boundaries

- `errors.<CODE>`: one sentence on what happened and what to do, with ICU arguments from `params`. Example `SLOT_NOT_AVAILABLE`: "This time was just booked by someone else. Please choose another time." / "تم حجز هذا الموعد للتو. يرجى اختيار وقت آخر."
- `validation.<FIELD_CODE>` uses `{min}`, `{max}` and `{format, select, …}`.
- A catalogue test fails when any server code, field code or client code (`NETWORK_ERROR`, `TIMEOUT`, `UNEXPECTED_RESPONSE`) lacks a message in any locale.
- Web and mobile show the translated message, never `detail`; 5xx screens show the request id in small print. Boundaries per app: [03 §11](03-web.md#11-error-boundaries-and-ui-states), [04 §11](04-mobile.md#11-error-boundaries-and-states).
- `reportError()` is a no-op seam until an error tracker in the market's region with PII scrubbing is chosen (D10).

### 1.8 Tests

- **API unit:** catalogue invariants (unique, UPPER_SNAKE, allowed statuses, a title per code); one table row per filter source → status, code, body.
- **API HTTP (no database):** unknown route → 404; `GET /api/v1/nope?email=sara@example.test` → 404 with the query in neither the body nor the logs; non-public route → 401; probe DTO → `items[0].name` paths; unknown field → `UNKNOWN_FIELD`; malformed JSON containing `secret-value` → 400 with the value in neither the body nor the logs; body over 100 kB → 413; `text/plain` POST → 415; over the limit → 429 with `Retry-After`; a thrown `Error('secret-value')` → 500 with a request id and no stack, message or value; a `PracticeUnavailableError` → 503 with `Retry-After`; every error response has the problem+json content type and `no-store`.
- **API integration:** a duplicate slug → 409 `PRACTICE_SLUG_TAKEN`; the log line holds only the constraint name.
- **Clients:** fetcher paths, the unknown-code fallback, the retry table, field-path mapping, the message completeness test, component tests for the error state and field mapping.

## 2. i18n and RTL

### 2.1 Catalogue (`@medibooker/i18n`)

- `src/messages/<locale>.json`, one ICU file per locale. Arabic is the default and the source of the `Messages` type.
- Top-level namespaces: `common`, `app`, `a11y`, `errors`, `validation`, then one per feature (`practicePage`, `booking`, `notifications`, …). Keys follow `feature.screen.element`.
- `scripts/generate.ts` (Node type stripping) scans the message files and writes two committed files: `src/generated/catalog.ts` (`LOCALES` as a const tuple, static JSON imports, `messages`) and `locales.json` (exported as `./locales.json` for config files). F06 creates `locales.json` by hand with `["ar","en"]`; from X04 the generator owns it.
- **Adding a language** is one JSON file plus `pnpm generate`; CI's drift check catches a forgotten run. The new locale then reaches the web routing, the API and the app's `supportedLocales` (the app needs a native rebuild).
- Public API: `LOCALES`, `Locale`, `DEFAULT_LOCALE = 'ar'`, `isLocale`, `getDirection(locale)` (RTL for `ar`, `fa`, `he`, `ur`), `negotiateLocale(acceptLanguage)` (q-values, fallback `ar`), named `formats` (`appointment`, `time` with tabular figures), `toFormattingLocale(locale, { numberingSystem, hourCycle })` (for example `ar-u-nu-latn-hc-h23`), `isolateLtr(text)` (wraps in U+2066 … U+2069), `messages`, `Messages`.
- `.gitleaks.toml` gets an allowlist for the message files with a test case in X04, because a key ending in `password` with a long label is reported today (ADR 0006 follow-up).

### 2.2 Binding (decision D1)

Decided on 2026-11-06: option B ([ADR 0013](../adr/0013-i18n-binding.md)).

| Option | Packages | For | Against |
|---|---|---|---|
| A (CLAUDE.md, Proposed) | i18next, react-i18next, i18next-icu everywhere | one library and API on every platform; large ecosystem | ICU only through a plugin; no App Router integration: per-request instances and locale routing by hand |
| B (recommended) | next-intl (web), use-intl (mobile), `use-intl/core` (API e-mails, push, SMS) | native ICU; cookie-free locale routing with hreflang; server-component and metadata support; typed keys; one engine renders e-mails and app texts from the same catalogue | mostly one maintainer; changes a Proposed row |

The catalogue is ICU JSON either way, so the decision only changes the bindings in X06, X08 and A02. ADR 0013 records it.

### 2.3 Catalogue tests (X04)

- Identical key sets in all locales; every message parses with `@formatjs/icu-messageformat-parser`; the same argument names per key in every locale.
- Arabic `plural` messages define `zero`, `one`, `two`, `few`, `many` and `other`.
- Every `ErrorCode`, `FieldErrorCode` and client code has a message; messages contain no HTML.
- A render-all test formats every key in every locale with the runtime engine of the chosen binding (`createTranslator` from `use-intl/core` with `onError` that throws, or i18next with i18next-icu), with numbers 0, 1, 2, 3, 11 and 100 and a fixed instant in `Asia/Riyadh`. A message that parses but fails at format time fails CI.
- A fixture locale file is picked up without a code change; `locales.json` equals `LOCALES`.

### 2.4 Wording and formatting

- Modern Standard Arabic, polite and short; gender-neutral phrasing when the gender is unknown. In Arabic strings a Latin token comes last; "from → to" is written with `←`. Translated fragments are never concatenated.
- Dates, times and numbers only through the binding's formatters, with the practice's IANA `timeZone` and `toFormattingLocale(locale, { numberingSystem, hourCycle })` from the practice settings. Times use tabular figures. Instants travel in UTC; nothing formats in the host's time zone.

### 2.5 RTL

| Where | Rule |
|---|---|
| Web | `<html lang dir>` rendered on the server; logical utilities only (lint); `rtl:` only for real exceptions; shadcn RTL mode; directional icons mirror, clocks and check marks never; `<bdi>` around user text; `dir="ltr"` on phone and code inputs; week strips follow `weekStart` and `weekendDays`; every Playwright flow runs in `ar-rtl` and `en-ltr` |
| Mobile | `supportedLocales`; `forceRTL` and `reloadAppAsync()` when the direction changes; `LocaleProvider` for headers and gestures; `start`/`end` styles only; `isolateLtr()` |
| Motion | horizontal motion through `inlineX()` (web) or `I18nManager.isRTL` (app) |
| Server texts | e-mails carry `dir="rtl" lang="ar"` and `<bdi dir="ltr">` for Latin snippets; push and SMS texts use isolates |

## 3. Design tokens, motion tokens and practice themes

### 3.1 Pipeline (ADR 0002, `design-system` skill)

1. **Source:** Figma variables in the collections Primitives, Brand (Teal default, Ocean, Indigo, Violet, Graphite), Color (Light, Dark), Typography (English, Arabic), Dimension and, new for ADR 0008, Motion.
2. **Export:** the ui-designer runs a read-only `use_figma` dump into `packages/design-tokens/tokens/*.json`: W3C DTCG, aliases kept, one file per collection and mode. The files are committed and reviewed like code. X05 updates the `design-system` skill and `.claude/agents/ui-designer.md`, which still name a single `tokens.json`.
3. **Build:** `pnpm --filter @medibooker/design-tokens generate` runs `scripts/build-tokens.ts` (Node type stripping, no build library) and writes two committed files; CI fails on drift:
   - `css/tokens.css`, a Tailwind v4 stylesheet:
     - `@theme static` after resetting `--color-*`, `--spacing-*`, `--radius-*`, `--text-*`, `--font-*`, `--font-weight-*`, `--leading-*`, `--tracking-*`, `--shadow-*`, `--ease-*`, `--container-*` and `--breakpoint-*` to `initial`, so only token utilities exist; variable names equal the Figma WEB code syntax (`--color-bg-canvas` → `bg-bg-canvas`);
     - primitives and the Teal `--brand-50 … --brand-950` as plain properties; presets as `[data-brand='ocean']` and so on; the nine semantic brand tokens stay `var(--brand-…)` references, so a runtime brand change propagates;
     - dark values under `[data-theme='dark']` and under `@media (prefers-color-scheme: dark)` for `[data-theme='system']`;
     - `:lang(ar)` and `:lang(en)` font stacks and line heights;
     - motion variables `--motion-duration-*` and `--motion-ease-*`;
   - `src/generated/tokens.ts`: light and dark themes, typography per locale, spacing, radius, border width, brand presets and motion (durations in ms, eases as cubic-bezier control points) for React Native and GSAP.
4. **Runtime:**
   - web: presets through `data-brand`; a custom scale as a nonce'd `<style>` from `brandStyle(scale)` ([03 §9](03-web.md#9-styling-tokens-tailwind-and-shadcnui)); shadcn's variables mapped in `theme.css`;
   - React Native: `createColorTheme(scheme, scale)`;
   - e-mails: the values inlined at send time.

   Neutrals, status colours, the MediBooker logo and the push previews stay fixed (Teal).

Public API: `createColorTheme`, `BRAND_PRESETS`, `spacing`, `radius`, `borderWidth`, `typography.{ar,en}`, `motion`, `contrastRatio(a, b)`, the stylesheet `./tokens.css`; M01 adds `generateBrandScale`.

### 3.2 Custom brand colour (BR-23, M01)

- `generateBrandScale(hex) → { scale, adjusted }` uses OKLCH with culori 4.0.2 and the lightness targets of the presets. It accepts only `^#[0-9A-Fa-f]{6}$`, normalises to lowercase and adjusts lightness until every pair passes in light and dark: button and link text at least 4.5:1, focus ring at least 3:1.
- The API is authoritative; the W19 preview runs the same function.
- Storage in the practice database (P01): `practice_themes.custom_color` with `CHECK (custom_color ~ '^#[0-9a-f]{6}$')`, and `scale text[]` with `CHECK (array_length(scale, 1) = 11 AND array_to_string(scale, ',') ~ '^(#[0-9a-f]{6},){10}#[0-9a-f]{6}$')`. The response DTO declares the item pattern, so the generated zod schema checks it, and the web's `brandStyle` validates again.

### 3.3 Motion tokens (ADR 0008)

| Token | Starting value | Web CSS | GSAP | React Native |
|---|---|---|---|---|
| `motion/duration/instant` · `fast` · `base` · `slow` | 0 · 120 · 200 · 320 ms | `--motion-duration-*` | seconds from `motion.duration` | ms for `withTiming` |
| `motion/ease/standard` | (0.2, 0, 0, 1) | `cubic-bezier(…)` | `CustomEase` from the points | `Easing.bezier(…)` |
| `motion/ease/enter` | (0.05, 0.7, 0.1, 1) | same | same | same |
| `motion/ease/exit` | (0.3, 0, 1, 1) | same | same | same |

The ui-designer confirms the starting values in X05. Reduced motion: the end state at once, or an opacity fade no longer than `fast`.

### 3.4 shadcn/ui mapping (ADR 0007)

`apps/web/src/styles/theme.css` maps every shadcn variable to a semantic token (`--primary` → `--color-bg-brand`, `--ring` → `--color-border-focus`, `--radius` → `--radius-md`, full table in ADR 0007). It contains no raw colour value; a test resolves every variable to a `--color-*` or `--radius-*` token. Practice themes change only `--brand-*`, so every component follows the practice colour, and status colours stay fixed.

### 3.5 Token tests (X05, M01)

- All five presets in light and dark reproduce the contrast table of the `design-system` skill (±0.01).
- Every semantic text and background pair is at least 4.5:1; borders and icons at least 3:1.
- Every semantic token exists in light and dark; only the nine brand tokens reference `--brand-*`.
- The build is deterministic; a snapshot covers the CSS variable names and the motion exports.
- A Tailwind compile of a fixture proves that no utilities exist for primitives or Tailwind's defaults.
- M01: a property test generates random valid hex values; every resulting scale passes all pairs.
