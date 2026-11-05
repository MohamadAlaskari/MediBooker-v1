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
    app.setup.ts             APP_OPTIONS, configureApp(app, env)
    app.module.ts            AppModule.forRoot(env)
    config/                  env.schema.ts (zod, parseEnv), load-env.ts
    common/
      context/               RequestContext (nestjs-cls): the request id is the CLS id; slots practice (F04), actor (A01)
      security/              @Public(), AuthenticationGuard (global, deny by default); A01: @CurrentUser()
      logging/               pino options, field allowlist, serializers, redaction, process handlers;
                             UnknownExceptionFilter (until X01)
      database/ · tenancy/   F04
      errors/ · validation/  X01
      http/                  JsonOnlyMiddleware (X01), NoStoreInterceptor and @PublicCache() (X02), pagination (P02)
      time/                  Clock (P02)
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

1. **Secure by default.** `AuthenticationGuard` is global and denies by default: it answers 401 until A01 verifies the access token and the session. `@Public()` only where 02 §4 allows it (`/api/v1/public/**`, including provider callbacks, `/health/**`, and the auth routes from A01), per handler (never on a controller class; the guard reads only the handler), each with a comment giving the reason. The marker lives in a set private to `public.decorator.ts`, so only `@Public()` sets it and copied metadata never does; never wrap it in another decorator, and keep it the outermost (topmost) decorator of the handler, because a decorator above it that replaces the method closes the route. A new public route also changes the expected list of `common/security/public-routes.spec.ts`, and that list is what the review checks.
2. **Authorization in two layers.** `@Roles(Role.STAFF, Role.DOCTOR, Role.ADMIN)` on the route; ownership or scope in the service (`assertOwnsAppointment(user, appointment)`). Identity comes only from `@CurrentUser()`. Another user's resource → `NotFoundException`.
3. **DTOs.** Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Every input field has validators and a maximum length. Map DTO to Prisma data explicitly; never spread a request body. Return response DTOs (or Prisma `select` with allowed fields only); never return Prisma entities.
4. **Errors.** Throw `DomainException(code, status, detail)`. The global filter renders problem+json `{ type, title, status, detail, code, errors? }`. Codes are stable and listed in `api-contract`. No stack traces, SQL or personal data in responses.
5. **Database.** Whatever the database can enforce, it must enforce: unique and partial unique indexes, foreign keys, check constraints. Multi-step writes run in `prisma.$transaction`. Map `P2002` → 409 and `P2025` → 404. Migrations are reviewed SQL; `db push` only for local prototypes. Separate database roles for migrations and runtime.
6. **Time.** Columns are `timestamptz`; the API uses ISO 8601 UTC. Convert to the practice time zone (`PracticeSettings.timezone`, IANA) only for rule evaluation and slot generation (Temporal, 02 §4). Respect the practice's weekend days. Inject the `Clock` so tests control "now".
6a. **Multilingual data.** Store names and free text as Unicode; never transliterate. For staff search, keep a normalized search column: Arabic without tashkeel and tatweel, unified alef/ya/ta marbuta forms; Latin lower-cased without diacritics. E-mails, push texts and reminders render in the recipient's `locale`.
7. **Events.** After a successful commit, emit a domain event (`@nestjs/event-emitter`). The realtime gateway, notifications and audit subscribe. Payloads carry IDs only.
8. **Idempotency.** `POST /appointments` and reschedule accept `Idempotency-Key`. Store key, user and response for 24 h and replay the stored response for repeats.
9. **Config and logging.** `parseEnv(process.env)` runs once in `main.ts`, after `loadWorkspaceEnv()`; `AppModule.forRoot(env)` provides the result through the global `ENV` provider. No `@nestjs/config`, and nothing reads `process.env` after `main.ts`. Invalid variables are reported by key only, and the process exits with code 1. Tests pass their own env through `createTestApp`. Logging follows 02 §8. Log only allowlisted id, code and count fields, each in its form (`REVIEWED_LOG_FIELDS` in `common/logging/log-fields.ts`, today `practiceId` as a UUID and `clusterId` as a slug), besides `err` and a class-name `context`: the field allowlist drops every other field and counts it in `droppedFields`, and extending the set is a reviewed change. Create a Logger as `new Logger(<Class>.name)`, never without a context. Messages are string literals: interpolation values are dropped, so never build a message from a value (no template literal with expressions, no concatenation); and never an error message (`err.message`) or stack (`err.stack`), and never change an error's message after creating it: log `{ err }` with a constant message of your own (the `keepMessageConstant` hook and `UnknownExceptionFilter` keep pino and Nest from logging one). No `.child()`, `.setBindings()`, `.assign()`, `runInContext()` or `msgPrefix` outside `common/logging`: bindings skip the field allowlist (F04 adds `bindLogFields`). F02 adds ESLint rules for these three. Allowlist serializers with `req` = `{ id, method, route }` read at completion, `res` = `{ statusCode }`, the error serializer, redaction as a second line (child bindings), no bodies, health probes not logged; uncaught exceptions and unhandled rejections go through `registerProcessHandlers` (fatal, then exit 1). The request id is an inbound UUID `X-Request-Id` or a generated one, and it is echoed.
10. **Rate limiting.** The named throttlers of 02 §4 (`default` from F03; `public` from P02, `join` from B01, `invitation` from A04), counted per route and `req.ip`, which `trust proxy` derives from `TRUST_PROXY_HOPS`.
11. **OpenAPI.** `@ApiTags`, `@ApiOperation`, response types and error responses on every route. The spec is regenerated in CI (see `api-contract`).

