---
name: nestjs-feature
description: Recipe and conventions for building or changing a feature in the MediBooker v2 NestJS API (apps/api) — module layout, controllers vs services, DTO validation, guards and ownership checks, Prisma transactions and constraints, problem+json errors, OpenAPI decorators, domain and realtime events, configuration, logging, and the required tests. Use for any backend endpoint, module, background job or websocket gateway work.
---

# NestJS feature recipe

`docs/architecture/02-api.md` is the source of truth. Where this skill and 02 differ, 02 wins until a roadmap item updates the skill; `docs/architecture/08-roadmap.md` names that item in its scope.

Stack defaults come from CLAUDE.md (NestJS, Prisma, PostgreSQL; check the status column). Use current stable versions and official NestJS packages before third-party ones.

## Layout

Abbreviated from 02 §2:

```text
apps/api/
  prisma/platform/ · prisma/practice/   two schemas, each with its migrations (F04)
  src/
    main.ts                  loadWorkspaceEnv() → parseEnv → NestFactory.create → configureApp → registerProcessHandlers → listen
                             → the platform database check (F04; no provider does I/O while the app is built)
    app.setup.ts             APP_OPTIONS, configureApp(app, env)
    app.module.ts            AppModule.forRoot(env)
    config/                  env.schema.ts (zod, parseEnv), load-env.ts
    common/
      context/               RequestContext (nestjs-cls): the request id is the CLS id; slots practice (F04), actor (A01)
      security/              @Public(), AuthenticationGuard (global, deny by default); A01: @CurrentUser()
      logging/               pino options, field allowlist, serializers, redaction, process handlers;
                             bindLogFields (F04)
      database/              F04: PlatformPrismaService, the `platform` transaction plugin,
                             Prisma error readers (isConnectionFailure), SecretStore with DevSecretStore
      tenancy/               F04: PracticeConnectionManager, @PracticeScoped(), PracticeContextInterceptor,
                             PracticeRunner (runInPractice, forEachPractice), PracticeCache, the `practice`
                             transaction adapter, the status table (practice-access.rules.ts)
      errors/                error catalogue, DomainException, ProblemDetailsFilter, validation pipe, jsonOnly (X01)
      http/                  NoStoreInterceptor (X02), @PublicCache() (P05), pagination (P03)
      time/                  Clock, SystemClock, FixedClock (F04); convert.ts, Date ⇄ Temporal (P02)
      events/                DomainEvents (P04)
    health/                  /health/live; /health/ready (F04)
    modules/<feature>/
      <feature>.module.ts
      <feature>.controller.ts    HTTP only: routes, guards, DTO in and out, no business logic
      <feature>.service.ts       business rules (BR-xx), ownership checks, transactions, events
      <feature>.reader.ts        optional, for complex read models
      <feature>.rules.ts         pure rule functions (BR-xx)
      dto/                       *.dto.ts, *.response.dto.ts
      mappers/                   explicit response objects (satisfies XResponseDto)
      <feature>.events.ts        event names and payload types
      *.spec.ts                  unit tests next to the code
    openapi/                 X02
    generated/               Prisma clients and schema versions (F04, gitignored)
  test/e2e/ · test/integration/ (F04) · test/support/
```

No repository files: services use the transaction hosts (02 §5).

Modules (02 §2): `health`, `app-config` (X02), `practices` (P01, P02), `scheduling` (P04, P05); later `auth`, `accounts`, `memberships`, `patients`, `appointments`, `notifications`, `settings`, `staff`, `family`, `clinical-notes`, `attachments`, `records`, `audit`, `realtime`, `privacy`.

## Rules

