# API (NestJS)

`apps/api` is the only gateway to personal and health data. Tenancy comes from [ADR 0005](../adr/0005-multi-tenancy.md) (one database per practice), authentication from [ADR 0004](../adr/0004-authentication.md), the error model from [05](05-errors-i18n-tokens.md). The `nestjs-feature` skill gives the recipe; where the skill and this document differ, this document wins until the roadmap item that updates the skill ([08](08-roadmap.md) names it per item).

## 1. Runtime and build

- Package `@medibooker/api`, `"type": "module"`, NestJS 12.3.2 on Express 5. ESM: relative imports end in `.js`.
- `nest build` uses the SWC builder in object form, so it reads the shared `.swcrc` and leaves every `*.spec.ts` out: spec files never reach `dist` or the image. No Swagger CLI plugin; DTOs use explicit field decorators (§4). `nest-cli.json`:

  ```json
  {
    "$schema": "https://json.schemastore.org/nest-cli",
    "sourceRoot": "src",
    "compilerOptions": {
      "builder": {
        "type": "swc",
        "options": { "swcrcPath": ".swcrc", "ignore": ["**/*.spec.ts"] }
      },
      "typeCheck": false,
      "deleteOutDir": true
    }
  }
  ```

- `.swcrc` is the single SWC configuration, read by `nest build` and by Vitest, so tests compile exactly like production:

  ```json
  {
    "jsc": {
      "target": "es2024",
      "parser": { "syntax": "typescript", "decorators": true },
      "transform": {
        "legacyDecorator": true,
        "decoratorMetadata": true,
        "useDefineForClassFields": false
      },
      "keepClassNames": true
    },
    "module": { "type": "es6" },
    "sourceMaps": true
  }
  ```

- Type checking runs separately: `tsc --noEmit`.

| Script | Command | Since |
|---|---|---|
| `dev` | `nest start --watch` | F03 |
| `build` | `nest build` | F03 |
| `start` | `node --enable-source-maps dist/main.js` | F03 |
| `test` | `vitest run --project unit --coverage` | F03 |
| `test:integration` | `vitest run --project integration` | F04 |
| `db:generate` | `prisma generate` with each of the two configs, then `scripts/write-schema-versions.ts` (§9) | F04 |
| `db:migrate:dev:platform` · `db:migrate:dev:practice` | `prisma migrate dev --create-only` with the platform or practice config against the local authoring databases (§9) | F04 |
| `db:seed` | `tsx prisma/seed.ts`: provisions the two seed practices, then writes synthetic data | F04 |
| `generate` | `node dist/openapi/generate.js` | X02 |
| `slots:generate` | slot generation for one practice and a date range | P04 |
| `cli` | `node dist/cli.js <command>`: operator commands `practice:create` and `practice:invite-admin` | A04 |

Creating, migrating, moving and removing databases is not the API's job: the lifecycle CLI `medibooker-db` in `apps/db-migrate` does it (§6). The root scripts `db:migrate` and `db:reset` call it.

## 2. Structure

```text
apps/api/
  prisma/
    platform/schema.prisma · platform/migrations/
    practice/schema.prisma · practice/migrations/
    seed.ts
  prisma.platform.config.ts · prisma.practice.config.ts
  scripts/write-schema-versions.ts
  openapi.json                   generated and committed (X02)
  src/
    main.ts                      load the root .env → parseEnv → NestFactory.create → configureApp → registerProcessHandlers → listen
    cli.ts                       operator commands (A04)
    app.setup.ts                 APP_OPTIONS, configureApp(app, env)
    app.module.ts                AppModule.forRoot(env)
    config/                      env.schema.ts (zod), load-env.ts
    common/
      context/                   RequestContext (nestjs-cls)
      database/                  PlatformPrismaService, SecretStore port, DevSecretStore
      tenancy/                   PracticeConnectionManager, PracticeContext, PracticeTransactionalAdapter,
                                 @PracticeScoped(), PracticeContextInterceptor, runInPractice(),
                                 forEachPractice(), PracticeCache; A01: PracticeAccessIndex,
                                 IntegrationRelay; P04: PracticeJobRuns
      security/                  @Public(), AuthenticationGuard; A01: @CurrentUser()
      errors/                    error catalogue, DomainException, ProblemDetailsFilter (X01)
      validation/                field decorators, validation exception factory (X01)
      http/                      NoStoreInterceptor, @PublicCache(), JsonOnlyMiddleware, pagination
      logging/                   pino options, field allowlist, serializers, redaction, process handlers;
                                 UnknownExceptionFilter (F03, until X01)
      events/                    DomainEvents (emitAfterCommit)
      time/                      Clock, SystemClock, FixedClock, Date ⇄ Temporal conversion
    health/                      /health/live, /health/ready
    modules/<feature>/
    openapi/                     document.ts, generate.ts
    generated/                   platform/ and practice/ (Prisma clients), schema-versions.ts; all gitignored
  test/e2e/ · test/integration/ · test/support/
```

- **Module layout:** `<feature>.module.ts`, `.controller.ts` (HTTP only), `.service.ts` (business rules with BR ids, ownership, transactions, events), optional `.reader.ts` for complex read models, `.rules.ts` (pure functions), `dto/` (`*.dto.ts`, `*.response.dto.ts`), `mappers/`, `.events.ts`. No repository files: services use the transaction hosts (§5).
- **Modules:** `health`, `app-config` (X02), `practices` (P01, P02), `scheduling` (P04, P05); later `auth`, `accounts`, `memberships`, `patients`, `appointments`, `notifications`, `settings`, `staff`, `family`, `clinical-notes`, `attachments`, `records`, `audit`, `realtime`, `privacy`.
- **Boundaries:** modules use each other only through exported providers. Messages to people are rows written in the business transaction through the notifications module's providers: `NotificationOutbox.enqueue(tx, …)` in the practice database and `AccountNotifications.enqueue(tx, …)` in the platform database (A02). Audit rows are written in the transaction too. Domain events after commit, with IDs only, serve realtime and other best-effort reactions (ADR 0005 §1.4).
- **Mapping:** mappers build explicit response objects (`satisfies XResponseDto`). Never return a Prisma row or spread a request body.

## 3. Bootstrap

- `main.ts` first calls `loadWorkspaceEnv()` from `./config/load-env.js`; that module has no import-time side effect, so tests can import it. Outside production it finds the workspace root (the nearest parent directory with `pnpm-workspace.yaml`) and loads that directory's `.env` with `process.loadEnvFile()` if the file exists. One root `.env` serves the API, both Prisma configs, `medibooker-db` and the e2e fixtures ([07 §2](07-docker-ci-cd.md#2-compose-for-local-development)). Then `const env = parseEnv(process.env)`, `NestFactory.create(AppModule.forRoot(env), APP_OPTIONS)`, `configureApp(app, env)`, `registerProcessHandlers(await app.resolve(PinoLogger), exit)` (§8; before `listen`, which `src/main.spec.ts` checks) and `listen(env.PORT, env.HOST)`.
- `APP_OPTIONS = { bodyParser: false, bufferLogs: true } satisfies NestApplicationOptions` is used by `main.ts`, `test/support/create-test-app.ts` and `openapi/generate.ts`, so all three run the same middleware stack.
- `configureApp(app, env)`, in this order:
  1. **Request context first:** the nestjs-cls `ClsMiddleware`, mounted by hand with `app.use(new ClsMiddleware({ generateId: true, idGenerator, setup }).use)`, where `idGenerator` is the request-id function of §4 and `setup` sets the `X-Request-Id` response header. `ClsModule.forRoot({ global: true })` does not mount it again (`middleware.mount` defaults to `false`). It runs before helmet, CORS and the body parser, so every response carries `X-Request-Id` and X01's filter finds the request id, also for a 404 outside `/api`, a CORS preflight and a body-parser rejection (400 for malformed JSON, 413). Its plugin hooks run by default (`initializePlugins`), so F04's transactional plugins work through it.
  2. **Versioning, no global prefix:** `enableVersioning({ type: VersioningType.URI, prefix: 'api/v', defaultVersion: '1' })`. With a global prefix, Nest also prefixes every module-middleware mount (nestjs-cls mounts at `/`, nestjs-pino at `{/*splat}`), so a request outside `/api` such as `GET /nope` got neither a request id nor an access-log line. Versioned routes stay `/api/v1/…`; the `VERSION_NEUTRAL` health controller is served at `/health/live`, and `/v1/health/live` and `/api/v1/health/live` answer 404 without any exclusion list. Only the health controller may be `VERSION_NEUTRAL` (an X02 architecture test).
  3. `app.set('trust proxy', env.TRUST_PROXY_HOPS)`.
  4. `app.disable('x-powered-by')`, in addition to helmet.
  5. helmet for a JSON API: CSP `default-src 'none'; frame-ancestors 'none'`, relaxed only on `/api/docs` when `OPENAPI_UI_ENABLED`; HSTS on.
  6. CORS only when `CORS_ORIGINS` is set (the web is same-origin behind the proxy): `origin` is that allowlist, `exposedHeaders` is `['X-Request-Id', 'Retry-After']`. A01 decides `credentials` together with cookies and CSRF.
  7. `useBodyParser('json', { limit: '100kb' })`; the urlencoded parser stays off.
  8. `enableShutdownHooks()` and `useLogger(app.get(Logger))`.