## Reference: booking in one transaction (BR-01, BR-02, BR-03, BR-08)

```ts
async book(user: AuthUser, dto: BookAppointmentDto): Promise<AppointmentResponseDto> {
  const appointment = await this.prisma.$transaction(async (tx) => {
    // Serialize bookings of the same patient, so BR-02 cannot be raced
    await tx.$queryRaw`SELECT 1 FROM "PatientProfile" WHERE "userId" = ${user.id}::uuid FOR UPDATE`;
    // Lock the slot row (BR-01)
    const [slot] = await tx.$queryRaw<SlotRow[]>`
      SELECT * FROM "Slot" WHERE id = ${dto.slotId}::uuid FOR UPDATE`;
    if (!slot || slot.status !== 'OPEN') throw new SlotNotAvailableException();

    const settings = await this.settings.get(tx);
    const now = this.clock.now();
    assertWithinBookingWindow(slot.startsAt, settings, now);           // BR-03
    await this.services.assertBookable(tx, dto.serviceId, slot, user); // BR-08

    const future = await tx.appointment.count({
      where: { patientId: user.id, status: 'BOOKED', slot: { startsAt: { gt: now } } },
    });
    if (future >= settings.maxFutureAppointmentsPerPatient) {
      throw new BookingLimitReachedException();                        // BR-02
    }

    const created = await tx.appointment.create({
      data: { patientId: user.id, slotId: slot.id, serviceId: dto.serviceId, status: 'BOOKED', bookedById: user.id },
    });
    await tx.slot.update({ where: { id: slot.id }, data: { status: 'BOOKED' } });
    await this.audit.record(tx, user, 'appointment.booked', 'Appointment', created.id);
    return created;
  });

  // After commit, IDs only
  this.events.emit('appointment.booked', {
    appointmentId: appointment.id, slotId: appointment.slotId,
  });
  return toAppointmentResponse(appointment);
}
```

Last line of defence, in a migration:

```sql
CREATE UNIQUE INDEX appointment_one_active_per_slot
  ON "Appointment" ("slotId")
  WHERE status IN ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW');
```

## Required tests

- Tooling (02 §12, 06): Vitest 5 with `unplugin-swc` reading the shared `.swcrc`; `*.spec.ts` next to the code; `test/e2e/*.e2e-spec.ts` over HTTP on `createTestApp()` with supertest; `test/integration/*.int-spec.ts` from F04; `TZ=Pacific/Chatham`; coverage 80 % lines and 70 % branches, and 100 % for `*.rules.ts`.
- Unit: pure rule functions (booking window, cancellation deadline, insurance number validators per market, slot generation in a zone with DST — e.g. Europe/Berlin on 2027-03-28 and 2027-10-31 — and in a zone without DST, e.g. Asia/Riyadh, including weekend days).
- Integration against a real PostgreSQL (Testcontainers): services with transactions and constraints.
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