1. **Secure by default.** `AuthenticationGuard` is global and denies by default: it verifies the access token and the session row on every request and answers 401 otherwise. `@Public()` only where 02 §4 allows it (`/api/v1/public/**`, including provider callbacks, `/health/**`, and the auth routes from A01), per handler (never on a controller class; the guard reads only the handler), each with a comment giving the reason. The marker lives in a set private to `public.decorator.ts`, so only `@Public()` sets it and copied metadata never does; never wrap it in another decorator, and keep it the outermost (topmost) decorator of the handler, because a decorator above it that replaces the method closes the route. A new public route also changes the expected list of `common/security/public-routes.spec.ts`, and that list is what the review checks.
2. **Authorization in two layers.** `@PracticeScoped('id', { staff: 'team' | 'planning' | 'management' })` on the route (D17, ADR 0017: `team` every active member, `planning` the practice team and practice management, `management` practice management; `hasCapability` in `common/tenancy/staff-capability.ts`), which asks for the second factor first (`MFA_REQUIRED`): the base role and practice management come from the active membership in the resolved practice, never from the token; ownership or scope in the service (`assertOwnsAppointment(user, appointment)`). Identity comes only from `@CurrentUser()`. Another user's resource → `NotFoundException`.
3. **DTOs.** Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Every input field has validators and a maximum length. Map DTO to Prisma data explicitly; never spread a request body. Return response DTOs (or Prisma `select` with allowed fields only); never return Prisma entities.
4. **Errors.** Throw `DomainException(code, status, detail)`. The global filter renders problem+json `{ type, title, status, detail, code, errors? }`. Codes are stable and listed in `api-contract`. No stack traces, SQL or personal data in responses.
5. **Database.** Two databases, two Prisma schemas (02 §5, ADR 0005): `apps/api/prisma/platform/schema.prisma` (accounts, the practice registry, slugs, the membership index) and `apps/api/prisma/practice/schema.prisma` (everything one practice owns; no `practiceId` column, because the database is the boundary). Services reach them only through the two transaction hosts, never through the Prisma clients themselves:
   - `@InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost` for the practice of the current request or `runInPractice` call, and `@InjectTransactionHost('platform') private readonly platformTx: PlatformTransactionHost` for the platform database. Read and write with `this.txHost.tx`.
   - Multi-step writes run in one transaction: `@Transactional('practice')` on the service method, or `this.txHost.withTransaction(async () => { … })`. One transaction writes one database; an effect in the platform database goes through the integration outbox (A01) or is a second operation.
   - Practice data without a resolved practice throws `PracticeContextMissingError`: practice-scoped routes carry `@PracticeScoped(…)`, and code outside a request uses `PracticeRunner.runInPractice(practiceId, fn, { purpose })`. Cache practice data only through `PracticeCache`.
   - Whatever the database can enforce, it must enforce: unique and partial unique indexes (declared in the schema with `partialIndexes`), foreign keys, check constraints. Row locks are tagged `$queryRaw … FOR UPDATE` on `this.txHost.tx`, on the row that is contended, found by its id.
   - Map `P2002` → 409 and `P2025` → 404; a practice whose connection fails becomes 503 in the tenancy layer, not in the service.
   - Migrations are reviewed SQL, created with `pnpm --filter @medibooker/api db:migrate:dev:practice --name <name>` (or `:platform`), with the transaction header, `-- contract` on destructive steps and grants only through `app_role()`; `pnpm check:migrations` checks them (02 §9). Never `prisma db push`, not even locally. Separate database roles for migrations (the owners) and runtime (`platform_app`, each practice's app role).
6. **Time.** Columns are `timestamptz`; the API uses ISO 8601 UTC. Convert to the practice time zone (`PracticeSettings.timezone`, IANA) only for rule evaluation and slot generation (Temporal, 02 §4). Respect the practice's weekend days. Inject the `Clock` so tests control "now".
6a. **Multilingual data.** Store names and free text as Unicode; never transliterate. For staff search, keep a normalized search column: Arabic without tashkeel and tatweel, unified alef/ya/ta marbuta forms; Latin lower-cased without diacritics. E-mails, push texts and reminders render in the recipient's `locale`.
7. **Messages and events.** A message is enqueued inside the transaction of its reason (`AccountNotifications.enqueue`, from E09 on `NotificationOutbox.enqueue`), never after the commit. Domain events after the commit (`@nestjs/event-emitter`) only for realtime and best-effort reactions. Payloads carry IDs only.
8. **Idempotency.** `POST /appointments` and reschedule accept `Idempotency-Key`. Store key, user and response for 24 h and replay the stored response for repeats.
9. **Config and logging.** `parseEnv(process.env)` runs once in `main.ts`, after `loadWorkspaceEnv()`; `AppModule.forRoot(env)` provides the result through the global `ENV` provider. No `@nestjs/config`, and nothing reads `process.env` after `main.ts`. Invalid variables are reported by key only, and the process exits with code 1. Tests pass their own env through `createTestApp`. Logging follows 02 §8. Log only allowlisted id, code and count fields, each in its form (`REVIEWED_LOG_FIELDS` in `common/logging/log-fields.ts`, today `practiceId` as a UUID, `clusterId` as a slug and `reasonCode` as an UPPER_SNAKE code), besides `err` and a class-name `context`: the field allowlist drops every other field and counts it in `droppedFields`, and extending the set is a reviewed change. Create a Nest `Logger` as `new Logger(<Class>.name)`, never without a context, and log only constant messages with it. Messages are string literals: interpolation values are dropped, so never build a message from a value (no template literal with expressions, no concatenation); and never an error message (`err.message`) or stack (`err.stack`), and never change an error's message after creating it. To log an error or reviewed fields, inject nestjs-pino's `PinoLogger`, set its context in the constructor (`logger.setContext(<Class>.name)`, as `UnknownExceptionFilter` does), and log `this.logger.error({ err }, 'booking failed')` with a constant message of your own; in a request, `req.log.error({ err }, 'booking failed')` works too. Nest's `Logger` takes the message first, so `{ err }` there fails lint (the `keepMessageConstant` hook and `UnknownExceptionFilter` keep pino and Nest from logging an error's message). No `.child()`, `.setBindings()`, `.assign()`, `runInContext()` or `msgPrefix` outside `common/logging`: bindings skip the field allowlist; `bindLogFields(logger, fields)` there (F04) binds reviewed fields such as the resolved `practiceId` after the allowlist. The `nest()` preset enforces the three, tests included: `medibooker/require-logger-class-name` (`new Logger(<Class>.name)` with a class that the file declares or imports, and no static `Logger.log(...)`), `medibooker/no-dynamic-log-message` (a logger call's message is a string literal or a template literal without expressions, and no argument reads `.message` or `.stack`) and `medibooker/no-log-bindings` (bindings only under `src/common/logging`); a test that breaks one on purpose says why in `// eslint-disable-next-line medibooker/<rule> -- <reason>`. Allowlist serializers with `req` = `{ id, method, route }` read at completion, `res` = `{ statusCode }`, the error serializer, redaction as a second line (child bindings), no bodies, health probes not logged; uncaught exceptions and unhandled rejections go through `registerProcessHandlers` (fatal, then exit 1). The request id is an inbound UUID `X-Request-Id` or a generated one, and it is echoed.
10. **Rate limiting.** The named throttlers of 02 §4 (`default` from F03; `public` from P02, `join` from B01, `invitation` with the invitations of M03), counted per route and `req.ip`, which `trust proxy` derives from `TRUST_PROXY_HOPS`.
11. **OpenAPI.** `@ApiTags`, `@ApiOperation`, response types and error responses on every route. The spec is regenerated in CI (see `api-contract`).

## Reference: booking in one transaction (BR-01, BR-02, BR-03, BR-08)

The route is `@PracticeScoped(…)`, so the request context holds the practice and the lease of its client before the service runs; `this.txHost.tx` is that practice's transaction (02 §5).

```ts
@Injectable()
export class AppointmentsService {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly clock: Clock,
    private readonly patients: PatientsService,
    private readonly settings: PracticeSettingsService,
    private readonly services: ServicesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // One transaction in the database of the request's practice; its limits come from
  // DATABASE_TX_MAX_WAIT_MS and DATABASE_TX_TIMEOUT_MS. A transaction of one account that waits
  // for row locks runs through AccountTransactions instead: it keeps that account to a share of
  // the practice's connections and limits the wait for a lock (B02).
  @Transactional('practice')
  async book(actor: Actor, dto: BookAppointmentDto): Promise<AppointmentResponseDto> {
    const tx = this.txHost.tx;
    // The actor may book for this patient (own SELF profile or an ACTIVE family link, BR-19);
    // any other patient id answers 404.
    const patientId = await this.patients.assertBookableBy(actor, dto.patientId);
    // Serialize bookings of the same patient, so BR-02 cannot be raced: lock that patient's row
    // by its id, never rows of a shared table filtered by a user id.
    await tx.$queryRaw`SELECT 1 FROM patients WHERE id = ${patientId}::uuid FOR UPDATE`;
    // Lock the slot row (BR-01)
    const [slot] = await tx.$queryRaw<SlotRow[]>`
      SELECT id, status, starts_at AS "startsAt" FROM slots WHERE id = ${dto.slotId}::uuid FOR UPDATE`;
    if (!slot || slot.status !== 'OPEN') throw new SlotNotAvailableException();

    const settings = await this.settings.get();
    const now = this.clock.now();
    assertWithinBookingWindow(slot.startsAt, settings, now);            // BR-03
    await this.services.assertBookable(dto.serviceId, slot, patientId); // BR-08

    const future = await tx.appointment.count({
      // toDate: common/time/convert.ts (P02), the only Temporal ⇄ Date conversion
      where: { patientId, status: 'BOOKED', slot: { startsAt: { gt: toDate(now) } } },
    });
    if (future >= settings.maxFutureAppointmentsPerPatient) {
      throw new BookingLimitReachedException();                         // BR-02
    }

    const created = await tx.appointment.create({
      data: { patientId, slotId: slot.id, serviceId: dto.serviceId, status: 'BOOKED', bookedById: actor.userId },
    });
    await tx.slot.update({ where: { id: slot.id }, data: { status: 'BOOKED' } });
    await this.audit.record(actor, 'appointment.booked', 'Appointment', created.id);
    // Queued now; emitted by the transaction owner after commit, dropped on rollback; IDs only
    this.events.emitAfterCommit({ name: 'appointment.booked', appointmentId: created.id, slotId: slot.id });
    return toAppointmentResponse(created);
  }
}
```

Last line of defence: the partial unique index, declared in `prisma/practice/schema.prisma` with `@@unique([slotId], …, where: raw(…))` (`partialIndexes`; the predicate exactly as `prisma db pull` prints it, 02 §9), so the migration creates:

```sql
CREATE UNIQUE INDEX appointments_one_active_per_slot
  ON appointments (slot_id)
  WHERE status IN ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW');
```

## Required tests

- Tooling (02 §12, 06): Vitest 5 with `unplugin-swc` reading the shared `.swcrc`; `*.spec.ts` next to the code; `test/e2e/*.e2e-spec.ts` over HTTP on `createTestApp({ env, imports, logDestination, clock, overrides })` with supertest, without a database (`TEST_ENV`'s platform URL refuses every connection); `TZ=Pacific/Chatham`; coverage 80 % lines and 70 % branches, and 100 % for `*.rules.ts`. Time-dependent code gets a `FixedClock` through `clock` and steps it; never a sleep.
- Unit: pure rule functions (booking window, cancellation deadline, insurance number validators per market, slot generation in a zone with DST — e.g. Europe/Berlin on 2027-03-28 and 2027-10-31 — and in a zone without DST, e.g. Asia/Riyadh, including weekend days).
- Integration against a real PostgreSQL (from F04): `test/integration/**/*.int-spec.ts`, run by `pnpm test:integration` (Docker Desktop locally, the CI job `integration`). The Testcontainers global setup prepares the cluster with `01-cluster.sh` and migrated templates; each test file gets its own platform database and two practice databases, `practiceA` and `practiceB` from `test/support/practices.ts`, so services with transactions, constraints and row locks run against real PostgreSQL, and a practice-scoped feature proves that A's request never reads B's rows (06 §4). Run it before a commit that changes database code.
- E2E (supertest) per endpoint: 401 without token, 403 wrong role, 404 another user's resource, 400 invalid input, 200/201 happy path, 409 conflict where relevant.
- Concurrency: 10 parallel bookings of one slot → exactly one 201 and nine 409. One patient at the limit booking two slots in parallel → only one succeeds.
- Test names cite rule IDs: `it('BR-04 rejects patient cancellation 23 h before start')`.

## Checklist before handoff

- [ ] Guards, roles and ownership on every new route; every `@Public()` justified
- [ ] DTO validation and explicit response DTOs; no entity leaks, no mass assignment
- [ ] Invariants enforced in the database; transactions for multi-step writes; idempotency where clients retry
- [ ] Domain errors with stable codes; OpenAPI updated; client regenerated
- [ ] Events emitted after commit with IDs only; audit events written
- [ ] No personal data in logs; config validated
- [ ] Lint, typecheck, unit, integration and e2e tests green (commands and results in the handoff)