- `AppModule.forRoot(env, options?)` registers, from F03, `EnvModule.forRoot(env)` (global `ENV` provider of type `Env`), `LoggerModule.forRoot(pinoOptions(env, options?.logDestination))`, `ClsModule.forRoot({ global: true })`, `ThrottlerModule.forRoot(throttlers(env))`, `HealthModule`, the global guards `ThrottlerGuard`, then `AuthenticationGuard`, in that order, and the global filter `UnknownExceptionFilter` (`APP_FILTER`, §8), which X01's `ProblemDetailsFilter` replaces. F04 adds the two transactional plugins to `ClsModule` (§5), `PlatformDatabaseModule` and `TenancyModule`; later items add their global providers. The optional `{ logDestination }` is used only by `createTestApp` to capture logs (§12). There is no `@nestjs/config`: nothing reads `process.env` after `main.ts`, and tests and the OpenAPI generator pass their own `Env` object.

## 4. Request pipeline and core abstractions

```text
request-context middleware (requestId; first, from configureApp)
  → helmet, CORS, body parser
  → access log (nestjs-pino module middleware) → JsonOnlyMiddleware (X01)
  → ThrottlerGuard → AuthenticationGuard
  → PracticeContextInterceptor (resolve the practice, check access and status, lease its client)
  → NoStoreInterceptor → ValidationPipe → handler → commit → after-commit listeners (awaited)
  → lease released
  any error → ProblemDetailsFilter (X01; in F03 UnknownExceptionFilter logs unknown exceptions, §8)
```

| Global provider | Since | Job |
|---|---|---|
| `ThrottlerGuard` | F03 | Named throttlers: `default` (`RATE_LIMIT_PER_MINUTE`), the only one F03 registers; `public` (P02: `RATE_LIMIT_PUBLIC_PER_MINUTE`, applied only to `/api/v1/public/**` through `skipIf`); later `join` (B01) and `invitation` (A04), each per account and per address. Counted per route and address: @nestjs/throttler 6.7.1 keys a bucket by controller, handler, throttler name and `req.ip`, so a limit applies to each route separately (staff of one practice often share one address). 429 with `Retry-After`. @nestjs/throttler names the header `Retry-After-<name>` for every throttler except `default`, so each item that adds a named throttler, first P02 with `public`, makes it answer with a plain `Retry-After` |
| `AuthenticationGuard` | F03, body in A01 | Deny by default: a route without `@Public()` returns 401 until A01 verifies the access JWT and the session row in the platform database |
| `PracticeContextInterceptor` | F04 (mechanism), P02 (slug), A01 (id) | For routes marked `@PracticeScoped(…)`, §5 |
| `NoStoreInterceptor` | X02 | `Cache-Control: no-store`, unless the route is `@Public()`, carries `@PublicCache(seconds)` and lies under `/api/v1/public/`; a `@PublicCache()` anywhere else keeps `no-store` and logs an error |
| `ValidationPipe` | X01 | `whitelist`, `forbidNonWhitelisted`, `transform`, `validationError: { target: false, value: false }`, custom `exceptionFactory` |
| `UnknownExceptionFilter` | F03, until X01 | Logs an exception that is not an `HttpException` once, without its message (§8), and answers it as Nest does; X01's `ProblemDetailsFilter` replaces it and keeps that logging rule |
| `ProblemDetailsFilter` | X01 | problem+json for every error ([05](05-errors-i18n-tokens.md)) |
| `JsonOnlyMiddleware` | X01 | 415 for POST, PUT and PATCH without a JSON content type; mounted with `forRoutes('{*path}')` (path-to-regexp v8 syntax, no legacy-route warning) |

Core abstractions:

1. **`RequestContext`** (nestjs-cls 7.0.2); `practice` and `actor` are typed slots from F03 on, which F04 and A01 fill:
   - the request id, which is the CLS id (`ClsService.getId()`), not a key of the store: an inbound `X-Request-Id` in the 8-4-4-4-12 hex form (any case) is kept, in lowercase; anything else (missing, malformed, a repeated header that Node joined with commas) is replaced by `randomUUID()`. One function computes the id once per request and stores it on `req.id`, so the CLS id, the `X-Request-Id` response header and the logged request id are equal. Only a trusted hop chooses the id: the proxy in front of the API sets the header itself and drops a client's value (Caddy: `header_up X-Request-Id {http.request.uuid}`; the compose proxy in F06, the production edge in OPS01), so a client cannot reuse another request's id or give many requests one id and mislead log correlation;
   - `practice` (F04): the `ResolvedPractice` (`id`, `market`, `routeVersion`, `schemaVersion`) and the lease of its client;
   - `actor` (A01): user id, session id, `amr`, and the capacity and role in the current practice.
