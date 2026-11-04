# 0005. Multi-tenancy: one database per practice
Status: Accepted — 2026-11-02 (decided by the client)

History: 2026-11-02 accepted · 2026-11-04 revised before its first commit, after the architecture, security and data-operations reviews: two barriers between practices instead of one (no shared group role), TLS on every database connection, a status table for the practice lifecycle, credential rotation, keys per practice, the migration runner's own recovery, backup objectives and a complete offboarding. Three points wait for the client: accounts per deployment and reminder consent per practice (D8), and where patients enter their details (D16).

## Context

MediBooker is a multi-practice SaaS: one platform serves many practices (CLAUDE.md, row Tenancy). Each practice owns the appointment and health data of its patients (GDPR Art. 9), its staff, services, schedule and public page. Data of one practice reaching another practice is the worst incident this product can have.

On 2026-11-02 the client rejected a shared database: every practice gets its own PostgreSQL database. A first draft of this record (one shared database, `practice_id` on every row, Row-Level Security) was never accepted; this record replaces it.

Constraints:

- ADR 0004: one account per person (`User`, e-mail required in v1). What a person may do in a practice comes from a staff membership or a patient profile in that practice.
- `health-data-security` §2: one deployment region per market, no replication of patient data across regions. Target market and hosting are still Open (CLAUDE.md).
- Stack: NestJS 12, Prisma 7 with `@prisma/adapter-pg`, PostgreSQL 18, request context through nestjs-cls ([02-api.md](../architecture/02-api.md)).
- Staff may work for several practices, also in two browser tabs at once; a patient may use several practices.

## Decision

### 1. Control plane and data plane

1. **The platform database** (`medibooker_platform`, one per deployment) holds only what has to exist outside a practice:

   | Area | Tables |
   |---|---|
   | Accounts (ADR 0004) | `users` (with the verified phone), `sessions` with refresh-token families, `mfa_recovery_codes`, `account_tokens` (verification, reset, revoke-all), `consents` given to the platform (privacy notice), `notification_preferences`, `device_tokens`, `account_notifications` (outbox of account and security e-mails), `platform_audit_events` |
   | Practice registry | `practices`: id, status (§5), market, listing data (name per locale, `published_at`), routing (cluster, database name, `route_version`), secret-store references (`app_secret_ref`, `owner_secret_ref`, `field_key_ref`, `backup_key_ref`; never plaintext) and `schema_version`; `practice_slugs` (current and retired slugs in one uniqueness space); `database_clusters` (endpoint, TLS mode and CA reference, provisioner reference, database limit) |
   | Membership index | `practice_access`: user, practice, capacity (`STAFF` or `PATIENT`), staff role, `kind` and `expires_at` of a support membership, active flag, `source_version`, `updated_at`. Read at sign-in and by `/me` |
   | Coordination | `practice_job_runs` (claims of once-per-period jobs), `account_deletions` and `account_exports` (sagas), `practice_exports` (offboarding hand-over), `revocation_journal` (§8), `provider_messages` (provider callbacks) |

   Platform tables that link a user or a message to a practice are health data, because a row for a specialised practice can reveal a condition: `practice_access`, `account_deletions`, `account_exports`, `revocation_journal` and `provider_messages`. They hold ids and flags only, each has a retention (D11), and an architecture test allows a health classification in the platform schema for these tables only. A platform audit row names at most one practice; events about a patient go to that practice's own audit log.

