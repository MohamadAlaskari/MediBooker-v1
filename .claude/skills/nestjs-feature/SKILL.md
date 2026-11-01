---
name: nestjs-feature
description: Recipe and conventions for building or changing a feature in the MediBooker v2 NestJS API (apps/api) — module layout, controllers vs services, DTO validation, guards and ownership checks, Prisma transactions and constraints, problem+json errors, OpenAPI decorators, domain and realtime events, configuration, logging, and the required tests. Use for any backend endpoint, module, background job or websocket gateway work.
---

# NestJS feature recipe

Stack defaults come from CLAUDE.md (NestJS, Prisma, PostgreSQL; check the status column). Use current stable versions and official NestJS packages before third-party ones.

## Layout

```
apps/api/
  prisma/schema.prisma, prisma/migrations/, prisma/seed.ts
  src/
    main.ts                  helmet, CORS allowlist, global ValidationPipe, /api/v1, OpenAPI outside production
    app.module.ts
    config/                  env schema (zod), typed config service
    common/
      auth/                  JwtAuthGuard (global), RolesGuard, @Public(), @Roles(), @CurrentUser()
      errors/                DomainException + ProblemDetailsFilter (RFC 9457)
      prisma/                PrismaService, transaction helper, P2002/P2025 mapping
      logging/               pino with redaction, request id
      audit/                 AuditService.record(...)
      clock/                 Clock interface (injectable "now" for tests)
    modules/<feature>/
      <feature>.module.ts
      <feature>.controller.ts    HTTP only: routes, guards, DTO in and out, no business logic
      <feature>.service.ts       business rules (BR-xx), ownership checks, transactions, events
      <feature>.repository.ts    optional, for complex queries
      dto/                       create-*.dto.ts, update-*.dto.ts, *-query.dto.ts, *.response.dto.ts
      <feature>.events.ts        event names and payload types
      <feature>.service.spec.ts
  test/<feature>.e2e-spec.ts
```

Initial modules: `auth`, `users`, `patients`, `family` (links, invitations, guardian declarations), `staff`, `services`, `availability` (rules, exceptions, slot generation), `slots`, `appointments`, `clinical-notes`, `attachments` (pre-signed upload, scan worker, image re-encoding, signed downloads), `records` (patient record read model), `notifications`, `realtime`, `settings`, `audit`.

## Rules

1. **Secure by default.** `JwtAuthGuard` and `RolesGuard` are global. `@Public()` only for register, login, refresh, e-mail verification, password reset, health check, and the public service list and availability if the client wants anonymous browsing. Every `@Public()` gets a comment explaining why.
2. **Authorization in two layers.** `@Roles(Role.STAFF, Role.DOCTOR, Role.ADMIN)` on the route; ownership or scope in the service (`assertOwnsAppointment(user, appointment)`). Identity comes only from `@CurrentUser()`. Another user's resource → `NotFoundException`.
3. **DTOs.** Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Every input field has validators and a maximum length. Map DTO to Prisma data explicitly; never spread a request body. Return response DTOs (or Prisma `select` with allowed fields only); never return Prisma entities.
4. **Errors.** Throw `DomainException(code, status, detail)`. The global filter renders problem+json `{ type, title, status, detail, code, errors? }`. Codes are stable and listed in `api-contract`. No stack traces, SQL or personal data in responses.
5. **Database.** Whatever the database can enforce, it must enforce: unique and partial unique indexes, foreign keys, check constraints. Multi-step writes run in `prisma.$transaction`. Map `P2002` → 409 and `P2025` → 404. Migrations are reviewed SQL; `db push` only for local prototypes. Separate database roles for migrations and runtime.
6. **Time.** Columns are `timestamptz`; the API uses ISO 8601 UTC. Convert to the practice time zone (`PracticeSettings.timezone`, IANA) only for rule evaluation and slot generation (date-fns-tz or Temporal). Respect the practice's weekend days. Inject the `Clock` so tests control "now".
6a. **Multilingual data.** Store names and free text as Unicode; never transliterate. For staff search, keep a normalized search column: Arabic without tashkeel and tatweel, unified alef/ya/ta marbuta forms; Latin lower-cased without diacritics. E-mails, push texts and reminders render in the recipient's `locale`.
7. **Events.** After a successful commit, emit a domain event (`@nestjs/event-emitter`). The realtime gateway, notifications and audit subscribe. Payloads carry IDs only.
8. **Idempotency.** `POST /appointments` and reschedule accept `Idempotency-Key`. Store key, user and response for 24 h and replay the stored response for repeats.
9. **Config and logging.** Validate env at boot with zod and fail fast. Log with pino and redact `authorization`, `cookie`, `password`, `token`, `insuranceNumber`, `patientNote`, names and e-mail addresses. Never log request bodies of auth or patient routes.
10. **Rate limiting.** `@nestjs/throttler` globally, with tighter limits on auth, booking and search.
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