2. **`@Public()`** marks the reviewed exceptions to deny-by-default, per handler: it marks a method only (on a class it throws when the class is defined), and `AuthenticationGuard` reads the handler only, through `isPublicHandler(handler)` from the same module, so a controller class never opens its routes, including routes added later. The marker is no metadata: `common/security/public.decorator.ts` keeps the marked handlers in a `WeakSet` it does not export, so no other code can mark a handler, and copying a handler's metadata (`SetMetadata`, `Reflect.defineMetadata`) never copies the marker. `@Public()` is the outermost decorator of its handler: a decorator above it that replaces the method (nestjs-cls `@UseCls()`, F04's `@Transactional()`) leaves the marker on the replaced function, so the route stays closed, which fails closed. A decorator that applies `Public()` itself (`applyDecorators(Public(), Get())`) does mark its handler, so the control over which routes are public is a test, not the decorator: the route inventory test `common/security/public-routes.spec.ts` (since F03) reads every controller route of `AppModule.forRoot(parseEnv(TEST_ENV))` at runtime (`DiscoveryService` with `isPublicHandler`), under the path Nest serves it at (`/api/v<version>/…`; no version prefix when the route is version-neutral or its version is empty; a RouterModule path before the controller path), and asserts the exact list of public routes, today only `GET /health/live`; a new public route is a reviewed change to that list. As Nest does, it takes a route's path and version from the prototype's method and checks the instance's property, which is the function the guard sees (for a request-scoped controller it resolves an instance for one request); a handler that a constructor rebinds stays closed, and the test reports it. A fixture app checks on real requests that every listed path answers and that the paths a wrong computation would list do not. `AppModule` imports the same modules in every environment, so the list holds for every `APP_ENV`. Routes mounted outside Nest's router (middleware, adapter routes such as X02's `/api/docs`) pass no guard and are not in it. Each use carries a comment with the reason; X02's architecture tests add the allowed paths: only under `/api/v1/public/**` (which includes the provider callbacks of A02 and N03) and `/health/**`, plus the auth routes from A01.
3. **`Clock`** (P02): `abstract class Clock { abstract now(): Temporal.Instant }`, `SystemClock` in code, `FixedClock` in tests and, with `CLOCK_FIXED_AT`, in local and CI runs. `common/time/convert.ts` is the only place that converts between Prisma's `Date` and `Temporal.Instant`.
4. **Field decorators** (X01): `StringField({ maxLength, minLength?, pattern? })`, `UuidField`, `EnumField(e, { enumName })`, `IntField({ min, max })`, `BooleanField`, `DateTimeField` (ISO 8601 UTC with `Z`), `LocalDateField` (`YYYY-MM-DD`, a real date), `LocalizedTextField({ maxLength })`, `NestedField`, `ArrayField({ maxItems })`. Each combines class-validator, `@ApiProperty` and `context: { code, params }` through `applyDecorators`. A string field without `maxLength` cannot be declared.
5. **`DomainEvents`** (P04): `emitAfterCommit(event)` queues the event in the request context. The owner of the transaction emits the queue after commit with `emitAsync` and awaits it, so listeners run while the request still holds its practice lease; it drops the queue on rollback; outside a transaction it emits at once. A listener that must outlive the request takes its own lease through `runInPractice` (§5). Only `common/events` may import `@nestjs/event-emitter` (lint).
6. **Pagination** (P02): `CursorQueryDto` (`limit` 1–100, default 20, opaque `cursor`) and `CursorPage<T> = { items: T[]; nextCursor: string | null }`.
7. **Added with their first consumer:** `AuditService` for both audit logs and argon2 (A01); `NotificationOutbox`, `AccountNotifications`, `OutboxProcessor` and the `EmailSender` port (A02); field encryption with per-practice keys and the blind index (B01); the `Idempotency-Key` store (B02).

## 5. Data layer and tenancy

ADR 0005 decides the model; this is how the API implements it.

### Two connections

| Connection | Client | Transaction host | Data |
|---|---|---|---|
| `platform` | `PlatformPrismaService` from `src/generated/platform`, `new PrismaPg({ connectionString: PLATFORM_DATABASE_URL, max: PLATFORM_DATABASE_POOL_MAX })`; TLS from the URL (`sslmode=verify-full`, `sslrootcert`) outside `local` and `ci` | `@InjectTransactionHost('platform')`, adapter `TransactionalAdapterPrisma` | accounts, sessions, registry, slugs, index, coordination tables, platform audit |
| `practice` | the current practice's client from `PracticeConnectionManager`, `src/generated/practice` | `@InjectTransactionHost('practice')`, adapter `PracticeTransactionalAdapter` | everything a practice owns |

- Both are registered as `ClsPluginTransactional` instances with the `connectionName`s `platform` and `practice`; `@Transactional('practice')` and `txHost.withTransaction()` work as the library documents.
- `PracticeTransactionalAdapter` is a custom adapter of `@nestjs-cls/transactional` (about 40 lines): `getFallbackInstance()` returns the client of the practice in the request context, `wrapWithTransaction()` opens `$transaction` on that client with `DATABASE_TX_MAX_WAIT_MS` and `DATABASE_TX_TIMEOUT_MS`. Both throw `PracticeContextMissingError` when no practice is resolved.
- One transaction writes one database. A handler whose change has an effect in the platform database writes the practice transaction first and records the effect in the integration outbox (A01), or the API offers two operations.

### `PracticeConnectionManager`

`acquire(route: PracticeRoute, purpose: 'request' | 'public' | 'job'): Promise<PracticeLease>`, where `PracticeRoute` is the registry row (id, cluster id, database name, `appSecretRef`, `routeVersion`, status, market):

1. **Endpoint:** host, port, TLS mode and CA come from the cluster's `database_clusters` row. `DATABASE_CLUSTER_ENDPOINTS` (a JSON map from cluster id to `host:port`, accepted only with `APP_ENV` `local` or `ci`) overrides host and port, so host processes (`127.0.0.1:5432`) and compose containers (`db:5432`) reach the same cluster; `medibooker-db` reads the same variable.
2. Looks up the entry for `(practiceId, routeVersion)`; concurrent misses for one practice share one creation promise.
3. On a miss: the credentials from `SecretStore.get(route.appSecretRef)`, cached per `(practiceId, routeVersion)` for `PRACTICE_SECRET_TTL_MS` and read again once after an authentication failure (`28P01`). Then `new PrismaClient({ adapter: new PrismaPg({ host, port, database, user, password, ssl, max: PRACTICE_POOL_MAX, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 2_000, application_name: 'medibooker-api' }), errorFormat: 'minimal', log: ['warn', 'error'] })`, where `ssl` is `{ ca, rejectUnauthorized: true, servername: host }` with the CA from the cluster's `ca_secret_ref`; it is left out only for `tls_mode: 'disable'`, which `local` and `ci` alone accept. One query then compares `practice_identity` with the route and reads `has_database_privilege('public', current_database(), 'CONNECT')`. A different id logs `PRACTICE_IDENTITY_MISMATCH`, an open `CONNECT` logs `PRACTICE_ACL_OPEN`; both close the client and throw `PracticeUnavailableError`.
4. Increments the entry's in-flight count; `lease.release()` decrements it and records the time and purpose from the `Clock`.
5. **Budgets** (ADR 0005 §2.2): at most `PRACTICE_CLIENTS_MAX` entries; entries last used only by `public` acquisitions at most `PUBLIC_PRACTICE_CLIENTS_MAX`, and by `job` acquisitions at most `JOB_PRACTICE_CLIENTS_MAX`. A `public` or `job` acquisition may evict only an idle entry that no `request` used within `PRACTICE_CLIENT_IDLE_MS`; a `request` acquisition evicts the least recently used idle entry. Above `PRACTICE_CLIENT_CREATIONS_PER_SECOND`, a `public` acquisition fails at once and the others wait. When no entry can be evicted, `acquire()` waits up to 2 s for a release and then throws `PracticeUnavailableError`; the limits are never exceeded.
6. **`evictIdle()`** closes entries idle for `PRACTICE_CLIENT_IDLE_MS` and entries with an older `routeVersion` once their in-flight count is zero. An `unref()`'d interval of a quarter of `PRACTICE_CLIENT_IDLE_MS` calls it; tests step the `FixedClock` and call it directly.
7. A connection failure (refused, `invalid_catalog_name`, `insufficient_privilege` on connect, a certificate that fails verification) closes the entry and throws `PracticeUnavailableError`, which becomes 503 `SERVICE_UNAVAILABLE` with `Retry-After`.

The cache is a `Map` (insertion order gives the LRU) with reference counts; no library is needed. Metrics: open clients per purpose, creations, evictions, waits, authentication failures, identity mismatches and open ACLs.

### Practice resolution: `@PracticeScoped()`

| Decorator | Since | Resolution |
|---|---|---|
| `@PracticeScoped('slug')` | P02 | `{slug}` → `practice_slugs` joined with `practices` in one query, cached per process for `PUBLIC_ROUTE_CACHE_MS` (times from the `Clock`). The status table (ADR 0005 §5) and the market check decide before any client is leased: unknown, unpublished, provisioning and offboarded practices → 404; a published practice that is suspended, moving or under restore review → 503. A retired slug resolves to its practice and the response carries the current slug. Leases with purpose `public` |
| `@PracticeScoped('id', { staffRoles })` | A01 | `{practiceId}` → `practices` joined with the caller's `practice_access` rows, read on every request; 404 without a practice or without an active, unexpired index row. Then the status table and the market check, then in the practice database an `ACTIVE`, unexpired membership with a role in `staffRoles`, and `mfa` in the session's `amr` (401 `MFA_REQUIRED` otherwise); 403 for another role or capacity; 404 when the practice database shows no capacity at all |
| `@PracticeScoped('id', { patient: true })` | B01; family links in FA01 | As above up to the status table; then a patient profile of the actor, or from FA01 an `ACTIVE` family link. Delegation per `patientId` is checked in the service |
| `@PracticeScoped('id', { join: true })` | B01 | An `ACTIVE`, published practice and a verified account; no capacity yet. Used only to create the caller's own patient profile; named throttler `join` (5 per day per account and per address) |
| `@PracticeScoped('id', { invitation: 'staff' \| 'family' })` | A04 (staff), FA01 (family) | A practice whose status serves signed-in requests (publication not required) and a verified account; the token hash and the invited e-mail address are checked in the practice database. Unknown practice, unknown, expired or used token and e-mail mismatch all give the same 404, and no client is leased before the registry check passes. Named throttler `invitation`. Allowed only on routes ending in `-invitations/accept` |

- After the checks the interceptor compares the practice's `schema_version` with `PRACTICE_SCHEMA_REQUIRED` (503 when older), stores the `ResolvedPractice` and the lease in the request context and releases the lease in `finalize`, after the awaited after-commit listeners, also when the pipe or the handler throws.
- The instance that changes a slug or publication clears its own route cache entry; other instances follow within `PUBLIC_ROUTE_CACHE_MS`. Status changes are read on every signed-in request.
- Headers, the query string and the body never select a practice.
- An architecture test (X02) fails for a route under `/practices/{practiceId}` or `/public/practices/{slug}` without `@PracticeScoped`, for `@PracticeScoped` on any other route, and (from A04) for the `invitation` mode on a route that does not end in `-invitations/accept`.

### Outside a request: `runInPractice`, jobs and caches

- **`runInPractice(practiceId, fn, { purpose })`** is the only way into a practice outside an HTTP request. It opens a fresh CLS context, reads the registry row, applies the status table for its purpose (jobs and the relay only `ACTIVE`), the market check and the schema guard, leases a client and runs `fn`. A practice that is not available throws `PracticeUnavailableError`, which callers record (for example in `unavailablePractices`). `forEachPractice`, the `/me` fan-out (B03), export and saga steps (PR01), the integration relay (A01), provider callbacks (A02, N03) and realtime joins (RT01) use it, and inside it they take the caller's patients from the practice database, never from the index.
- **`forEachPractice(fn, { concurrency })`** lists the `ACTIVE` practices of the registry and calls `runInPractice` with purpose `job` for each. A failing practice is logged and counted; the others continue.
- **Due work by polling (A02):** `findPracticesWithDueWork()` runs every `WORK_POLL_SECONDS` (30): `forEachPractice` with concurrency 4 and one query per practice, `SELECT 1 FROM notifications WHERE next_attempt_at <= $1 LIMIT 1` and the same for `integration_outbox`. The processors then claim rows with `FOR UPDATE SKIP LOCKED`, so every instance can poll and each row is processed once. The `job` budget keeps polling from evicting request clients.
- **Once-per-period jobs** (P04 slot generation, FA01 age of majority) first claim `practice_job_runs (job, practice_id, period)` with a unique insert in the platform database, then lease the practice; only the instance that wins the insert visits the practice in that period, and the row records `finished_at` and an error code.
- **Scaling step,** when the `ACTIVE` practices of a deployment exceed `PRACTICE_CLIENTS_MAX` or OPS01's metrics show job-driven client creations: `practice_work_hints (practice_id, kind, due_at)`, upserted with `due_at = LEAST(…)` in the platform database before the practice transaction that creates due work, so a crash leaves at most a spurious hint and never a lost one. Workers then visit hinted practices only, and a daily reconciliation run, claimed like a once-per-period job, catches the rest.
- **`PracticeCache`** (F04) is the only way to cache practice data, in process or shared: its keys are built from the request context's resolved practice and `route_version`, and it refuses to work without one. Singleton rows have id 1 in every practice database, so a key from table and id alone is forbidden (ADR 0005 §10).

### Data access rules

- Modules use only the two transaction hosts. `PlatformPrismaService` and the connection manager are used directly only in `common/` and `health/`.
- Services never filter by practice: the database is the boundary. Ownership inside a practice (own appointment, managed patient, own availability rule) is still checked in the service.
- Row locks use tagged `$queryRaw … FOR UPDATE` inside a practice transaction.
- Cross-practice reads (the `/me` fan-out, B03; the export job, PR01) go through `runInPractice` with explicit limits and per-practice timeouts, never through a loop of ad-hoc clients.

## 6. Database lifecycle: provisioning, migrations and operations

`apps/db-migrate` (`@medibooker/db-migrate`) is the command-line tool `medibooker-db` for everything that creates, changes, moves or removes a database. It is plain TypeScript run by Node's type stripping (`erasableSyntaxOnly`, like the root scripts), uses `pg` and spawns the Prisma CLI. It reads the schemas, migrations and configs from `PRISMA_ROOT` (`../api` in the workspace, `/app/schema` in the migrate image) and, outside production, the root `.env` (§3). The API image does not contain it.

| Command | Does | Since |
|---|---|---|
| `migrate platform` | `prisma migrate deploy --config prisma.platform.config.ts` as `platform_owner` | F04 |
| `migrate practices [--practice <id>]` | the migration runner (ADR 0005 §6) | F04 |
| `migrate all` | both, in this order | F04 |
| `provision <practiceId> --market <cc> [--cluster <id>]`; from P01 also `--time-zone <iana> --default-locale <locale>` | provisioning (ADR 0005 §5.3) | F04 |
| `verify [--practice <id>]` | schema drift and database ACL per practice (ADR 0005 §6.7) | F04 |
| `roles reconcile [--practice <id>]` | applies the connection limits and role settings to every practice's roles | F04 |
| `reset-local` | drops the local platform and practice databases and their roles, recreates the platform database; refused unless `APP_ENV` is `local` or `ci` | F04 |
| `backup`, `restore`, `move`, `practice suspend\|resume`, `rotate-credentials`, `deprovision [--finalize]` | ADR 0005 §4.7, §5 and §8 | OPS02 |
| `cluster bootstrap <id>`, `break-glass open\|close` | cluster roles, CA and registration; incident access (ADR 0005 §9.4) | OPS01 |

Every command:

- writes `platform_audit_events` before and after it runs, as `platform_owner`, with the operator principal from the task's cloud identity (locally `local:<OS user>`) and the approval reference (ADR 0005 §5.2);
- captures the Prisma CLI's output and prints only one JSON line per practice (id, from, to, duration, error code) and a summary; the raw output goes to the task's in-region log at debug level, never to CI logs ([07 §6](07-docker-ci-cd.md#6-image-publishing-and-the-deploy-placeholder));
- logs practice and cluster ids only, never a host, user, connection string, secret reference or password.

### Migration runner

- The target is the newest folder name in `prisma/practice/migrations`; the timestamp prefix makes names comparable as strings. The runner selects the statuses that ADR 0005 §5 migrates: `ACTIVE`, `SUSPENDED` and `RESTORE_REVIEW`.
- Per practice: the owner credentials from `owner_secret_ref`, then `node <prisma>/build/index.js migrate deploy --config prisma.practice.config.ts` with `PRACTICE_MIGRATION_URL` set (`application_name=medibooker-migrate`; outside `local` and `ci` also `sslmode=require&sslcert=<CA file>&sslaccept=strict`), `cwd` = `PRISMA_ROOT` and a timeout of `MIGRATION_TIMEOUT_MS`. Afterwards the newest finished, not rolled-back entry of `_prisma_migrations` becomes `schema_version` in the registry.
- **Recovery:** on P3009 the runner reads the unfinished entry. With a database error in its `logs` it runs `migrate resolve --rolled-back <name>` and deploys again in the same run; without one it records `MIGRATION_STATE_UNKNOWN` and leaves the entry for the runbook. `lock_not_available` (`55P03`) is retried up to `MIGRATION_LOCK_RETRIES` times with exponential backoff. When the timeout fires, the runner calls `pg_terminate_backend` for the backends with `application_name = 'medibooker-migrate'` on that database, waits for Prisma to exit and records `MIGRATION_TIMEOUT`.
- Output: exit code 1 when any practice failed. OPS01 alerts on it.
- `MIGRATION_CONCURRENCY` (default 4) runs in parallel. A session-level advisory lock on a dedicated platform connection keeps runners exclusive; the runner connects directly, never through PgBouncer.
- `restore` and `move` migrate their new database before the routing switch and write `schema_version` from its `_prisma_migrations`.

### Provisioning details

- Role and database names come from the practice id (`practice_<id32>`, `practice_<id32>_app`, `practice_<id32>_owner`).
- `SecretStore.ensure(ref)` returns the stored secret or creates it: 32 random bytes, base64url, in the provider's store; derived from `DEV_SECRET_SEED` in the development store. Secret references `dev:<name>` and `env:<VARIABLE>` resolve only in `APP_ENV` `local` and `ci`; OPS01 adds the provider's scheme. A reference that cannot be resolved stops the command before any database statement runs.
- Passwords reach PostgreSQL only as SCRAM-SHA-256 verifiers computed with `node:crypto` (PBKDF2-SHA-256, 4096 iterations, a random 16-byte salt): `CREATE ROLE … LOGIN PASSWORD 'SCRAM-SHA-256$4096:<salt>$<stored key>:<server key>'`. Each run also applies `CONNECTION LIMIT` (`PRACTICE_APP_CONNECTION_LIMIT`, `PRACTICE_OWNER_CONNECTION_LIMIT`) and, for the app role, `ALTER ROLE … SET statement_timeout = '15s'` and `SET idle_in_transaction_session_timeout = '30s'`.
- PostgreSQL 16 and later give a `CREATEROLE` role the `ADMIN` option on the roles it creates, but no membership. The cluster setup therefore runs `ALTER ROLE medibooker_provisioner SET createrole_self_grant = 'set'`: the provisioner may `SET ROLE` to an owner role, which `CREATE DATABASE … OWNER` requires, without inheriting its privileges. Owner-only steps switch explicitly. There is no group role, so the provisioner never grants role membership.
- `createPracticeDatabase()` is the only code that creates a practice database (ADR 0005 §4.2). As the provisioner:

  ```sql
  CREATE DATABASE practice_<id32> OWNER practice_<id32>_owner TEMPLATE template0
    ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8';
  SET ROLE practice_<id32>_owner;
  REVOKE ALL ON DATABASE practice_<id32> FROM PUBLIC;
  GRANT CONNECT ON DATABASE practice_<id32> TO practice_<id32>_app;
  ALTER DATABASE practice_<id32> SET medibooker.app_role = 'practice_<id32>_app';
  RESET ROLE;
  ```

- In `local` and `ci`, `provision` registers the cluster `local` from `PROVISIONER_DATABASE_URL` when `database_clusters` is empty.
- **Template copies** (local and CI only): `db:seed` creates `practice_template` with the same `CREATE DATABASE` options (builtin `C.UTF-8` locale), migrates it and records its newest migration with `COMMENT ON DATABASE`. `provisionPractice({ fromTemplate: true })` connects as the cluster superuser, refuses with "run pnpm db:seed" when that comment differs from the newest migration folder, copies the template through `createPracticeDatabase({ template: 'practice_template' })` and grants DML on the copied tables to the new app role. Copies are never migrated.
- **Test helpers:** the package exports `./testing` with `provisionPractice`, `dropPractice` (status `DEPROVISIONING`, `DROP DATABASE … WITH (FORCE)`, both roles, the registry rows), `seedPracticeFixture(practice, data)` and `loadWorkspaceEnv()`. It is a devDependency of the API (seed, integration harness) and of the web (e2e fixtures), and an API integration test covers it ([01 §3](01-repo-and-tooling.md#3-shared-packages)).
- From OPS02, `pg_dump` and `pg_restore` run through a `PgTools` port: the CLI uses the PostgreSQL 18 binaries of the migrate image, tests run them with `container.exec()` inside the `postgres:18.6` test container, so they always match the server's major version.

## 7. Configuration

`config/env.schema.ts` (zod 4) defines `Env`. `parseEnv(source)` takes an explicit object, so tests never read the ambient environment. The root `.env.example` lists every variable of the API and of the database tools with placeholders; `apps/api` has no `.env` file of its own. `config/env-example.spec.ts` proves that the file parses and lists exactly the API's variables (F04 adds an allowlist for the keys only the database tools read); `apps/api/turbo.json` makes the root file an input of the API's `test` task.

Rules:

- Environment conditions in this section ("in production", "outside local and ci") refer to `APP_ENV`.
- `APP_ENV` is required and has no default: a missing value must never fall back to the least restrictive environment.
- `APP_ENV` `staging` and `production` require `NODE_ENV=production`. `NODE_ENV` defaults to `development`.
- An empty or blank (whitespace-only) value counts as unset: `z.coerce.number()` turns `''` and `' '` into `0`, which would satisfy a required `TRUST_PROXY_HOPS` or make `PORT` 0.
- Integers are decimal digits only (`z.string().regex(/^\d+$/)`, then a number check): `z.coerce.number()` alone accepts `0x1`, `1e3` and `+1`.
- Booleans accept exactly `true` or `false`: `z.stringbool({ truthy: ['true'], falsy: ['false'], case: 'sensitive' })` (`strictBoolean()`; zod's default would also accept `TRUE`). Never `z.coerce.boolean()`, which reads `'false'` as `true`.
- The debug switches `DEBUG`, `NODE_DEBUG` and `NODE_DEBUG_NATIVE` are read by the `debug` package (Express's router, body-parser, finalhandler) and by Node itself when a module loads, never by the API, and their output goes to stderr, outside pino, with request URLs and query strings. They are rejected in staging and production, accepted in local and ci, and not part of `Env`.
- Cross-field rules run in one refinement that runs even when other keys failed (zod's `when`), and each rule reads only keys that parsed, so one run names every invalid key without reading a failed key's value. Every new rule gets a test that pairs it with a malformed key (F04 adds several).
- `CORS_ORIGINS` entries are origins (`scheme://host[:port]`; no path, no `*`), https only in production.
- `HOST` defaults to `0.0.0.0` for containers. The root `.env.example` sets `127.0.0.1`, so a development API is not reachable from the local network.
- `parseEnv` writes one line per invalid key, with the zod issue code, to stderr, never a value or an issue message, and then exits with code 1.

| Variable | Default and rule | Since |
|---|---|---|
| `NODE_ENV` | `development` (default), `test` or `production` | F03 |
| `APP_ENV` | `local`, `ci`, `staging` or `production`; required, no default | F03 |
| `PORT` · `HOST` | `3001` · `0.0.0.0` | F03 |
| `LOG_LEVEL` · `LOG_PRETTY` | `info` · `false`; `LOG_LEVEL` `fatal` and `silent` rejected in staging and production, because both drop the error lines of §8; `LOG_PRETTY=true` rejected with `NODE_ENV=production` (so in staging, production and every run of the built image, which has no devDependency pino-pretty) | F03 |
| `CORS_ORIGINS` | empty = CORS off; comma-separated origins, https only in production | F03 |
| `TRUST_PROXY_HOPS` | `0` in local and ci; required without default in staging and production; `1` in the compose `app` profile | F03 |
| `OPENAPI_UI_ENABLED` | `false`; rejected in production | F03 |
| `RATE_LIMIT_PER_MINUTE` · `RATE_LIMIT_PUBLIC_PER_MINUTE` | `120` · `60`; `RATE_LIMIT_PER_MINUTE` at most `1000` in staging and production, so a value copied from `TEST_ENV` (`100000`, §12) cannot switch throttling off | F03 · P02 |
| `PLATFORM_DATABASE_URL` | required; role `platform_app` (from OPS01 `platform_app_a` or `platform_app_b`); outside local and ci it must carry `sslmode=verify-full` and `sslrootcert` | F04 |
| `PLATFORM_DATABASE_POOL_MAX` | `10` | F04 |
| `PRACTICE_POOL_MAX` · `PRACTICE_CLIENTS_MAX` · `PRACTICE_CLIENT_IDLE_MS` | `3` · `40` · `60000` | F04 |
| `PUBLIC_PRACTICE_CLIENTS_MAX` · `JOB_PRACTICE_CLIENTS_MAX` · `PRACTICE_CLIENT_CREATIONS_PER_SECOND` | `10` · `4` · `5` | F04 |
| `PRACTICE_SECRET_TTL_MS` | `600000` | F04 |
| `DATABASE_CLUSTER_ENDPOINTS` | JSON map from cluster id to `host:port`; accepted only with `APP_ENV` `local` or `ci` | F04 |
| `DATABASE_TX_MAX_WAIT_MS` · `DATABASE_TX_TIMEOUT_MS` | `2000` · `5000` | F04 |
| `SECRET_STORE` · `DEV_SECRET_SEED` | `dev` is accepted only with `APP_ENV` `local` or `ci`, and then the seed is required; the provider adapter arrives in OPS01 | F04 |
| `MARKETS` | comma-separated ISO 3166-1 alpha-2 codes; required in staging and production | F04 |
| `PUBLIC_ROUTE_CACHE_MS` | `10000`, at most `60000` | P02 |
| `CLOCK_FIXED_AT` | ISO instant; accepted only when `APP_ENV` is `local` or `ci` | P02 |
| `SUPPORT_ACCESS_ENABLED` · `SUPPORT_ACCESS_MAX_HOURS` | `false` · `72` (D8, question 4) | A01 |
| `WORK_POLL_SECONDS` | `30`; the relay (A01) and the outbox poller (A02) | A01 |
| `ME_FANOUT_MAX_PRACTICES` · `ME_FANOUT_CONCURRENCY` · `ME_FANOUT_TIMEOUT_MS` | `20` · `4` · `2000` | B03 |
| `REALTIME_RECHECK_SECONDS` | `30`: how often the gateway checks each socket's session, membership and practice status again | RT01 |
| `APP_MIN_VERSION_IOS` · `APP_MIN_VERSION_ANDROID` | `0.0.0` | X02 |
| `PUBLIC_WEB_URL` | base URL for every link in e-mails, never request headers; https in production | A02 |
| `JWT_*`, `SMTP_*` | defined with their items | A01, A02 |
| `FIELD_ENCRYPTION_KEYS` · `BLIND_INDEX_KEY` | versioned keys for platform fields only (MFA secrets, device tokens) · the deployment key from which the per-practice blind-index and `ip_hash` keys are derived with HKDF; practice fields use the practice's field key (ADR 0005 §4.8) | A01 · B01 |

Read only by `medibooker-db` and the Prisma CLI: `PLATFORM_MIGRATION_URL` (role `platform_owner`), `PRACTICE_MIGRATION_URL` (set per practice by the runner; locally the authoring database), `SHADOW_DATABASE_URL`, `PROVISIONER_DATABASE_URL` (local and CI only; elsewhere a secret reference in `database_clusters`), `DATABASE_CLUSTER_ENDPOINTS`, `MIGRATION_CONCURRENCY`, `MIGRATION_TIMEOUT_MS`, `MIGRATION_LOCK_RETRIES` (`3`), `PRACTICE_APP_CONNECTION_LIMIT` (`20`), `PRACTICE_OWNER_CONNECTION_LIMIT` (`4`), `MOVE_KEEP_DAYS` (`7`), `BACKUP_CONCURRENCY` (`2`), `PRISMA_ROOT`. Outside local and ci the Prisma CLI URLs carry `sslmode=require&sslcert=<CA file>&sslaccept=strict`, and the `pg_dump` connections `sslmode=verify-full sslrootcert=<CA file>`.

## 8. Logging and redaction

- nestjs-pino 5.3.1, pino 10.4, pino-http 11; JSON lines. pino-pretty is a devDependency of the API, used only with `LOG_PRETTY` and resolved by absolute path from the API: with pnpm's isolated layout, pino cannot resolve it from pino-http.
- **Order of a log line** (`pinoOptions`, so also every child logger): the `logMethod` hook (constant messages), then `formatters.log` (the field allowlist), then the serializers of the remaining `err`, `req` and `res`, then redaction. pino-http hands the serializers the raw request, response and error (`wrapSerializers: false`): its default wrappers from pino-std-serializers read every property of an error before the allowlist serializer runs, the message included, so a getter that threw there failed the log call, and in `UnknownExceptionFilter` the filter with it.
- **Field allowlist:** `formatters.log` (`common/logging/log-fields.ts`) keeps only these top-level fields of a log call's object, in their order:
  - written by the framework: `context` (in the form of a class name such as `UnknownExceptionFilter`; a Nest `Logger` without a context of its own passes its last argument there, so `new Logger().log('booked for %s', email)` would log the e-mail address as the context: the form drops it, but a name-shaped value such as `Sara` passes, so a `Logger` is always created with `<Class>.name`, which the ESLint rule `medibooker/require-logger-class-name` enforces since F02), `err`, `req` and `res` (any value; their allowlist serializers decide what is logged) and `responseTime` (a number);
  - the reviewed fields of `REVIEWED_LOG_FIELDS`: ids, codes, counts and durations, each named with the item that logs it and with the form of its value, so it cannot carry other text. Today `practiceId` (a UUID) and `clusterId` (a lowercase slug such as `local`), both F04, below; an item that logs another field (for example the reason code of `PracticeUnavailableError`, [05 §1](05-errors-i18n-tokens.md#1-error-system)) adds it with its form, and extending the set is a reviewed change (security-reviewer).

  Everything else is removed, also nested objects, an error under another key than `err` and a `msg` field, and the line gets `droppedFields: <number>`, never the names, because a key can itself be personal data. Child-logger bindings (`logger.child`, pino's `setBindings` and `msgPrefix` option, and nestjs-pino's `PinoLogger.assign` and `runInContext`) do not pass through `formatters.log`, because pino resets a child's bindings formatter; only pino-http's `reqId` is bound today, and redaction covers the names it lists. Bindings are therefore set only in `common/logging` (the ESLint rule `medibooker/no-log-bindings`, since F02): F04 adds `bindLogFields(logger, fields)` there, which passes them through the allowlist, with the first binding (`practiceId`).
- **Allowlist serializers:** `req` = `{ id, method, route }`, each only in its form: `id` a UUID, `method` one of Node's HTTP methods, and `route` the matched route pattern, read only from a Node request and never the concrete path or the query string, so a hand-written `{ req: someObject }` logs nulls; `res` = `{ statusCode }`; plus `responseTime` and, from F04, the resolved `practiceId`.
- **Route pattern at completion:** pino-http serializes a child logger's bindings when it creates the child at the start of the request, before routing, so a `req` serializer there cannot see the matched route (the F03 probe saw the middleware mount `{/*splat}`). The access log therefore runs with `quietReqLogger` and `quietResLogger`, and `customSuccessObject` and `customErrorObject` add `req` at completion. There the allowlist serializer reads `req.route?.path`: the matched handler's pattern (for example `/api/v1/practices/:practiceId/appointments/:id`), also when a guard rejected the request (401, 429). Lines logged during the request carry `reqId`.
- **Unmatched requests** end on a middleware mount pattern, which always contains `*`; such a pattern is logged as `route: null`. Controller routes never contain `*` (an X02 architecture test).
- **Body-parser rejections** (400 for malformed JSON, 413) are answered before the access-log middleware runs: they carry `X-Request-Id` but have no access-log line. Nest's Express adapter maps them to an `HttpException` first (a 4xx http-errors error keeps its status), so they get no exception line either.
- **Error serializer:** `{ type, code, prismaCode, model, constraint, stack }`, with the stack's header replaced by the class name. The type is the name of the error's class, read from its prototype (an own `constructor` property is ignored) and kept only in the form of a class name, otherwise `Error`. Node writes the header when `stack` is first read: `Error.prototype.toString` of the error at that moment (`Name: message`), and for most of its own errors `Name [CODE]: message`. The header spans as many lines as the name and the message have, and a line of them can look like a frame (`    at …`), so it is cut off whole, in either form; a stack that starts with neither (the message was replaced after the stack was written, or the stack is another error's) gets no frames, because the length of its header is unknown. Of the rest only lines in the form of a V8 frame that ends in its location are kept, WebAssembly frames included. One case stays open: when a message is shortened after the stack was written, or a stack is copied onto an error whose message is the first line of the original one, the rest of the original header follows the cut, and a line of it shaped exactly like a frame with a location is kept. Code therefore never passes `err.stack` to a logger (the ESLint rule `medibooker/no-dynamic-log-message`, since F02) and never changes an error's message after creating it (a review rule). `message` is logged only for the project's own `DomainException`; `cause`, Postgres `detail`, `meta` values and every other property are dropped. F03 implements `{ type, code, stack }`, with `code` only in the form of an error code (`ERR_INVALID_ARG_TYPE`, `ECONNREFUSED`, `P2002`, `23505`); when reading the error fails in any way (a getter that throws, a message without a text form) only `{ type }` is logged, so a log call never fails on its error. `prismaCode`, `model` and `constraint` arrive with Prisma in F04, `message` for `DomainException` with X01.
- **Constant messages:** the `msg` of a line that project code logs is always text written in code. Framework code builds some messages at runtime: Nest's boot lines from code metadata (module names, controller paths, route patterns), and `NestApplication.listen`, which logs `error.toString()` of a listen error, the bind address (`Error: listen EADDRINUSE: address already in use 127.0.0.1:3001`); none of them carries request data. `src/main.spec.ts` checks every line of a production boot on a taken port against these forms, so a framework line with other text fails it. The pino `hooks.logMethod` hook `keepMessageConstant` passes on the first argument and the message only:
  - Interpolation values are dropped: `logger.info('booked for %s', email)` logs `booked for %s`, also when nestjs-pino forwards Nest's `Logger.log(message, ...values)` as `({ context }, message, ...values)`, which keeps the context.
  - A message that is not a string becomes its type (`object`, `TypeError`): pino would write an object as JSON.
  - pino 10.4 copies an error's message into `msg` when a call passes an error without a message of its own (`logger.error(err)`, `logger.error({ err })`, and Nest's `logger.error(exception)`, which nestjs-pino forwards as `({ context, err }, undefined)`), before any serializer runs. The hook gives such a call the error's type as its message.
  - An exception that is not an `HttpException` (Nest calls it unknown) is logged by project code, never by Nest's handler: the global `UnknownExceptionFilter` (F03) logs it once at `error` through the request logger, with the constant message `unknown exception` and `err` from the serializer, and answers it as Nest does (500, or the status of an http-errors error when it is a 4xx or 5xx status; 500 when reading the error for that throws). Nest's handler would also log a thrown string as the message and merge the fields of a thrown object into the line. X01's `ProblemDetailsFilter` takes over this rule.

  The hook reads the first argument's `err` once, and pino reads it again: an object whose `err` changes between the two reads (a getter with state, a Proxy) could still get the error's message into `msg`; no realistic call does that, so it is an accepted residual. A message built at runtime, such as a template literal or `err.message`, cannot be told apart from a constant at runtime, so the ESLint rule `medibooker/no-dynamic-log-message` (F02) requires the message argument of a logger call to be a string literal or a template literal without expressions, and no argument may read `.message` or `.stack` ([01 §2](01-repo-and-tooling.md#eslint-presets-and-guardrails-medibookereslint-config)).
- **Which logger:** Nest's `Logger` (`new Logger(<Class>.name)`) logs constant messages only, such as `this.logger.log('practice provisioned')`. An error or reviewed fields go through nestjs-pino's `PinoLogger`, injected with its context set to the class name (`logger.setContext(<Class>.name)` in the constructor, as `UnknownExceptionFilter` does), or through `req.log`: `this.logger.error({ err }, 'booking failed')`, `req.log.info({ practiceId }, 'practice resolved')`. Nest's `Logger` declares the message as its first parameter, so `medibooker/no-dynamic-log-message` reports an object there. No rule checks the context passed to `setContext` or `@InjectPinoLogger`: it is `<Class>.name` by review (a follow-up of the logging rules, ADR 0006 decision 6).
- **Redaction** as a second line, for what the field allowlist does not see (child-logger bindings): `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-csrf-token"]`, `res.headers["set-cookie"]`, and `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `secret`, `mfaSecret`, `recoveryCodes`, `deviceToken`, `email`, `phone`, `firstName`, `lastName`, `dateOfBirth`, `insuranceNumber` and `patientNote` at the top level and one and two levels down (`email`, `*.email`, `*.*.email`; a `*` matches one level, array items included).
- **Process handlers:** `registerProcessHandlers(logger, exit)` (`common/logging/process-handlers.ts`), registered by `main.ts` right after `configureApp` and before `listen`, logs an uncaught exception or an unhandled rejection, also a rejected `listen`, once at `fatal` through the app's pino logger, with the constant message `uncaught exception` or `unhandled rejection` and `{ err }` through the serializer, and then exits with code 1; a failure while logging still exits. An error thrown while `NestFactory.create` builds the providers comes before these handlers and before `useLogger`, and Nest's console logger would print it to stderr, so provider factories do no I/O: database clients connect in `onModuleInit`, which runs during `listen` (F04). `src/main.spec.ts` runs `src/main.ts` itself on a taken port, in a child process: Nest's listen error line with the bind address, then one fatal line, nothing on stderr, exit code 1. Moving the registration after `listen` fails it. Without them Node writes `util.inspect(err)` to stderr, outside pino: the message, the cause and every property, such as Postgres `detail`, which a background job such as A02's poller would reach.
- **Databases:** the connection manager and `medibooker-db` log practice id and cluster id only, never a host, user, connection string, secret reference or password. A `practice_access` row is never logged with its user id.
- **Outside the API:** PostgreSQL's own log runs with the settings of ADR 0005 §4.10 (also in compose and Testcontainers), `medibooker-db` prints only its JSON summary (§6), and the edge logs route templates and truncated addresses only (OPS01).
- No request or response bodies.
- **Health probes are not logged:** `autoLogging.ignore` matches the exact paths, query stripped, of the probes that exist (`/health/live` from F03, `/health/ready` from F04).
- Levels: 5xx at `error` with the serialized error; 4xx at `info` with the code only.
- Prisma: both clients use `errorFormat: 'minimal'` and `log: ['warn', 'error']`, routed through pino. Query logging is rejected in production.
- Tests prove it: captured logs never contain the synthetic markers `secret-value` or `sara@example.test`, tokens, cookies, query strings or database passwords, including after a thrown `Error`, string or http-errors error that carries them in its message, an `Error` whose message is not a string or whose message getter throws, the hand-written calls of the F03 security review (an interpolation value, an object with personal data three levels down, an error under another key than `err`, unlisted fields such as `mfaSecret`), a Nest `Logger` without a context, a `{ req }` written by hand, error codes, class names and stack header lines that carry text, a getter that throws while Nest or the serializer reads an error, an http-errors status that is not an error status, a thrown value whose prototype cannot be read, and a crashing process (a child process writes one pino line and nothing to stderr) (F03), a forced `PrismaClientValidationError`, a CHECK violation, a unique violation, a refused practice connection and a provisioning run; from F04 the Testcontainers server log is checked the same way (F04, X01). The access line keeps exactly its fields, and no framework line has `droppedFields`.

## 9. Prisma schemas and conventions

### Configuration

```ts
// apps/api/prisma.practice.config.ts; prisma.platform.config.ts differs only in
// the platform paths and PLATFORM_MIGRATION_URL
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Outside production, load the workspace root's .env. In the migrate image no
// pnpm-workspace.yaml exists above /app/schema, so nothing is loaded there.
if (process.env.NODE_ENV !== 'production') {
  for (let dir = process.cwd(); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const file = path.join(dir, '.env');
      if (existsSync(file)) process.loadEnvFile(file);
      break;
    }
  }
}

export default defineConfig({
  schema: 'prisma/practice/schema.prisma',
  migrations: { path: 'prisma/practice/migrations' },
  datasource: {
    url: process.env.PRACTICE_MIGRATION_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
```

- The CLI takes a config with `--config`; every command runs with `apps/api` (or `PRISMA_ROOT`) as the working directory, so the relative paths resolve the same way everywhere.
- `env()` from `prisma/config` throws when a variable is unset, and the CLI loads the config for every command, `generate` included. With plain `process.env`, `prisma generate` works without a database (CI quality job, Docker build, fresh clone), and migrate commands still fail fast without a URL.

```prisma
// prisma/practice/schema.prisma; the platform schema differs only in the output path
generator client {
  provider            = "prisma-client"
  output              = "../../src/generated/practice"
  moduleFormat        = "esm"
  importFileExtension = "js"
  previewFeatures     = ["partialIndexes"]
}

datasource db {
  provider = "postgresql"
}
```

`scripts/write-schema-versions.ts` writes `src/generated/schema-versions.ts` with `PLATFORM_SCHEMA_REQUIRED` and `PRACTICE_SCHEMA_REQUIRED`: the newest migration folder name of each schema at build time.

### Conventions

- Models PascalCase singular with `@@map("snake_plural")`; fields camelCase with `@map("snake")`.
- IDs: `String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` (UUIDv4; UUIDv7 would leak creation times in URLs and push payloads). Results that combine several practices (B03, PR01) carry `practiceId` next to each id, so clients address the right practice.
- Instants `@db.Timestamptz(3)`; practice-local times as `smallint` minutes or `time(0)`; dates `@db.Date`.
- Text per locale: `Json` with `CHECK (jsonb_typeof(x) = 'object')`.
- Enums UPPER_SNAKE. Every field has a `/// class: public|personal|health|secret` comment.
- **The practice schema has no `practiceId`.** References inside a practice are plain relations with `onDelete: Restrict` unless a business rule says otherwise. An architecture test enforces both (P01).
- **The platform schema holds health data only in the allowlisted tables** of ADR 0005 §1.1 (`practice_access`, `account_deletions`, `account_exports`, `revocation_journal`, `provider_messages`), each with a retention; an architecture test from A01 fails for a `health` field anywhere else.
- Singleton tables (`practice_identity`, `practice_settings`, `practice_themes`) use `id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1)`.
- Sorting names for people uses an explicit ICU collation in the query (`ORDER BY last_name COLLATE "und-x-icu"`); the database default is the builtin `C.UTF-8` (ADR 0005 §5.3).

| Where | What |
|---|---|
| `schema.prisma` | Tables, unique constraints, foreign keys, indexes, partial indexes (`@@index([startsAt], where: raw("status = 'OPEN'"))`, written exactly as `prisma db pull` prints the predicate) |
| Hand-written SQL in the migration, after `migrate dev --create-only` | The transaction header and `COMMIT;`, `CHECK`, `EXCLUDE USING gist`, grants and default privileges, extensions |

### Roles, extensions and privileges

- Cluster-level roles are created outside migrations, the same way everywhere: `infra/local/postgres/init/01-cluster.sh` locally, the Testcontainers global setup in tests, `medibooker-db cluster bootstrap` in production (OPS01). They are `platform_owner`, `platform_app` and `medibooker_provisioner` (`CREATEDB`, `CREATEROLE`, `createrole_self_grant = 'set'`). Per-practice roles are created by provisioning; there is no group role for practices.
- The first platform migration runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_app` (and usage on sequences), then `REVOKE INSERT, UPDATE, DELETE ON practices, database_clusters FROM platform_app`. Column grants follow with their columns: `GRANT UPDATE (name, published_at, updated_at) ON practices TO platform_app` (P01) and `GRANT INSERT (id, market, name) ON practices TO platform_app` (A04).
- The first practice migration grants to the database's own app role, read from `medibooker.app_role`, and makes `practice_identity` read-only for it. The SQL is static and identical in every database; where the setting is unset (shadow and template databases) the grants are skipped:

  ```sql
  BEGIN;
  SET LOCAL lock_timeout = '3s';
  SET LOCAL statement_timeout = '60s';

  CREATE FUNCTION app_role() RETURNS name LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('medibooker.app_role', true), '')::name $$;

  DO $$ BEGIN
    IF app_role() IS NOT NULL THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', app_role());
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role());
    END IF;
  END $$;

  CREATE TABLE practice_identity ( … );

  DO $$ BEGIN
    IF app_role() IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON practice_identity FROM %I', app_role());
    END IF;
  END $$;
  COMMIT;
  ```

- Later privilege changes use the same `app_role()` block: append-only tables (`audit_events` in A01, clinical note versions in R01) revoke `UPDATE` and `DELETE`; `platform_audit_events` revokes them from `platform_app`. `scripts/check-migrations.ts` rejects a grant or revoke in a practice migration that names a role literally.
- `CREATE EXTENSION IF NOT EXISTS btree_gist` arrives in the practice migration of P01, `citext` in the platform migration of A01. Both are trusted extensions, so the database owner creates them without superuser rights.

### Authoring migrations

- `pnpm --filter @medibooker/api db:migrate:dev:practice -- --name <name>` runs `prisma migrate dev --create-only` against the local authoring database `practice_authoring` and the shadow database, which `migrate dev` creates itself (locally both URLs use the cluster superuser from the root `.env`); `db:migrate:dev:platform` does the same for the platform schema. After review and the hand-written parts, `pnpm db:migrate` applies the migration to the platform database or to every local practice database through the runner.
- Reviewed SQL only; `prisma db push` is never used.
- From F04, `pnpm check:migrations` (`scripts/check-migrations.ts`, in `verify` and the CI `quality` job) checks every `migration.sql` in both folders: the header `BEGIN;` with both `SET LOCAL` timeouts and the final `COMMIT;`, `-- contract` on every `DROP`, `RENAME` and type change, no `CONCURRENTLY` and no larger timeout without an `-- exception: <reason>` comment, and no literal role names in practice grants. Unit tests cover each rule. The release rules are in ADR 0005 §6.
- Drift check from F04: `test/integration/migrations.int-spec.ts` spawns `process.execPath` with the resolved `prisma/build/index.js` and runs `migrate diff --from-config-datasource --to-schema <schema> --exit-code` with each config against its own copy of the migrated template (`platform_drift`, `practice_drift`; §12), while the container is still running (exit code 2 = drift).

### Seed

Deterministic, synthetic, fixed UUIDs, idempotent (upserts):

| Practice | Id | Zone | Market | Notes |
|---|---|---|---|---|
| `al-noor` (مركز النور الطبي) | `00000000-0000-4000-8000-000000000001` | `Asia/Riyadh` (no DST) | `SA` | Week starts Sunday, Friday/Saturday weekend, 2026-11-19 closed, Western digits |
| `lindenhof` | `00000000-0000-4000-8000-000000000002` | `Europe/Berlin` (DST) | `DE` | Default locale `en` |

The seed provisions both practices through `provisionPractice()` as `medibooker_provisioner`, registers their slugs and names in the platform database, then writes synthetic data with the practice clients. From P01 it fills every practice table in both databases, so cross-practice HTTP tests always have real ids on both sides.

## 10. Health

```ts
@ApiExcludeController() // X02
@SkipThrottle() // a rate limit must never fail a liveness probe
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Public() // infrastructure probe: no data, not in the contract
  @Get('live')
  live(): { status: 'ok' } { return { status: 'ok' }; }

  @Public() // infrastructure probe (F04): platform database reachable and current, MARKETS set, not draining
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    await this.readiness.assertReady(); // throws SERVICE_UNAVAILABLE (503)
    return { status: 'ok' };
  }
}
```

- `GET /health/live` answers 200 without touching any database.
- `GET /health/ready` answers 200 when `SELECT 1` on the platform database returns within one second, the platform schema has reached `PLATFORM_SCHEMA_REQUIRED`, `MARKETS` is set (staging and production) and the app is not shutting down; otherwise 503 `SERVICE_UNAVAILABLE`.
- Practice databases are not part of readiness. An unavailable practice, and a practice whose market is not in `MARKETS`, answer their own requests with 503, count in a per-practice metric and raise an alert, but never take the API out of rotation.
- Both probes are served without `/api` and without a version, are not in OpenAPI, are not routed by the proxy and are not logged.
- `HealthController` carries `@SkipThrottle()`: a failed liveness probe restarts the container, so a rate limit must never fail it. Because the proxy does not route the probes, skipping the throttler opens nothing to the internet.

## 11. OpenAPI generation (X02)

- `src/openapi/document.ts`: `new DocumentBuilder().setOpenAPIVersion('3.1.0').setTitle('MediBooker API').setVersion('1')`, `operationIdFactory: (_controller, method) => method`, tags = module names. Post-processing adds `ProblemDetails` responses for 400, 429 and 500 to every operation and 401 and 403 to every non-public one; practice-scoped operations also document 503. Security schemes arrive with A01.
- `src/openapi/generate.ts` builds the app from `AppModule.forRoot(PLACEHOLDER_ENV)` with `APP_OPTIONS`; both Prisma clients connect lazily, so no database is touched. It deep-sorts object keys (not arrays) and writes `apps/api/openapi.json` with two-space indentation, LF and a final newline. Two runs are byte-identical.
- Swagger UI at `/api/docs` only when `OPENAPI_UI_ENABLED` is true, never in production.
- Architecture tests in the unit project (from X02): every route has a response type or is 204; `@Public()`, `@PublicCache()` and `@PracticeScoped()` appear only where §4 and §5 allow, checked on the metadata of every mapped route at runtime (`DiscoveryService`; for `@Public()` through `isPublicHandler`), not on the source text; operationIds are unique; every operation is registered for the authorization and cross-practice matrix ([06](06-testing.md)).

## 12. Testing specifics

The test strategy is in [06](06-testing.md). API specifics:

- Vitest 5 with `unplugin-swc` configured from the parsed `.swcrc` (`swc.vite({ tsconfigFile: false, …swcrc })`).
- Projects: `unit` (`src/**/*.spec.ts`, `test/e2e/**/*.e2e-spec.ts`, no database) and, from F04, `integration` (`test/integration/**/*.int-spec.ts`); F03 has only the `unit` project. From F04 the test tsconfig sets `allowImportingTsExtensions` (it is `noEmit`), because the harness imports `@medibooker/db-migrate/testing` source.
- `createTestApp({ env, imports, logDestination })` is the F03 shape; `clock` arrives with P02 and provider overrides with their first use. It builds `AppModule.forRoot(parseEnv({ ...TEST_ENV, ...env }), { logDestination })` with `APP_OPTIONS`, together with the test-only modules in `imports` (from `test/support`, for example the `/api/v1/probe/*` routes, which never exist in `src`), then applies `configureApp` and calls `init()`. The default log destination discards; a test that asserts on logs passes its own. nestjs-pino keeps one logger per test file, so the log options (`LOG_LEVEL`, `LOG_PRETTY`) of a file's first app hold for the whole file: `createTestApp` refuses a later app that asks for others, and every app's lines reach the newest app's destination.
- `TEST_ENV` raises the rate limit to 100000 (P02 adds the public one), a value that staging and production reject (§7); throttling tests build their own app with a limit of 3. It has no database variables until F04, which adds `PLATFORM_DATABASE_URL=postgresql://test:test@127.0.0.1:9/none` (connection always refused) and `SECRET_STORE=dev` with a synthetic seed.
- A test that needs a process of its own (F03: the process handlers, `src/common/logging/process-handlers.spec.ts`, and the entry point, `src/main.spec.ts`) runs a TypeScript file in a child process: `node --import <file URL of test/support/ts-source-hooks.ts> <file>.ts`. The hook compiles every source of the API with SWC and the API's `.swcrc`, as `nest build` does, so decorators work and `src/main.ts` itself can run, and it resolves the sources' relative `.js` imports to their `.ts` files, so no build is needed. The child gets the parent's environment without the debug switches of Node, the `debug` package and Nest and without `NODE_EXTRA_CA_CERTS` (`test/support/child-env.ts`), the settings of a developer's shell known to add output.
- The smoke spec `src/app.module.spec.ts` compiles `AppModule.forRoot(parseEnv(TEST_ENV))` and resolves `AuthenticationGuard`. It also checks that SWC records the `PinoLogger` parameter type of `UnknownExceptionFilter`, by which Nest injects the logger, so a decorator-metadata regression fails at once.
- The route inventory test `src/common/security/public-routes.spec.ts` compiles the same module with `DiscoveryModule` and asserts the exact list of public routes (§4).
- Integration global setup:
  - Testcontainers with `postgres:18.6-trixie@sha256:…` (one Renovate-annotated constant), `max_connections=300`, the server log settings of ADR 0005 §4.10 plus `log_statement=all` (so the log checks see every statement), and, because the data is disposable, `fsync=off`, `synchronous_commit=off`, `full_page_writes=off` and the data directory on tmpfs;
  - the cluster roles exactly as `01-cluster.sh` creates them;
  - `platform_template` and `practice_template`, created with the builtin `C.UTF-8` locale and migrated with `migrate deploy` by their owners; then the copies `platform_drift` and `practice_drift` for the drift spec; then `ALTER DATABASE … WITH IS_TEMPLATE true ALLOW_CONNECTIONS false` on both templates, because PostgreSQL refuses to copy a database while any session is connected to it.
- Each test file gets a platform database and two practice databases copied from the templates through `createPracticeDatabase()`, with fresh practice ids, their roles, grants and registry rows; `test/support/practices.ts` exposes them as `practiceA` and `practiceB`, and the teardown calls `dropPractice`. Test files run in parallel.
- `test/integration/tenancy/` runs provisioning, the migration runner, restore and TLS on the full path, as `medibooker_provisioner` and never as the superuser ([06 §4](06-testing.md#4-authorization-and-tenant-isolation)).