2. **Each practice database** (`practice_<id32>`, where `<id32>` is the practice's UUID without hyphens) holds everything the practice owns: `practice_identity`, settings, page content and theme, staff profiles and consents, memberships (support memberships included) and staff invitations, services, opening hours and special days, availability rules and slots, patients, family links and invitations, reminder consents, appointments and idempotency keys, clinical notes, attachment metadata, the notification outbox, the integration outbox and the practice audit log.

3. **Where each kind of data is authoritative:**

   | Data | Authoritative in | Copy in the other database | Kept consistent by |
   |---|---|---|---|
   | Accounts, sessions, MFA, platform consents, device tokens | platform | none | — |
   | Verified phone: SMS target, later a sign-in identifier (ADR 0004 #3) | platform `users`, one verified number per account | none; a patient profile keeps only an optional contact phone for the practice | — |
   | Notification preferences (channel per message type) | platform | none | Combined at send time with the practice's `appointmentChannels` by the channel resolver (N03); e-mail is the fallback |
   | Reminder consent (BR-13, BR-21) | practice: `reminder_consents` (user, text version, given, withdrawn) | none | Off by default in every practice and withdrawn per practice, because each practice is the controller of its reminders under D8 option A |
   | Listing: name, slugs, publication, status, routing | platform | none (`practice_identity` holds only the id) | — |
   | Staff memberships (role, status, kind, expiry) | practice | `practice_access` row | integration outbox |
   | Patient profiles and family links | practice | `practice_access` row: capacity only, no profile data | integration outbox |
   | Revocations: membership removed, family link revoked, consent withdrawn, note entered in error | practice | `revocation_journal`: ids only | integration outbox; replayed after a restore (§8) |
   | Page content, theme, scheduling, appointments, clinical data, audit of changes inside the practice | practice | none | — |

   Memberships and patient profiles are authoritative in the practice, so the authorization decision is made in the database that holds the data, in the same transaction as role changes and their audit rows. The index can only lag behind, and a lagging index fails closed (§3). A patient enters their details in every practice they use (D16).

4. **Consistency rules:**
   - A request writes one database in one transaction. There are no distributed transactions.
   - Practice to platform: the practice transaction writes an event into its `integration_outbox`. The event names no practice: the relay takes the practice from the context of the database it read the event from, and applies the event as an idempotent upsert that ignores an older `source_version` (at-least-once delivery). After the commit the handler applies the same upsert directly to shorten the lag; the outbox remains the guarantee.
   - Platform to practice: only provisioning (§5) and sagas with one idempotent step per practice and a persisted state per step, for example account deletion (PR01).
   - Messages to people are rows written in the business transaction: `NotificationOutbox.enqueue(tx, …)` in the practice database, `AccountNotifications.enqueue(tx, …)` in the platform database. A committed change always has its message, a rolled-back change never has one. Events after commit serve only realtime and other best-effort reactions.
   - Listing changes (name, slug, publication) write only the platform database; page content writes only the practice database. The API offers them as separate operations.
   - Audit rows are written in the database and transaction of the change: account and registry events in `platform_audit_events`, everything inside a practice in its `audit_events`. A practice's audit view merges its log with the platform rows that carry its id.

Why: each database stays consistent on its own, and every effect across databases is retryable and observable instead of half-done.

### 2. Connections

1. Two Prisma schemas and two generated clients: `apps/api/prisma/platform` and `apps/api/prisma/practice`, each with its own config file and migrations folder.
2. **`PracticeConnectionManager`** resolves a practice to its registry row, the row to credentials from the secret store (cached per practice and `route_version` for at most `PRACTICE_SECRET_TTL_MS`, read again after an authentication failure), and both to a cached `PrismaClient` built with `@prisma/adapter-pg`, TLS (§4.9) and a pool of `PRACTICE_POOL_MAX` connections (default 3). Its LRU is keyed by practice id and `route_version`:
   - at most `PRACTICE_CLIENTS_MAX` clients per process (default 40). Public (slug) requests may hold at most `PUBLIC_PRACTICE_CLIENTS_MAX` (10) of them and jobs at most `JOB_PRACTICE_CLIENTS_MAX` (4); a public or job acquisition never evicts a client that a signed-in request used within `PRACTICE_CLIENT_IDLE_MS`, and a process creates at most `PRACTICE_CLIENT_CREATIONS_PER_SECOND` (5) clients per second. Crawlers and jobs therefore cannot push signed-in users out;
   - `evictIdle()`, called by an unreferenced interval, closes clients idle for `PRACTICE_CLIENT_IDLE_MS` (default 60 s); a client with requests in flight is never closed (reference count), and concurrent first requests for one practice create one client;
   - when it opens a client, it compares `practice_identity` with the registry entry and refuses a database whose id differs or whose `CONNECT` is open to `PUBLIC` (§4.2).
3. **Budget per cluster.** On the platform cluster: API instances × `PLATFORM_DATABASE_POOL_MAX` + the runner's lock connection + one-off tasks + the reserved superuser slots. On a practice cluster: API instances × min(`PRACTICE_CLIENTS_MAX`, practices on the cluster) × `PRACTICE_POOL_MAX` + `MIGRATION_CONCURRENCY` + backup concurrency + reserved slots. Both sums stay below the cluster's `max_connections`. Per practice:
   - the app role has `CONNECTION LIMIT` `PRACTICE_APP_CONNECTION_LIMIT` (default 20; at least the maximum number of API instances × `PRACTICE_POOL_MAX` + 2), `statement_timeout = '15s'` and `idle_in_transaction_session_timeout = '30s'`;
   - the owner role has `CONNECTION LIMIT` `PRACTICE_OWNER_CONNECTION_LIMIT` (default 4: migration, backup, spare).
   Provisioning sets these on every run; `medibooker-db roles reconcile` applies changed values to every practice. OPS01 records the numbers per environment in ADR 0010.
4. **Scaling path:** PgBouncer in transaction mode in front of each cluster. The code keeps no session state that would break it: no `SET`, no session-level advisory locks (only `pg_try_advisory_xact_lock`), no `LISTEN`, no temporary tables. PgBouncer pools per database and user, so it cannot share server connections across practices; the per-practice floor stays. It authenticates the per-practice roles through `auth_query` with a dedicated `auth_user` and a `SECURITY DEFINER` lookup function in one `auth_dbname`, or through an `auth_file` that provisioning and deprovisioning regenerate; `max_db_connections` stays at or below the role's `CONNECTION LIMIT`, and both legs use TLS. Before adopting it, OPS01 reruns `connection-manager.int-spec.ts` through it (D9 criterion: a pooler that supports many database/user pairs and `auth_query`).
5. **Request context:** nestjs-cls holds the resolved practice (id, market, `route_version`, `schema_version`) and the lease of its client. Practice data is reached only through the `practice` transaction host, whose adapter takes the client from the context. Without a resolved practice it throws `PracticeContextMissingError` (500 `INTERNAL_ERROR`, logged with the route). Outside an HTTP request the only way into a practice is `runInPractice(practiceId, fn)`: it opens a fresh context, reads the registry status and market, applies the status table (§5) and the schema guard (§6.8), and leases a client. `forEachPractice()`, the fan-out of §9, export and saga steps, the integration relay, provider callbacks and realtime joins all use it.
6. Integration tests send interleaved concurrent requests for two practices, run the branches of one fan-out concurrently, and prove that no request and no branch ever receives the other practice's client (§11).

Why: a small pool per practice bounds the cost of each practice, the LRU and its budgets bound the cost of many practices, and the request context makes the wrong client unreachable instead of merely unlikely.

### 3. Practice resolution

| Caller | Source of the practice | Check on every request |
|---|---|---|
| Public practice page and free times | The slug in the path `/api/v1/public/practices/{slug}/…`, looked up in the platform database; the slug's routing entry is cached per process for at most `PUBLIC_ROUTE_CACHE_MS` (default 10 s) | The slug lookup and the status table (§5) decide before any practice database is opened: unknown, unpublished and offboarded practices answer 404. A retired slug answers with the current one |
| Staff (dashboard) | The practice id in the path `/api/v1/practices/{practiceId}/…` | The registry row is read on every request, and the caller needs an active, unexpired `practice_access` row there; without it the answer is 404 and no practice client is opened. Then the status table, then an `ACTIVE`, unexpired membership with an allowed role in the practice database, and a completed MFA sign-in in the session |
| Patients (portal and app) | The practice id in the path | As for staff up to the status table; then a patient profile of the user or an `ACTIVE` family link in the practice database. Family delegation is checked per `patientId` in the service (BR-19) |
| Invitation acceptance | The practice id in the path of `…/staff-invitations/accept` or `…/family-invitations/accept`; the token in the body | A practice that serves signed-in requests (publication not required) and a verified account; the token hash and the invited e-mail address are checked in the practice database. Every failure is the same 404, and no practice client is opened before the registry check |
| Mobile app | The selected practice (practice-page link, QR code or `GET /api/v1/me/practices`), stored on the device and used in the path | As for patients |
| Account level (`/api/v1/me`, `/api/v1/auth`) | None | User-scoped; `GET /me/practices` reads only the platform database |

- The practice never comes from a header, the query string, the body or the token.
- Another practice's resource is answered with 404. A caller who has access to the practice but lacks the required role or capacity gets 403.
- A missing index row (for a few seconds after joining a practice) denies; a stale index row is overruled by the practice database. Both fail closed.
- A practice whose market is not in the deployment's `MARKETS` is unavailable (§7.2).

Why: the path makes the scope of every operation visible in the contract and in client cache keys, two tabs can work in two practices, and per-request checks make a removed membership take effect at once.

### 4. Credentials, transport and least privilege

1. **Two roles per practice database, no shared role:**
   - `practice_<id32>_app`: `LOGIN`, used by the API, with privileges in its own database only;
   - `practice_<id32>_owner`: owns the database and every object in it; used by the migration runner and backups.

   There is no cluster-wide group role for practices: a role that every practice role belongs to would carry the privileges of every practice database.
2. **Two barriers between practices:**
   - **`CONNECT`.** `createPracticeDatabase()` in `@medibooker/db-migrate` is the only code that creates a practice database: provisioning, restore, move and the template copies of local and CI tests. Before any data is loaded it revokes everything from `PUBLIC` on the new database, grants `CONNECT` to the practice's app role and stores the role's name as the database setting `medibooker.app_role`. PostgreSQL grants `CONNECT` to `PUBLIC` on every new database, and `pg_restore` without `--create` restores no database ACL, so a database created any other way would be open to every login role.
   - **Table privileges.** The first practice migration grants DML and default privileges to the role named in `medibooker.app_role`, with static SQL that reads the setting and skips the grant where it is unset (shadow and template databases); later migrations change privileges the same way ([02 §9](../architecture/02-api.md#9-prisma-schemas-and-conventions)). A credential of another practice that reaches the database through a wrong ACL still finds no table it may read.
   - The connection manager refuses a database whose `CONNECT` is open to `PUBLIC`. `medibooker-db verify` checks that every practice database's ACL is exactly its owner plus `practice_<id32>_app=c`, and OPS01 alerts otherwise.
3. **App roles cannot change history or identity:** `UPDATE` and `DELETE` are revoked on `audit_events`, `platform_audit_events` and clinical note versions, and `INSERT`, `UPDATE` and `DELETE` on `practice_identity`.
4. **Platform roles:** `platform_owner` runs platform migrations and the lifecycle CLI's registry writes; `platform_app` is the API. `platform_app` cannot change routing: it has no `INSERT`, `UPDATE` or `DELETE` on `database_clusters`, and on `practices` only column grants: `INSERT` of id, market and name for `practice:create` (the status defaults to `PROVISIONING`), and `UPDATE` of name, `published_at` and `updated_at` for the listing. Status, routing, secret references, `route_version` and `schema_version` change only through `medibooker-db`.
5. **`medibooker_provisioner`** (`CREATEDB`, `CREATEROLE`, `createrole_self_grant = 'set'`) is used only by the lifecycle tasks (provision, move, restore, rotation, deprovision); the API never holds it. PostgreSQL 16 and later give it the `ADMIN` option on the roles it creates. For owner-only steps (`CREATE DATABASE … OWNER`, `ALTER DATABASE`, `DROP DATABASE`) it switches with an explicit `SET ROLE` instead of inheriting the privileges of every practice.
6. **Secrets:** `medibooker-db` generates them (32 random bytes) into the secret store; the registry holds references only. PostgreSQL receives a password only as a SCRAM-SHA-256 verifier computed by the client, so no server log, statement statistic or error message can contain it. The API's identity may read app secrets and field keys, the migration runner's identity owner secrets, the backup task's identity backup keys; the provisioner reference is available only to lifecycle tasks. Locally and in CI a development store derives everything from `DEV_SECRET_SEED`; it is rejected outside `APP_ENV` `local` and `ci`.
7. **Rotation:** `medibooker-db rotate-credentials <practiceId> | --all [--owner]` stores a new secret version, sets the new verifier with `ALTER ROLE`, and increments `route_version` in the same run, so every API instance builds a client with the new secret on its next request while requests in flight finish on the old connections. After twice `PRACTICE_CLIENT_IDLE_MS` it terminates the role's sessions that started before the rotation, and it writes a platform audit event. The platform's login roles rotate through two roles, `platform_app_a` and `platform_app_b`, members of `platform_app`, switched by a redeploy (OPS01). OPS01 runs rotation on a schedule and as the first step when a leak is suspected.
8. **Keys per practice:** field encryption uses the practice's own data key (`field_key_ref`, B01) and backups its own backup key (`backup_key_ref`, OPS02). Keyed hashes stored in a practice database (the blind index of the insurance number, `ip_hash` in audit rows) use keys derived per practice with HKDF from the deployment key and the practice id. The same insurance number therefore has different blind indexes in two practices, and destroying a practice's keys makes every remaining copy of its encrypted data unreadable (§5). `FIELD_ENCRYPTION_KEYS` encrypts only platform fields (MFA secrets, device tokens).
9. **Transport:** every connection to PostgreSQL uses TLS 1.2 or later with certificate and host-name verification: the platform pool, practice clients, the runner, the lifecycle tasks, backups, and PgBouncer and the Socket.IO adapter store once they exist. `database_clusters` holds `tls_mode` and `ca_secret_ref`; outside `APP_ENV` `local` and `ci` only `verify-full` is accepted, and `parseEnv` rejects a `PLATFORM_DATABASE_URL` without `sslmode=verify-full`. Clusters accept only `hostssl` connections with `scram-sha-256` and set `ssl_min_protocol_version = 'TLSv1.2'` (D9).
10. **Server logs:** clusters run with `log_error_verbosity = terse`, `log_parameter_max_length = 0`, `log_parameter_max_length_on_error = 0`, `log_statement = 'none'` (break-glass roles excepted, §9.4) and no parameter logging in `auto_explain`, so constraint details and bind values never reach the server log. The server log is classified as health data: kept in the region for at most 30 days, with audited access.

Why: two independent barriers must both fail before a credential of one practice reads another; only operator tasks can change where the API connects; every credential can be replaced without downtime; and neither the network path nor the database's own logs leak what the application keeps out of its logs.

### 5. Practice lifecycle

1. **Statuses** (`practices.status`). Every entry point (`@PracticeScoped`, `runInPractice`) applies this table, the market check (§7.2) and the schema guard (§6.8):

   | Status | Set by | Public requests | Signed-in requests | Jobs and relay | Runner | Backups | Fan-out, export, saga steps |
   |---|---|---|---|---|---|---|---|
   | `PROVISIONING` | `practice:create`, `provision` | 404 | 404 | no | no; `provision` migrates | no | not listed |
   | `ACTIVE` | `provision`, `practice resume` | served | served | yes | yes | yes | included |
   | `SUSPENDED` | `practice suspend --reason` (contract or incident) | 503 | 503 | paused | yes | yes | unavailable; steps wait |
   | `MOVING` | `move` | 503 | 503 | paused | no; the move migrates the target | no; the move dumps | unavailable; steps wait |
   | `RESTORE_REVIEW` | `restore` with a routing switch | 503 | admins served, others 503 | paused | yes | yes | unavailable; steps wait |
   | `DEPROVISIONING` | `deprovision` | 404 after `PUBLIC_ROUTE_CACHE_MS` | 404 at once | no | no | yes, until `--finalize` | not listed: index rows inactive |
   | `FINALIZED` | `deprovision --finalize` | 404 | 404 | no | no | dropped | not listed |

   A 503 carries `SERVICE_UNAVAILABLE` and `Retry-After`. A signed-in caller gets it only after passing the index check, so callers without access still get 404. The API only creates a registry row, whose status defaults to `PROVISIONING` (`practice:create`); every transition is a `medibooker-db` command.
2. **Every lifecycle command writes `platform_audit_events`** before and after it runs, as `platform_owner`: the command, the practice id, the outcome, the operator principal taken from the task's cloud identity (assumed through GitHub OIDC or the provider's console, never a command-line flag) and an approval reference. A restore with a routing switch, `--finalize`, the download of a practice export and `break-glass open` require an approval reference from the production environment's reviewer.
3. **Provisioning:** `medibooker-db provision <practiceId>` (package `@medibooker/db-migrate`, shipped in the migrate image) is idempotent: every step checks its result first, so the command can be rerun after any failure.
   1. Registry row with status `PROVISIONING`, created if absent; in staging and production its market must be in `MARKETS`.
   2. Placement: the deployment's default cluster, or `--cluster <id>` (§7).
   3. The secrets (generated once, reused on a rerun), then the two roles with their verifiers, connection limits and settings (§2.3); from B01 the field key, from OPS02 the backup key.
   4. `createPracticeDatabase()`: `CREATE DATABASE practice_<id32> OWNER practice_<id32>_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`, then the ACL and `medibooker.app_role` (§4.2). The builtin locale provider makes sorting and text indexes independent of the operating system's collation library, so a move or a restore never changes them; language-aware sorting names an ICU collation in the query.
   5. `prisma migrate deploy` with the practice config, as the owner; `schema_version` recorded.
   6. Defaults: `practice_identity` and the practice-specific settings (time zone, default locale). Static defaults come from the migrations.
   7. Routing registered, status `ACTIVE`.

   The provisioning job is this command, run as a one-off task in the target region; OPS01 starts it after `practice:create`. Local seeding and the integration harness call the same function, as `medibooker_provisioner` and never as a superuser.
4. **Move:** `medibooker-db move <practiceId> --cluster <id>` sets `MOVING`, revokes `CONNECT` from the app role on the old database and terminates its sessions, so no write can follow the dump. It dumps as the owner; creates the roles with the same secrets and the database with `createPracticeDatabase()` on the target cluster, which `medibooker-db cluster bootstrap` prepared; restores; runs `migrate deploy`; compares `practice_identity`, the locale provider and per-table checksums; increments `route_version` and sets `ACTIVE`. The old database stays without `CONNECT` for `MOVE_KEEP_DAYS` (default 7); then it and the practice's logical backups on the old side are dropped, audited.
5. **Deprovisioning:** `medibooker-db deprovision <practiceId>` runs in resumable steps (OPS02):
   1. Status `DEPROVISIONING`; the practice's index rows are deactivated.
   2. After `PUBLIC_ROUTE_CACHE_MS`, `CONNECT` is revoked from the app role and its sessions are terminated, so a cached client fails instead of reading.
   3. Export for the practice as the controller of its data: a logical dump, a structured export and every file under the practice's storage prefix, written to object storage in the practice's region under that prefix and encrypted with a key for this export. `practice_exports` names the practice's admins at that moment as recipients; an admin downloads it through a short-lived signed URL after a fresh MFA check, audited as `PRACTICE_EXPORT_DOWNLOADED`. The export is deleted at `drop_after`.
   4. `--finalize`, refused before `drop_after` (the retention of the practice's market, D11), first destroys the practice's field and backup keys (crypto-shredding: every remaining copy becomes unreadable). Then it drops the database, both roles, the secrets, the logical backups, the export, every object version and delete marker under the storage prefix, and the practice's `practice_access`, `practice_job_runs` and `revocation_journal` rows. The registry keeps a tombstone (`FINALIZED`) with the id and the slugs, so no other practice can take them over, and `purged_at`: the end of the cluster's PITR retention, when the last physical copy expires.

Why: every status has one defined answer on every path; a new practice, a move and an offboarding are repeatable commands instead of manual infrastructure work; the steps that need high privileges run outside the API; and leaving the platform has a defined, auditable end that also reaches files, keys and backups.

### 6. Migrations

1. A release runs `medibooker-db migrate platform` (`prisma migrate deploy` with the platform config), then `medibooker-db migrate practices`, then rolls out the new code.
2. The migration runner:
   - selects the practices whose status the runner migrates (§5) and whose `schema_version` is older than the newest migration in the image;
   - runs `prisma migrate deploy` per database as its owner (`application_name=medibooker-migrate`), at most `MIGRATION_CONCURRENCY` at a time (default 4), and records `schema_version` and `migrated_at`, or `migration_error_code`;
   - continues after a failure, prints one JSON line per practice and a summary, exits non-zero when any practice failed and raises an alert;
   - holds a platform advisory lock, so only one runner works on a deployment at a time.
3. **Every migration of both schemas is atomic and bounded:** it starts with `BEGIN; SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '60s';` and ends with `COMMIT;`. A longer timeout, and `CREATE INDEX CONCURRENTLY` (which cannot run in a transaction), need a reviewed exception. From F04, `scripts/check-migrations.ts` enforces this for every file in both folders, together with the `-- contract` rule of item 6.
4. **Recovery without a manual step:** a failed atomic migration leaves its database on the previous version, but Prisma keeps an unfinished `_prisma_migrations` entry and refuses every later deploy on that database (P3009). The runner handles it itself. When the entry carries an error reported by the database, it runs `prisma migrate resolve --rolled-back <name>` as the owner, logs it with the practice id and deploys again in the same run. `lock_not_available` is retried up to `MIGRATION_LOCK_RETRIES` (3) times with backoff. When `MIGRATION_TIMEOUT_MS` expires, the runner first terminates its own backend (`pg_terminate_backend`, found by `application_name`) and then records the failure. An entry without a database error (a lost connection) is left alone and recorded as `MIGRATION_STATE_UNKNOWN`; the runbook decides with `verify`.
5. **A migration that succeeded in any practice is never edited.** A failure in one practice is fixed by repairing that practice's data or environment and retrying the unchanged migration, or by a new migration.
6. **Expand and contract:** practices may run different schema versions for a short time during a rollout. Every migration works with the code of the previous release. A contract step (`DROP`, `RENAME`, type change) carries a `-- contract` comment and ships one release after the code stopped using the object, and only when every practice the runner migrates has reached the previous release's version.
7. **Verification:** `medibooker-db verify [--practice <id>]` compares each practice's live schema with `prisma/practice/schema.prisma` (`migrate diff --from-config-datasource --to-schema … --exit-code`, bounded concurrency) and checks its ACL (§4.2). It runs after every release and weekly, and alerts on drift.
8. **Runtime guard:** the API build records the newest practice migration as `PRACTICE_SCHEMA_REQUIRED`. A practice with an older `schema_version` is answered with 503 `SERVICE_UNAVAILABLE` and `Retry-After`, never served by code that expects a newer schema. Readiness fails while the platform schema is behind the code.

Why: one schema everywhere, applied with the command Prisma already provides, with failures isolated per practice, recovered by the runner and visible in one place.

### 7. Placement and data residency

1. **One deployment per market region stays the default:** API, web, the platform database and a PostgreSQL cluster for the region's practice databases. Accounts exist per deployment, so a person who uses practices in two markets has two accounts. This narrows ADR 0004 #2 ("one account per person on the platform") to one account per person and deployment, because the data-residency baseline forbids replicating accounts across regions. It needs the client's confirmation (D8, question 6); once confirmed, ADR 0004's status block gets the line "Amended by ADR 0005 §7.1 — <date>".
2. `practices.market` must be in the deployment's `MARKETS`: provisioning and `practice:create` refuse any other market, and in staging and production `@PracticeScoped` and `runInPractice` treat a practice outside `MARKETS` as unavailable (503 for that practice only, a metric and an alert). Readiness checks only that `MARKETS` is set, so one registry row or one changed setting never takes the API out of rotation. Local and CI are exempt, so the seed can hold a practice in Riyadh and one in Berlin.
3. By default all practice databases of a deployment run on the region's default cluster (`database_clusters`). Through its routing entry a practice can be placed on its own server or in another region: `--cluster` at provisioning, or `medibooker-db move` (§5.4).
4. Another region covers the practice database only. The account and the `practice_access` row stay in the deployment's region, and every query crosses regions. Such a placement needs the confirmation of the client's DPO for that market; without it, the practice belongs to a deployment in its own region (decision D8).

Why: per-practice placement handles dedicated servers and residency exceptions through configuration, the deployment per market keeps accounts in their market, and a wrong market setting affects one practice instead of the deployment.

### 8. Backups and restore

1. **Point-in-time recovery** per cluster, from the hosting provider, with retention per market (D11). Until a finalized practice's `purged_at`, base backups and WAL still hold its data; the PITR runbook drops the databases of finalized practices before a restored cluster serves traffic.
2. **A logical backup per practice every day,** for every status that holds data (`ACTIVE`, `SUSPENDED`, `RESTORE_REVIEW`, and `DEPROVISIONING` until `--finalize`): `pg_dump --format=custom` with the PostgreSQL 18 client as the owner, plus a manifest with row counts and per-table checksums, encrypted with AES-256-GCM under the practice's backup key, with the key id in the file header, stored in the practice's region. A key version is kept until the last backup encrypted with it has expired.
3. **Objectives,** proposed and confirmed by the client with D9: an RPO of 24 hours for a single-practice restore from the logical backup and the provider's PITR objective (minutes) for a cluster; an RTO of 4 hours for one practice and 8 hours for a cluster.
4. **Restoring one practice** (`medibooker-db restore <practiceId> --backup <id>`). After an incident the dump comes from a temporary cluster restored with PITR to the chosen time; the nightly dump is for disasters. The command decrypts into a temporary file and verifies the authentication tag before `pg_restore` reads anything, creates the database with `createPracticeDatabase()`, restores, runs `migrate deploy`, and checks `practice_identity` and the manifest. Then it brings back what happened after the restore point:
   - it re-applies every `revocation_journal` entry newer than the restore point (membership removed, family link revoked, consent withdrawn, note entered in error);
   - it deactivates the memberships that the index shows as removed after the restore point, then rebuilds the practice's index rows with a version reset;
   - it resets the practice's saga steps that finished after the restore point, so they run again (they are idempotent);
   - it copies `audit_events` newer than the restore point from the old database when that is still readable.

   Then `route_version` + 1 and status `RESTORE_REVIEW` (admins only) until the practice's admin confirms and the operator runs `medibooker-db practice resume`. `--inspect` restores without routing.
5. **Restore tests:** CI restores a dump on every push (§11). A monthly job restores a rotating sample of production backups into an isolated restore cluster in the same region and checks identity, migration version and the manifest, with an alert and a recorded result. A quarterly drill restores each cluster with PITR to a chosen time in a temporary cluster and records the measured RTO.

Why: point-in-time recovery restores a whole cluster; only a per-practice backup makes restore and deletion per practice real, and only replaying revocations keeps a restore from giving back access that was taken away.

### 9. Cross-practice features

1. **My appointments** for a patient of several practices (`GET /api/v1/me/appointments?scope=upcoming`, B03) fans out over the user's `practice_access` rows in a stable order (most recently updated first): the first `ME_FANOUT_MAX_PRACTICES` (20), `ME_FANOUT_CONCURRENCY` (4) at a time, with a timeout of `ME_FANOUT_TIMEOUT_MS` (2000) per practice. Each branch runs through `runInPractice` and takes the caller's patients (the own `SELF` profile and `ACTIVE` family links) from that practice's database, never from the index. The response returns what loaded and lists the rest in `unavailablePractices` with a reason: `UNAVAILABLE` (status, market, schema or outage), `TIMEOUT`, or `LIMIT` for practices beyond the first 20. Clients show both. History (`scope=past`) stays per practice, with cursor pagination.
2. **The data export** (PR01) fans out the same way, as an asynchronous job that is complete only when every practice has delivered its part.
3. **Platform analytics** use only aggregated, non-personal data: counts per practice and day, without service, provider or patient dimensions. None is planned yet.
4. **Platform operators** have no role and no routine access to practice data in the application.
   - **Support** works only through a support membership (`kind = SUPPORT`) that the practice's admin grants: a role the admin chooses (default `STAFF`, which reads no clinical notes by default), a reason, an `expires_at` at most `SUPPORT_ACCESS_MAX_HOURS` (72) ahead, MFA, a flag in the practice's audit view, and revocation at any time. An expired row counts as absent on the next request, and its sockets are disconnected. The API refuses support memberships until the client confirms this model (D8, question 4; `SUPPORT_ACCESS_ENABLED`, default `false`).
   - **Break-glass** database access, for incident response only: `medibooker-db break-glass open <practiceId> --incident <id> --ttl <hours>` creates a login role with `SELECT` only and `VALID UNTIL`, logs every statement of that role and writes the platform and the practice audit log; `close`, also run by a scheduled sweep at expiry, terminates its sessions and drops it. Its statement log is health data. Procedure in OPS01.

Why: the few features that need several practices pay for the fan-out themselves, read authorization from the practice that holds the data, and no standing access path bypasses a practice's own access control.

### 10. What the database boundary replaces

- No Row-Level Security, no `practice_id` columns and no composite tenant foreign keys inside practice databases: the database is the boundary. Practice tables use plain foreign keys.
- `practice_id` columns exist only in the platform database (registry, slugs, index, coordination tables, platform audit).
- One element is kept for a concrete reason: the single row `practice_identity`, which the connection manager compares with the routing entry, catches a routing mistake or a restore into the wrong database.
- **State outside a practice database is keyed by practice.** Realtime rooms are `practice:{practiceId}:staff`, `practice:{practiceId}:doctors` and `user:{userId}`; every event payload carries `practiceId`; every in-process or shared cache of practice data goes through `PracticeCache`, which builds its keys from the resolved practice and its `route_version`. Caching a singleton row (`practice_identity`, `practice_settings`, `practice_themes`, all with id 1) by table and id alone is forbidden.
- The fail-closed request context stays (§2).

Why: the database enforces the boundary for every query and every job, so repeating it on every row adds cost without protection; only pointing at the wrong database, and state that lives outside the databases, need their own checks.

### 11. Isolation tests

The integration project runs on every push. Testcontainers provisions two practice databases, A and B, and the tests prove:

1. **Wrong slug:** A's slug never returns B's data; an unknown, unpublished or offboarded slug answers 404 without opening a practice client; B cannot claim A's retired slug.
2. **Foreign membership:** a member or patient of A calling B's paths gets 404, and no client for B is opened.
3. **Forged practice:** an `X-Practice-Id` header, a `practiceId` query parameter or a `practiceId` body field never changes the practice of a request (headers and query are ignored, the body field is rejected as unknown).
4. **Status:** every status of §5 gives its answer, also through a client cached before the change; a deprovisioned practice never returns data.
5. **Credentials:** A's app role cannot connect to B's database, to a restored or copied database of B, or to the platform database; with B's `CONNECT` opened on purpose it still reads no table of B; it has no DDL rights in its own database and cannot change `practice_identity`; `platform_app` cannot change routing.
6. **Concurrency:** interleaved concurrent requests for A and B, and concurrent branches of one fan-out, never receive the other practice's client or rows.
7. **Identity and ACL:** a routing entry that points at the wrong database, and a database whose `CONNECT` is open to `PUBLIC`, are refused.
8. **Migration runner:** both practices end at the same `schema_version`; a failure in B leaves A migrated and B on its previous version, and the next run completes B after the fix without a manual step.
9. **Context:** access to practice data without a resolved practice fails; a job run for A never touches B.
10. **HTTP matrix:** every practice-scoped operation is in the `CROSS_PRACTICE` registry and tested with a caller of A against resources of B ([06-testing.md](../architecture/06-testing.md)).
11. **TLS:** a client facing a server certificate it does not trust fails with 503 and sends no password.
12. **Keyed state:** concurrent cached reads of A's and B's settings return each practice's own values; a socket in A's room never receives B's event (RT01).

Why: each test closes one concrete path by which a request could cross practices, and all of them run against real PostgreSQL on every push.

### 12. Local development and CI

- Compose runs one PostgreSQL 18 server with the platform database and two seeded practice databases: `al-noor` (Asia/Riyadh) and `lindenhof` (Europe/Berlin), created by `pnpm db:seed` through the real provisioning code. Host processes and containers reach the server under different addresses through `DATABASE_CLUSTER_ENDPOINTS`, which only `local` and `ci` accept.
- Integration tests create their databases per test file through `createPracticeDatabase()` from migrated templates that accept no connections; the provisioning, runner, restore and TLS tests run the full path. Local and CI clusters run without TLS; the TLS spec starts its own server with a certificate generated at test time.

Why: developers and CI exercise the same routing, credentials and migrations as production, with two practices whose rules differ (time zone, weekend, DST, locale).

### 13. Legal roles

Proposed, pending the client's DPO or counsel: each practice is the controller of its patients' data and the platform acts as its processor; for platform accounts the platform may itself be a controller. The answer decides the data processing agreements, who answers data-subject requests, and how account deletion meets each practice's duty to keep medical records (PR01).

Why: the split into a platform database and practice databases fits either answer, with one exception that is built for the recommended answer: reminder consent is recorded per practice (§1.3), as option A requires. Under option B a platform-wide consent would suffice, and the per-practice rows would still be correct.

## Consequences

**Positive:**

- Strong isolation: another practice's data sits in another database that a practice's credentials can neither open nor read, and the request context cannot reach it either.
- Restore, export, placement and deletion work per practice, down to destroying a practice's keys; a residency exception is a routing entry, not a code change.
- Every credential can be rotated without downtime, and routing can change only through audited operator commands.
- Simpler practice schemas: no tenant columns, composite keys or RLS policies.

**Negative:**

- Connection and memory cost per practice: every open practice client holds a pool and a Prisma client. The LRU and its budgets bound it, F04 measures it, PgBouncer is the next step.
- Migration fan-out time grows with the number of practices (one `prisma migrate deploy` per database), and a failing practice needs attention before the next contract step.
- Operational cost: many databases and roles, four secrets per practice (app, owner, field key, backup key; secret managers often charge per secret), per-practice backups, monitoring and TLS configuration per cluster, and autovacuum and catalog overhead per database. A cluster holds a bounded number of databases; OPS01 records the limit.
- Privilege changes in practice migrations are small dynamic SQL blocks, because the app role's name differs per database.
- Cross-practice reporting is harder: there is no SQL across practices, only fan-out or aggregated projections.
- A person who uses practices in two markets has two accounts (pending D8, question 6), and a patient enters their details once per practice (D16).
- More moving parts: the integration outbox and its relay, the revocation journal, job claims, sagas and the lifecycle commands.

**Follow-ups:**

- F04 builds both schemas, the connection manager with its budgets and TLS, `createPracticeDatabase()`, provisioning, the migration runner with its recovery and lint, `verify`, the operator audit and the isolation tests. A01 adds the index, memberships with support expiry and the relay; B01 field keys and the blind index; B03 the fan-out; PR01 the export job and the deletion saga; OPS02 backups, restore, move, rotation and offboarding; OPS01 the clusters, the secret store, the connection budget, the deploy order, break-glass and the alerts ([08-roadmap.md](../architecture/08-roadmap.md)).
- The client's DPO decides the legal roles, reminder consent per practice and any cross-region placement (D8 and D11); the client confirms accounts per deployment (D8) and where patients enter their details (D16) ([09-risks-and-decisions.md](../architecture/09-risks-and-decisions.md)).
- Decide how the app chooses the deployment before a second market launches (D7).

## Alternatives considered

- **Shared database with `practice_id` and Row-Level Security** (the first draft): cheapest to operate, but rejected by the client; isolation depends on every query, policy and job being right.
- **Schema per practice in one database:** fewer connections, but one database credential reaches every schema, Prisma still needs a client per schema, and backup and deletion per practice are no easier.
- **One shared application role for all practice databases:** fewer secrets, but one leaked credential reaches every practice.
- **A group role `practice_app` with DML in every practice database** (the first version of this record): identical grant SQL in every migration, but the `CONNECT` ACL would be the only barrier between practices, so one restore or move that forgets it opens a practice to every other practice's credential; PostgreSQL 16 and later also require the `ADMIN` option to grant membership in it.
- **Deployment-wide field and blind-index keys:** fewer keys, but the blind index of one insurance number would be the same in every practice database and link a person across practices, and no practice could be crypto-shredded.
- **Memberships authoritative in the platform database:** one place for sign-in, but authorization would read another database than the data, and role changes and their audit rows would span two databases.
- **Distributed transactions (two-phase commit):** atomic, but abandoned prepared transactions hold locks and block vacuum, and Prisma's interactive transactions do not support them.
- **A server or cluster per practice:** the strongest separation at the highest cost; available for single practices through the routing entry.
- **Practice in the token or in a header:** one practice per session, or a scope that is invisible in the contract and in client cache keys.
- **Readiness fails when any practice's market is outside `MARKETS`:** catches a misconfiguration early, but one registry row would take every instance out of rotation.
