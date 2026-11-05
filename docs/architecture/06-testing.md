# Testing

Tests prove the business rules (BR-xx), the security baseline and the isolation between practices, each of which has its own database ([ADR 0005](../adr/0005-multi-tenancy.md)). This document sets the strategy for every layer; the app documents add tool configuration ([02 §12](02-api.md#12-testing-specifics), [03 §14](03-web.md#14-testing), [04 §12](04-mobile.md#12-testing)).

## 1. Test pyramid

| Layer | Tool | What | Where | Without Docker | CI job |
|---|---|---|---|---|---|
| Root scripts | Vitest 5 | commit-message rules, hook wiring, gitleaks outcome mapping, the gitleaks rule against the real binary (F01); the migration lint (F04) | `scripts/**/*.test.ts` | yes (gitleaks binary for the rule cases) | `quality` |
| Packages | Vitest 5 | eslint guardrails and presets, tsconfig fixtures; fetcher and errors, retry table; catalogue checks and render-all; token contrast | `packages/*/test`, `*.test.ts` | yes | `quality` |
| API unit | Vitest + unplugin-swc | `*.rules.ts` (BR ids, DST), filter mapping, validation factory, env schema, mappers, connection-manager bookkeeping and budgets with fakes, SCRAM verifiers, architecture tests | `src/**/*.spec.ts` | yes | `quality` |
| API HTTP | Vitest + supertest on `createTestApp()` | problem+json, deny-by-default, headers, request id, CORS, throttling, cache headers | `test/e2e/*.e2e-spec.ts` | yes | `quality` |
| API integration | Testcontainers, `postgres:18.6-trixie` | both migration sets and their drift, provisioning, credentials and both barriers between practices, TLS, the connection manager under concurrency, the status table, the migration runner and its recovery, constraints (CHECK, EXCLUDE, partial unique), transactions and outboxes, the integration relay, concurrency, the authorization and cross-practice matrix; the server log | `apps/api/test/integration/**/*.int-spec.ts` | Docker | `integration` |
| Web components | Vitest + jsdom + Testing Library + MSW | shadcn kit, features, forms with server field errors, error states, RTL | `src/**/*.test.tsx` | yes | `quality` |
| Web e2e and a11y | Playwright + axe | `ar-rtl` and `en-ltr` at 1440 and 390 px, `webkit-ar-rtl` for the public page; no cookies or third parties on public pages; CSP | `apps/web/e2e/*.spec.ts` | browsers; Docker from P03 | `e2e-web` |
| Shipped images | Playwright `@smoke` + axe against the compose `app` stack | the images that get published, behind the proxy, with the migrate image's runner on a seeded database | `apps/web/e2e/*.spec.ts` | Docker | `images` |
| Mobile | jest-expo + React Native Testing Library | providers (direction, version gate, offline), practice switch, UI kit, screens, accessibility props | `src/**/*.test.tsx` | yes | `quality` |
| Mobile build | `expo export`, `expo install --check`, `expo-doctor` | Metro resolution, SDK alignment, one React copy | — | yes | `quality` |
| Mobile device | Maestro on an Android emulator | Hermes Intl, RTL, offline | `apps/mobile/.maestro/` | emulator | `mobile-device` (X10, nightly) |
| Mobile release | Maestro on EAS preview builds | register → verify → book → cancel in ar and en | `apps/mobile/.maestro/` | — | from REL01 |
| Contract | `pnpm check:drift` | `openapi.json`, client, tokens, catalogue, CSP hashes are fresh | — | yes | `quality` |

## 2. Names and structure

- Test names cite BR ids and roles: `it('BR-04 rejects patient cancellation 23 h before start')`. Tenancy tests cite the ADR: `it('ADR-0005 §11.5 A app role cannot connect to B')`.
- File names: API `*.spec.ts`, `*.e2e-spec.ts`, `*.int-spec.ts`; web, mobile, packages and root scripts `*.test.ts(x)`; Playwright `e2e/*.spec.ts`; Maestro `.maestro/*.yaml`.
- UI tests query by role and label, never by CSS selector.

## 3. Determinism

### Time

- No sleeps. API tests use `FixedClock` or Vitest fake timers (Vitest 5 also fakes `Temporal`); Playwright uses `page.clock`. Caches and evictions with a lifetime (`PUBLIC_ROUTE_CACHE_MS`, `evictIdle()`) read the `Clock`, so their tests step time and call them directly instead of waiting.
- Waiting is tested with fake timers, never with the `FixedClock`: a fan-out branch whose reader never resolves times out after `vi.advanceTimersByTimeAsync(ME_FANOUT_TIMEOUT_MS)`. An outage is tested separately, with a practice routed to a closed port, which fails at once.
- Every Vitest config sets `test.env: { TZ: 'Pacific/Chatham' }` and Jest's `globalSetup` sets the same zone. Chatham is UTC+12:45 with DST, so the local date differs from the UTC date for half of every day: code that uses the host's zone fails on every machine. A guard spec per test setup fails when the zone is missing or misspelled (the API's `src/test-environment.spec.ts`, F03), because until time code exists no other test would notice.
- Playwright projects pin `timezoneId` and `locale` (`ar-SA`/`Asia/Riyadh`, `en-GB`/`Europe/Berlin`).
- In e2e runs the API starts with `CLOCK_FIXED_AT=2026-11-16T05:00:00Z` (Monday 08:00 in Riyadh) and every test calls `page.clock.setFixedTime(new Date('2026-11-16T05:00:00Z'))`. The e2e seed creates slots relative to that instant, so seed dates never expire. Polling tests use `page.clock.fastForward('00:46')`.
- The Next server never reads the real date while rendering (lint on `src/app/**`); time-derived fields such as `openNow`, `nextChangeAt` and the practice-local "today" come from the API.

### BR-15 fixtures

Verified with Node 26.13.0 `Temporal` and tz 2026e:

| Fixture | Expectation |
|---|---|
| Weekly rule Monday 08:00 `Europe/Berlin` | 2027-03-22T07:00Z, 2027-03-29T06:00Z; 2027-10-25T06:00Z, 2027-11-01T07:00Z |
| Sunday rule 01:00–04:00 on 2027-03-28 (Berlin spring change) | no 02:xx slot; 03:00 local = 01:00Z |
| Sunday 2027-10-31 (Berlin autumn change) | no duplicate 02:xx slot; ambiguous times use the earlier instant |
| BR-04 deadline as 24 elapsed hours, appointment 2027-03-28 10:00 Berlin (08:00Z) | cancellation allowed at 2027-03-27T07:59Z, rejected at 08:01Z |
| BR-03 lead time of 2 h at 2027-03-27T23:30Z | the 03:00 CEST slot (01:00Z) is not bookable, 03:30 (01:30Z) is |
| `Asia/Riyadh`, Friday/Saturday weekend | no Friday or Saturday slots; 2026-11-19 (Thursday) closed |
| `Africa/Cairo` 2027-04-30 (Friday) | local midnight does not exist; the day is [2027-04-29T22:00Z, 2027-04-30T21:00Z), 23 hours |
| `Africa/Cairo` 2027-10-28 | a 25-hour day |
| Every deadline and window | ± 1 minute around the boundary |

The Cairo fixture uses a Friday/Saturday weekend and Arabic-Indic digits. Elapsed-duration rules (BR-03, BR-04, BR-13) and wall-clock rules (availability, opening hours) are defined in ADR 0014 (P04).

### Environment and network

- `createTestApp` passes an explicit environment (a platform database port that refuses connections, the development secret store with a synthetic seed, high rate limits); tests never read the ambient environment.
- The Testcontainers image is pinned by digest in one Renovate-annotated constant. Jobs that pull images log in to Docker Hub with a read-only token when one is configured (U6).
- Required jobs make no calls to services unrelated to the code: the `expo-doctor` directory check runs only in the weekly workflow.

### Databases in tests

- **Templates:** the integration global setup migrates `platform_template` and `practice_template`, copies them to `platform_drift` and `practice_drift` for the drift spec, and then marks both templates `IS_TEMPLATE true` and `ALLOW_CONNECTIONS false`. PostgreSQL refuses to copy a database while any session is connected to it, so nothing may connect to a template once copies start.
- **Per test file:** a platform database and two practice databases copied through `createPracticeDatabase()` (the same ACL and `medibooker.app_role` step as production), with fresh practice ids, their roles, grants and registry rows (`test/support/practices.ts` exposes `practiceA` and `practiceB`); files run in parallel and never share a database. The seed of both practices covers every practice table from P01 on, so cross-practice tests always have real resource ids on both sides.
- **Teardown:** `dropPractice()` sets the status `DEPROVISIONING`, so a running API stops using its cached client, then runs `DROP DATABASE … WITH (FORCE)` and drops both roles and the registry rows.
- **Durability:** the test cluster runs with `fsync=off`, `synchronous_commit=off`, `full_page_writes=off` and its data directory on tmpfs; its data is disposable.
- **Server log:** the test cluster runs with the production log settings (ADR 0005 §4.10) plus `log_statement=all`; the log checks of F04 read the container log.

### Data

- Synthetic data only: faker 10.6 with a fixed seed and the `ar` and `en` locales ("Sara Ahmed" / "سارة أحمد"), seeds with fixed UUIDs.
- Web component tests: `faker.seed(20261101)` and `faker.setDefaultRefDate('2026-11-16T05:00:00Z')` before each test, MSW with `onUnhandledRequest: 'error'`, and every field a test asserts on is set through the generated `get…ResponseMock({ … })` overrides.
- Web e2e: the seeded practices `al-noor` and `lindenhof` are read-only. A test that changes data provisions its own practice through `apps/web/e2e/support/fixtures.ts`: `createPractice({ slug: 'e2e-' + shortHash(testInfo.testId + testInfo.project.name) })` calls `provisionPractice({ fromTemplate: true })` from `@medibooker/db-migrate/testing`, writes its data with `seedPracticeFixture(practice, data)` (no raw SQL in the web tests), and the teardown calls `dropPractice`. The fixtures read `DEV_SECRET_SEED`, `SECRET_STORE`, `APP_ENV` and the database URLs from the root `.env` through `loadWorkspaceEnv()`, the same file the API under test reads, so Turborepo's strict environment mode needs no pass-through beyond `E2E_*`. A stale template is refused with "run pnpm db:seed". From A05 every authenticated test creates its own accounts the same way. `test.describe.configure({ mode: 'serial' })` is used only inside one flow.

## 4. Authorization and tenant isolation

### Registries

- `apps/api/test/integration/authz/matrix.ts` exports three registries:
  - `AUTHZ_MATRIX`: per operationId the expected status for an anonymous caller (401), per role (`PATIENT`, `STAFF`, `DOCTOR`, `ADMIN`), and for another owner (404);
  - `PUBLIC_OPERATIONS`: operationId → the reason it is public (provider callbacks included);
  - `CROSS_PRACTICE`: the operationIds of every practice-scoped operation.
- `authz-matrix.int-spec.ts` runs every entry through `expectAuthMatrix`. For `CROSS_PRACTICE` it tests both directions: a caller of practice A on B's path (404, and no client for B is opened), and a resource id of B under A's path (404, because the row does not exist in A's database).
- A unit-project architecture test reads the operationIds from the committed `openapi.json` and fails unless every operation is in exactly one of `AUTHZ_MATRIX` and `PUBLIC_OPERATIONS`, and every practice-scoped one is also in `CROSS_PRACTICE`. A new endpoint without entries fails `pnpm test`, without Docker.
- Phases: X02 creates the registries and the architecture test (`getAppConfig` in `PUBLIC_OPERATIONS`); P02 adds `CROSS_PRACTICE`; A01 adds `AUTHZ_MATRIX` and `expectAuthMatrix`.

### Isolation specs (ADR 0005 §11)

`apps/api/test/integration/tenancy/`, on every push:

| Spec | Since | Proves |
|---|---|---|
| `provisioning.int-spec.ts` | F04 | the full provisioning path as `medibooker_provisioner` on a cluster prepared only like `01-cluster.sh`; a rerun changes nothing; a run stopped after the role step completes on the next run; the registry entry ends `ACTIVE` with the current `schema_version`; the database has the builtin `C.UTF-8` locale; every lifecycle command writes `platform_audit_events` before and after |
| `credentials.int-spec.ts` | F04 | A's app role gets `permission denied for database` on B's database, on a copy of B and on `medibooker_platform`; with B's `CONNECT` opened to `PUBLIC` by the test, A's role connects but reads no table of B (`permission denied for table`); A's role has DML and no DDL in its own database and cannot change `practice_identity`; `datacl` equals the owner plus the app role; `rolconnlimit` and the role settings are set; `platform_app` gets `permission denied` when it changes `cluster_id`, `database_name`, a secret reference, `route_version` or `status`, or any `database_clusters` row; the server log holds no generated password |
| `tls.int-spec.ts` | F04 | against its own container with `ssl=on` and a CA and server certificate generated at test time: a practice client with the right CA connects with `verify-full`; with a wrong CA it fails with `PracticeUnavailableError` (503) and the server log shows no authentication attempt for the role; the runner's Prisma URL with a wrong CA fails too |
| `connection-manager.int-spec.ts` | F04 | 200 interleaved concurrent requests over A and B each read only their own `practice_identity`; concurrent first use of a practice creates one client; LRU eviction; `evictIdle()` after stepping the `FixedClock`; a client in use is never closed; an identity mismatch and an open `CONNECT` are refused with 503; with `PRACTICE_CLIENTS_MAX=2`, public and job acquisitions never evict a client a signed-in request used within `PRACTICE_CLIENT_IDLE_MS`; the creation rate cap; with `CONNECT` revoked a cached client yields 503, never data |
| `status.int-spec.ts` | F04 | every status of ADR 0005 §5 gives its answer on the test-only route and in `runInPractice`, also through a client cached before the change; a practice whose market is outside `MARKETS` answers 503 under `APP_ENV=staging` while `/health/ready` stays 200 |
| `context.int-spec.ts` | F04 | practice data access without a resolved practice throws; `runInPractice` and `forEachPractice` run each practice in its own context and isolate a failure; a job run for A never touches B; `PracticeCache` keys differ for A and B under concurrent reads |
| `migration-runner.int-spec.ts` | F04 | with a fixture migration both practices end at the same `schema_version`; a fixture that fails in B leaves A migrated and B on its previous version and the runner exits 1; after the fixture is fixed, the next `migrate practices` resolves B's failed entry and completes B without a manual step; a migration that waits for a lock held by a test transaction fails with `lock_not_available`, is retried and succeeds once the lock is released; a practice behind `PRACTICE_SCHEMA_REQUIRED` answers 503 |
| `resolution.int-spec.ts` | P02, A01, A04 | A's slug never returns B's data; unknown, unpublished and offboarded slugs answer 404 without a client; B cannot claim A's retired slug; an `X-Practice-Id` header and a `practiceId` query parameter are ignored, a `practiceId` body field is rejected; a missing index row denies, a stale one is overruled by the practice database; an expired support membership counts as absent; every invitation failure is the same 404 without a client |
| `fanout.int-spec.ts` | B03, FA01 | concurrent branches of one fan-out each return items whose `practiceId` matches the `practice_identity` their branch read; a practice that is not `ACTIVE` or is behind the schema appears only in `unavailablePractices`; from FA01, a family link revoked in B while the index row is still active removes B's managed-patient items |
| `deprovisioning.int-spec.ts` | OPS02 | once B is deprovisioned, signed-in requests get 404 at once, public ones after `PUBLIC_ROUTE_CACHE_MS`, and a client cached before returns 503, never data; `--finalize` leaves no database, role, key, object version or index row of B |
| `restore.int-spec.ts` | OPS02 | a backup of A restored as a new database has equal row counts and per-table checksums; B's app role gets `permission denied for database` on it, routed and with `--inspect`; a membership removed, a family link revoked and a consent withdrawn after the backup point stay removed, revoked and withdrawn; a membership added after the restore works on the next request; the practice is in `RESTORE_REVIEW` until resumed; B is untouched |
| `move.int-spec.ts` | OPS02 | a write attempted during the move fails with 503 and is never lost; the moved database has the same identity, checksums, ACL and locale provider; the old database refuses the app role |
| `rotation.int-spec.ts` | OPS02 | after `rotate-credentials` the old password is refused, requests keep answering 200 and a request in flight completes |

Architecture tests in the unit project add static guards: the practice Prisma schema declares no `practiceId` field (P01); the platform schema has health fields only in the allowlisted tables (A01); the `invitation` mode appears only on `-invitations/accept` routes (A04).

## 5. Concurrency and idempotency (B02, B03)

Against real PostgreSQL only, never PGlite. `test/integration/appointments/booking.concurrency.int-spec.ts`:

- `BR-01 10 patients book one slot in parallel → exactly one 201, nine 409 SLOT_NOT_AVAILABLE, one active appointment row, slot BOOKED`, repeated 20 times with fresh slots inside the test;
- `BR-01 the same Idempotency-Key twice in parallel → one appointment, both responses carry the same appointmentId` (the key store uses `INSERT … ON CONFLICT DO NOTHING` and `SELECT … FOR UPDATE` on the key row);
- `BR-02 a patient at the limit of 2 sends 3 parallel bookings → exactly 2 succeed`;
- reschedule racing a booking of the target slot (B03);
- the same burst in practice A and practice B at once: each practice ends with exactly one booking per slot.

Every assertion checks the `code`, not only the status. The concurrency app sets `PRACTICE_POOL_MAX` to at least the concurrency plus two, so pool exhaustion fails with a named error instead of a flaky 500.

## 6. Asynchronous side effects

- **Outboxes (A02, N01):** messages are enqueued in the business transaction. Tests prove that a committed change always has its outbox row and that a change rolled back after the enqueue has none. Scheduling and backoff come from the `Clock` (`scheduled_for`, `next_attempt_at`); SQL never calls `now()`. Tests call `OutboxProcessor.processDue(fixedNow, limit)` for the platform outbox or inside `runInPractice` for one practice; `findPracticesWithDueWork()` is a thin wrapper with its own tests (a practice with a due row is found in one poll, a practice that is not `ACTIVE` is skipped, job clients never evict a request client).
- **Once-per-period jobs (P04, FA01):** two app instances in one test run the job for the same period; each practice is visited once, through the `practice_job_runs` claim.
- **Integration relay (A01):** tests drive `IntegrationRelay.runOnce()`: an event is applied once, with the practice of the database it was read from; a replayed or older event never overwrites a newer index row; a failed write-through is completed by the relay; a revocation event lands in `revocation_journal`.
- **E-mail:** integration tests use the in-memory `EmailSender`; Mailpit appears in one e2e smoke test with `expect.poll`.
- **Realtime (RT01):** the test asserts that the dashboard toast appears without a reload within Playwright's default expect timeout. Latency is measured separately and does not gate.

## 7. Local and CI

| Command | Needs | CI job |
|---|---|---|
| `pnpm test` | nothing (no Docker, no browser); gitleaks for the rule cases, which skip locally without it and fail in CI | `quality` |
| `pnpm test:integration` | Docker Desktop | `integration` |
| `pnpm test:e2e` | Playwright browsers; from P03 the compose databases (`pnpm db:up && pnpm db:migrate && pnpm db:seed`); run through `pnpm turbo run test:e2e` | `e2e-web` |
| `pnpm verify` | as `pnpm test`, plus the hook check, the staged gitleaks scan, the build (F03) and, from F04, `pnpm check:migrations`; runs before every commit | `quality` runs the same steps |
| images smoke | Docker and the built images | `images` |
| Android emulator flows | Linux runner with KVM | `mobile-device` (nightly, not required) |

CI runs every required job on every push to `v2-planning` and `main` and on every pull request ([07](07-docker-ci-cd.md)).

## 8. Coverage gates

V8 coverage, enforced in each Vitest config:

| Scope | Lines | Branches |
|---|---|---|
| `packages/*/src`, excluding `generated` | 90 % | 85 % |
| API unit project over `src`, excluding `generated` and `main.ts` | 80 % | 70 % |
| `src/**/*.rules.ts` | 100 % | 100 % (functions and statements too) |

- The API config sets coverage at the root level: `{ provider: 'v8', enabled: false, include: ['src/**/*.ts'], exclude: ['src/generated/**', 'src/main.ts', '**/*.d.ts'], thresholds: { lines: 80, branches: 70, 'src/**/*.rules.ts': { lines: 100, branches: 100, functions: 100, statements: 100 } } }`. `include` is required: without it Vitest 5 counts only files that some test imports.
- `test` runs `vitest run --project unit --coverage`; `test:integration` runs without coverage, so its partial branch coverage never fails the gates and never overwrites `coverage/`. The tenancy code in `src/common/tenancy` is covered mainly by the integration specs of §4; its pure parts (LRU bookkeeping and budgets, route parsing, version comparison, cache keys) have unit tests.
- Web and mobile have no percentage gate. Every feature commit adds component tests and one e2e path: the happy path and the most likely failure.

## 9. Flaky tests and silent green

- A flaky test is a bug. Playwright retries 0 times locally and once in CI with `failOnFlakyTests`: the retry records a trace, and the job still fails. `forbidOnly` is on in CI.
- `.only` and `.skip` are lint errors (Vitest preset from F01, Jest preset from F07). Allowed are `it.todo()` for a planned test, conditional skips (`it.skipIf(…)`) for tests that depend on the environment, such as the gitleaks rule cases without the binary, and `quarantine(issueUrl, name, fn)` from `test/support/quarantine.ts`, added with the first quarantined test, which requires a GitHub issue URL (ADR 0006, decision 8). Playwright quarantine uses the tag `@quarantine` with an issue annotation: the required job runs `--grep-invert @quarantine`, a non-blocking job runs `--grep @quarantine`.
- `passWithNoTests: false` in every Vitest and Jest config: a package that collects no test fails.
- Machine-readable results: Vitest `--reporter=default --reporter=junit`, Jest `--json`, Playwright `html` and `junit`; uploaded with `if: always()`.
- Visual baselines are never written in CI (`updateSnapshots: 'none'`). They come from the Playwright Linux container (`visual-baselines` workflow or `test:e2e:update-snapshots`), and the ui-designer approves the first baseline against the Figma frame in the handoff.
- A bug fix names the test that failed before the fix (pull request template).

## 10. Recorded manual checks

Each UI feature records, in its handoff: VoiceOver and TalkBack in Arabic and English, the largest text size, a 375 pt device and a large one, keyboard-only use on the web, and RTL/LTR and light/dark screenshots.
