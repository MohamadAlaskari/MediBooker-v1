# Docker, CI and delivery

Images are built in CI and can be built locally with Docker Desktop. Hosting is open (CLAUDE.md), so delivery ends at a deploy placeholder behind a manual approval. Decisions are recorded in ADR 0009 (branch model, CI gates, supply chain; F02) and ADR 0010 (images and delivery; F05). The database lifecycle (one database per practice, provisioning, the migration runner) follows [ADR 0005](../adr/0005-multi-tenancy.md).

## 1. Images

Three images, built from the repository root with BuildKit and defined in `docker-bake.hcl` (targets `api`, `api-migrate`, `web`; group `default`):

| Image | Dockerfile target | Content |
|---|---|---|
| `medibooker-api` | `apps/api/Dockerfile` → `runtime` | Node 26 and `/app` = `pnpm deploy --prod` of the API: `dist` and production `node_modules`. No Prisma CLI, no lifecycle CLI, no provisioner credentials |
| `medibooker-api-migrate` | `apps/api/Dockerfile` → `migrate` | Node 26, OpenSSL, `pnpm deploy --prod` of `@medibooker/db-migrate` (the CLI `medibooker-db` with `pg` and the Prisma CLI), and in `/app/schema` the two Prisma schemas, both migration folders and both configs; from OPS02 also the PostgreSQL 18 client tools from the PGDG repository |
| `medibooker-web` | `apps/web/Dockerfile` → `runtime` | Node 26 and the Next standalone output with `.next/static` and `public` |

There is no mobile image; app builds go through EAS (REL01). The migrate image runs every database task as a one-off container: `migrate platform`, `migrate practices`, `provision`, `verify` and `roles reconcile`, from OPS02 `backup`, `restore`, `move`, `practice suspend|resume`, `rotate-credentials` and `deprovision`, and from OPS01 `cluster bootstrap` and `break-glass`.

### apps/api/Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:26.13.0-trixie-slim@sha256:<digest>

FROM ${NODE_IMAGE} AS base
# OpenSSL before any install: the Prisma engines postinstall picks the native schema
# engine for the libssl it finds (debian-openssl-3.0.x on trixie).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
# pnpm 12 links its native binary in an install script: no --ignore-scripts here.
RUN npm install -g pnpm@12.16.1
ENV CI=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM deps AS build
COPY package.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/db-migrate apps/db-migrate
# The CI install of the same commit has verified the lockfile against the policies.
RUN pnpm install --offline --frozen-lockfile --trust-lockfile \
      --filter '@medibooker/api...' --filter '@medibooker/db-migrate'
RUN pnpm --filter @medibooker/api db:generate \
 && pnpm --filter '@medibooker/api...' run build
RUN pnpm --filter @medibooker/api deploy --prod /out/api \
 && pnpm --filter @medibooker/db-migrate deploy --prod /out/migrate \
 && find /out/migrate/node_modules -name 'schema-engine-debian-openssl-3.0.x' | grep -q .

FROM ${NODE_IMAGE} AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api /app
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health/live').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM ${NODE_IMAGE} AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 PRISMA_ROOT=/app/schema
WORKDIR /app
COPY --from=build /out/migrate /app
COPY apps/api/prisma/platform /app/schema/prisma/platform
COPY apps/api/prisma/practice /app/schema/prisma/practice
COPY apps/api/prisma.platform.config.ts apps/api/prisma.practice.config.ts /app/schema/
USER node
ENTRYPOINT ["node", "src/cli.ts"]
CMD ["migrate", "all"]
```

Why this shape:

- `pnpm fetch` depends only on the lockfile, so its layer survives source changes. The store stays inside the layer (no cache mount), so a restored layer always comes with its store and the `--offline` install cannot miss a tarball. The layer is large (the whole lockfile) but changes only with the lockfile; it is cached in GitHub's cache with `mode=max` (§3).
- Each image copies only the workspaces it needs, so a web change does not rebuild the API.
- A filtered `pnpm run` builds in dependency order; Turbo is not used inside images, because a filtered install does not install the workspace root.
- `apps/api/package.json` declares `"files": ["dist"]`, so `pnpm deploy` ships only build output. `apps/db-migrate/package.json` declares `"files": ["src"]`: Node runs its TypeScript by type stripping, so it needs no build step.
- `packageExtensions` makes the `prisma` peer of `@nestjs-cls/transactional-adapter-prisma` optional (it is declared as `> 4 < 9` without `peerDependenciesMeta`), so `deploy --prod` leaves the Prisma CLI out of the API image. The Prisma CLI ships only in the migrate image, through `@medibooker/db-migrate` (`"prisma": "catalog:"`), so its version always equals the API's client.
- Prisma 7.10.1 migrate commands still spawn the native schema engine, which needs OpenSSL at build time (engine selection) and at run time. The build fails if the OpenSSL 3 engine is missing; the compose `migrate` service runs `read_only`, so a run-time engine download fails in CI, not in production.
- The migrate image holds no credentials. The platform migrator URL, the secret-store settings and, for provisioning, the cluster's provisioner reference come from the task's environment and identity at run time.
- From OPS02 the `migrate` stage installs `postgresql-client-18` from the PGDG apt repository (`trixie-pgdg`, signing key pinned by its fingerprint), because Debian trixie's own `postgresql-client` is version 17, whose `pg_dump` refuses a PostgreSQL 18 server. The build fails unless `pg_dump --version` reports 18; a Renovate custom manager (`deb` datasource on the PGDG repository) moves the pinned package version.
- Application files stay root-owned and only readable for `node`; npm and npx are removed from runtime images.

### apps/web/Dockerfile

The same `base` → `deps` → `build` pattern without OpenSSL. The build stage copies `package.json`, `packages` and `apps/web`, installs with `--filter '@medibooker/web...'` and runs `pnpm --filter '@medibooker/web...' run build`. The runtime stage copies `.next/standalone` to `/app`, `.next/static` to `/app/apps/web/.next/static` and `public` to `/app/apps/web/public`, sets `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`, `NEXT_TELEMETRY_DISABLED=1`, runs as `node` with a `/healthz` health check and `CMD ["node", "apps/web/server.js"]`. Fonts come from npm, so the build needs no network. Run-time configuration: `API_INTERNAL_URL`, `PUBLIC_SITE_URL`, `APP_ENV`.

### Rules

- Build context is the repository root. `.dockerignore`: `**/node_modules`, `**/.next`, `**/dist`, `**/.turbo`, `**/coverage`, `.git`, `.claude`, `docs`, `apps/mobile`; the secret patterns of `.gitignore` at every depth: `**/.env*` and `**/*.env`, then `!**/.env.example`, `**/*.pem`, `**/*.key`, `**/*.p8`, `**/*.p12`, `**/*.pfx`, `**/*.jks`, `**/*.keystore`, `**/*.mobileprovision`; and `**/.npmrc`.
- Secrets only through `RUN --mount=type=secret`, never `ARG` or `ENV`: provenance `mode=max` records build arguments.
- Non-root, no dev dependencies, one process per container, exec-form `CMD`, health checks read `PORT`.
- `linux/amd64` until the hosting provider needs arm64.
- Size budgets, measured in the `images` job as `docker save <image> | gzip | wc -c`: `api` and `web` at most 150 MB, `api-migrate` at most 200 MB. F05 and F06 record the measured sizes; a budget changes only with a reason in the commit body.

## 2. Compose for local development

`compose.yaml` (project `medibooker`; every port bound to `127.0.0.1`):

| Service | Profile | Image and settings |
|---|---|---|
| `db` | default | `postgres:18.6-trixie@sha256:…`, `command: ["postgres", "-c", "max_connections=200", "-c", "log_error_verbosity=terse", "-c", "log_parameter_max_length=0", "-c", "log_parameter_max_length_on_error=0"]` (the server log settings of ADR 0005 §4.10), port 5432, `shm_size: 256mb`; `POSTGRES_PASSWORD`, `PLATFORM_OWNER_PASSWORD`, `PLATFORM_APP_PASSWORD`, `PROVISIONER_PASSWORD`, each `${…:?copy .env.example to .env}`; volumes `pgdata:/var/lib/postgresql` (PostgreSQL 18 expects the parent directory) and `./infra/local/postgres/init:/docker-entrypoint-initdb.d:ro`; health check `pg_isready -h 127.0.0.1 -U postgres` with `interval: 2s`, `retries: 30`, `start_period: 30s` |
| `migrate` | `app` | `medibooker-api-migrate:local`, `command: ["migrate", "all"]`; after `db` is healthy; `PLATFORM_MIGRATION_URL` with `platform_owner` at `db:5432`, `DATABASE_CLUSTER_ENDPOINTS: '{"local":"db:5432"}'`, `SECRET_STORE: dev`, `DEV_SECRET_SEED`, `APP_ENV: local`; `read_only: true`; `mem_limit` from the F05 measurement |
| `api` | `app` | `medibooker-api:local`; after `migrate` completed successfully; `PLATFORM_DATABASE_URL` with `platform_app` at `db:5432`, `DATABASE_CLUSTER_ENDPOINTS: '{"local":"db:5432"}'`, `SECRET_STORE: dev`, `DEV_SECRET_SEED`, `APP_ENV: local`, `TRUST_PROXY_HOPS: 1`; port 3001 |
| `web` | `app` | `medibooker-web:local`; `API_INTERNAL_URL=http://api:3001`, `PUBLIC_SITE_URL=http://localhost:8080`; tmpfs `/app/apps/web/.next/cache` |
| `proxy` | `app` | `caddy:2.11.7-alpine@sha256:…` with `infra/local/Caddyfile` on port 8080: `/api/*` → `api:3001`, everything else → `web:3000`; `/health*` is not routed; no access log; `/api/*` sets `X-Request-Id` itself (`header_up X-Request-Id {http.request.uuid}`), replacing any client value, so only a trusted hop chooses the request id ([02 §4](02-api.md#4-request-pipeline-and-core-abstractions)) |
| `mailpit` | `mail` (A02) | `axllent/mailpit:v1.33.0@sha256:…`, SMTP 1025, UI 8025 |

- `infra/local/postgres/init/01-cluster.sh` (LF) creates only cluster-level objects: the roles `platform_owner`, `platform_app` and `medibooker_provisioner` (`CREATEDB`, `CREATEROLE`, `ALTER ROLE … SET createrole_self_grant = 'set'`), and the database `medibooker_platform` owned by `platform_owner` with the builtin `C.UTF-8` locale, `CONNECT` revoked from `PUBLIC` and granted to `platform_app`. There is no group role for practices (ADR 0005 §4.1). Practice databases are never created by the init script; `medibooker-db provision` creates them as `medibooker_provisioner`, locally exactly as in production. The Testcontainers global setup creates the same roles, and OPS01's `cluster bootstrap` does it in production.
- The health check connects over TCP: the image runs the init scripts against a temporary server that listens only on the Unix socket, so a socket check reports healthy before `01-cluster.sh` has finished and during the restart that follows.
- **One local environment file:** the root `.env`, copied from the root `.env.example`, which holds placeholders only (`changeme-…` values, which the gitleaks rule accepts). The API, both Prisma configs, `medibooker-db` and the e2e fixtures load it by path from the workspace root (the directory with `pnpm-workspace.yaml`), so `pnpm db:migrate` and the e2e fixtures get the same values as `pnpm dev` without Turborepo pass-through. `apps/api` has no `.env.example`; the web keeps `apps/web/.env` for `API_INTERNAL_URL` and `PUBLIC_SITE_URL` only. `docs/dev/getting-started.md` describes it from F04.
- **Two addresses for one cluster:** host processes (`pnpm dev`, `pnpm db:migrate`, `pnpm db:seed`, the e2e fixtures) reach PostgreSQL at `127.0.0.1:5432`, which the seed registers for the cluster `local`; the `migrate` and `api` containers set `DATABASE_CLUSTER_ENDPOINTS` to `db:5432` for the same cluster id ([02 §5](02-api.md#5-data-layer-and-tenancy)).
- `api`, `web` and `migrate` run with `read_only: true`, tmpfs `/tmp`, `init: true`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]` and `pids_limit: 256`; `api` and `web` with `mem_limit: 512m`. `migrate` runs one Prisma CLI process per concurrently migrated practice, so its limit comes from F05's measurement of `migrate practices` with `MIGRATION_CONCURRENCY=4`. This is the run-time baseline OPS01 keeps.
- The compose image names equal the bake tags, so the CI smoke test runs exactly the images that get published.
- Local workflow: `cp .env.example .env`, then `pnpm db:up && pnpm db:migrate && pnpm db:seed`. The seed provisions `al-noor` (Asia/Riyadh) and `lindenhof` (Europe/Berlin) as their own databases and keeps a migrated `practice_template` for test fixtures; `docker compose exec db psql -U postgres -lqt` then lists `medibooker_platform`, the two `practice_…` databases and the template. `pnpm db:reset` starts over (local and CI only). Then `pnpm dev` (API on 3001, web on 3000 with the development rewrite). The full stack, also after `pnpm db:seed`: `docker compose --profile app up --build --wait`, then <http://localhost:8080>. The mobile app: `pnpm --filter @medibooker/mobile start`.

## 3. GitHub Actions

### Branch model and triggers

- **Default branch `v2-planning`** (user action U2). GitHub runs `schedule` and `workflow_dispatch` workflows only from the default branch, and Renovate reads its configuration only there; with `main` as default, the weekly scans, the deploy placeholder and Renovate would not work for v2. `main` keeps v1 until v2 is merged; then `main` becomes the default again.
- A ruleset on `v2-planning` blocks force pushes and deletion. The main agent pushes one commit per roadmap item directly; Renovate works through pull requests, which need a green `ci-ok`.
- `ci.yml` runs on `push` to `v2-planning` and `main`, on tags `v*`, on `pull_request` and on `workflow_dispatch`. Concurrency group `ci-${{ github.workflow }}-${{ github.ref }}`, cancelled in progress only for pull requests.

### Workflows

| File | Trigger | Content |
|---|---|---|
| `ci.yml` | push, pull request, dispatch | the jobs below |
| `codeql.yml` | push, pull request, weekly | CodeQL `javascript-typescript` with `security-extended`; ignores `**/generated/**` |
| `scheduled.yml` | weekly, dispatch | gitleaks over the full history with the newest rules, `pnpm audit --prod --audit-level=high`, `expo-doctor` with the React Native Directory check (not blocking) |
| `deploy.yml` | dispatch | the placeholder of §6 |
| `visual-baselines.yml` | dispatch (from X06) | runs the `@visual` tests inside `mcr.microsoft.com/playwright:v1.64.1-noble` with `--update-snapshots` and uploads the PNGs |
| `mobile-device.yml` | nightly, dispatch (X10) | Android emulator with Maestro flows; not a required check |
| `eas-build.yml` | dispatch (REL01) | EAS preview and production builds |

### ci.yml jobs

| Job | Since | Needs | Permissions | Steps |
|---|---|---|---|---|
| `quality` | F02 | — | `contents: read` | setup (installs gitleaks 8.30.1 with a checksum check, so the rule test runs under `CI=true`) → `pnpm format:check` → `pnpm dedupe --check` → `pnpm turbo run lint lint:root typecheck typecheck:root test test:root build` (coverage gates, JUnit reports, a package with 0 tests fails) → from F04 `db:generate` without any database variable and `pnpm check:migrations` → from X02 `pnpm check:drift` → from F07 `expo export`, `expo install --check`, `expo-doctor` and the one-React check → actionlint and the pinned `renovate-config-validator` → upload reports (`if: always()`) → save the Turbo cache (push to `v2-planning` only) |
| `security` | F02 | — | `contents: read`, `security-events: write` | checkout with `fetch-depth: 0` → the `.gitleaksignore` pin check against `ACCEPTED_FINGERPRINTS`, failing closed (§4) → gitleaks with `.gitleaks.toml` on the pushed range (`--log-opts="<before>..<sha>"`; for a new branch, whose `before` is the zero SHA, `origin/v2-planning..<sha>`), `--redact --ignore-gitleaks-allow --exit-code 1`, SARIF output → upload only the redacted SARIF → self-test: an `AKIA` key and a `password = "…"` line, both generated at run time with `node -e` and `crypto.randomBytes`, piped into `gitleaks stdin --redact`, must exit 1 → `pnpm audit --prod --audit-level=high` |
| `secrets-history` | F02 | — | `contents: read`, `security-events: write` | checkout with `fetch-depth: 0` → gitleaks over the full history with `.gitleaks.toml` and `.gitleaksignore` (the two accepted v1 findings, §4), `--redact --ignore-gitleaks-allow --exit-code 1`, redacted SARIF |
| `sbom` | F02 | — | `contents: write` | `pnpm sbom --sbom-format spdx --lockfile-only --out sbom.spdx.json` → `advanced-security/spdx-dependency-submission-action` → `dependency-review-action` with `fail-on-severity: high` and `retry-on-snapshot-warnings: true` (on push with `base-ref: github.event.before`, skipped when that is the zero SHA) |
| `integration` | F04 | — | `contents: read` | setup → `pnpm test:integration`: both migration sets and their drift, provisioning, credentials and both barriers, TLS, the connection manager under concurrency, the status table, the migration runner and its recovery, the isolation and cross-practice specs, constraints and concurrency, the server-log checks |
| `e2e-web` | F06; databases and API from P03 | — | `contents: read` | setup → from P03 `cp .env.example .env` with CI-only synthetic passwords generated at run time → `docker compose up -d --wait db` → `pnpm db:migrate && pnpm db:seed` (platform database, the two seeded practice databases, the template) → cache `~/.cache/ms-playwright` → `playwright install --with-deps chromium webkit` → `pnpm turbo run test:e2e -- --grep-invert @quarantine` → upload `playwright-report` and JUnit (`if: always()`, synthetic data only, 7 days) |
| `images` | F05; web from F06 | `quality` | `contents: read` | `docker/setup-buildx-action` → `docker/bake-action` with `load: true` and `cache-from`/`cache-to: type=gha,mode=max,scope=api` (`scope=web`) → Trivy per image → size budgets → setup, `cp .env.example .env` with generated passwords, `docker compose up -d --wait db`, `pnpm db:migrate && pnpm db:seed` from the runner, as on a developer machine → `docker compose --profile app up -d --wait --no-build` (the `migrate` service must exit 0 on the seeded database) → `docker compose run --rm migrate migrate all` a second time exits 0 → curl `/health/ready` on the API container, `/healthz` and `/ar` through the proxy → from P02 `/api/v1/public/practices/al-noor` through the proxy and throttling with forged `X-Forwarded-For` headers → from F06 Playwright `@smoke` and axe against <http://localhost:8080> → from P03 `robots.txt` of the same web image under `APP_ENV=local` and `APP_ENV=staging` → `docker compose down -v` |
| `publish` | F05 | `quality`, `security`, `secrets-history`, `sbom`, `integration`, `e2e-web`, `images` | `contents: read`, `packages: write`, `id-token: write`, `attestations: write` | only on push to `v2-planning` or `main` and on tags `v*`; `concurrency: publish-${{ github.ref }}` without cancelling → GHCR login → `docker/metadata-action` → bake with `push: true`, `sbom: true`, `provenance: mode=max` from the warm cache → `actions/attest-build-provenance` per image digest |
| `ci-ok` | F02 | every other job | none | `if: always()`; fails when a needed job failed or was cancelled. The only required status check |

Trivy settings: action `aquasecurity/trivy-action` v0.36.0 with `version: v0.76.1` (from a `TRIVY_VERSION` variable with a Renovate comment), `scanners: vuln,secret`, `severity: CRITICAL,HIGH`, `ignore-unfixed: true`, exit code 1. A `.trivyignore` entry needs a reason and an expiry date. Trivy runs in `images`, which holds no write token.

### Common rules

- Every action is pinned to a full commit SHA with a version comment. gitleaks and actionlint run as digest-pinned containers (`docker://ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:…` in `security` and `secrets-history`, `docker://rhysd/actionlint:1.7.12@sha256:…` in `quality`), so Renovate can update them; the setup action installs the gitleaks binary with its checksum for the test run.
- `actions/checkout` with `persist-credentials: false` everywhere.
- Top-level `permissions: contents: read`; jobs elevate only what they need. `packages: write`, `id-token: write` and `attestations: write` exist only in `publish`, which runs no package install.
- `runs-on: ubuntu-26.04` (`ubuntu-24.04` is the documented fallback); `timeout-minutes` on every job; `LEFTHOOK=0`; telemetry off (`TURBO_TELEMETRY_DISABLED`, `NEXT_TELEMETRY_DISABLED`, `EXPO_NO_TELEMETRY`, `CHECKPOINT_DISABLE`).
- `.github/actions/setup/action.yml`: `pnpm/action-setup` (version from `packageManager`), `actions/setup-node` with `node-version-file: .node-version` and `cache: pnpm`, the gitleaks binary, restore of the Turbo cache, `pnpm install --frozen-lockfile`. The install verifies the lockfile against `minimumReleaseAge` and `trustPolicy`, and unreviewed build scripts fail here.
- Turbo cache key `turbo-${{ runner.os }}-${{ github.job }}-${{ github.sha }}` with a restore prefix per job. Only `quality` saves it, and only on push to `v2-planning` (`actions/cache/save`), so pull requests cannot poison it. After F06, review the 10 GB repository cache under Settings → Actions → Caches (Turbo, the pnpm store and the BuildKit layers share it).
- Jobs that pull images log in to Docker Hub with a read-only token when `DOCKERHUB_TOKEN` is set (U6) and pull anonymously otherwise.

## 4. Secret scanning

| Layer | When | Tool | Fails |
|---|---|---|---|
| `pre-commit` hook (F01) | every commit | gitleaks staged scan with `.gitleaks.toml` | on a finding, and when gitleaks is missing; from F02 also when `.gitleaksignore` differs from the pinned list |
| `pnpm verify` (F01) | before every commit | the same staged scan | the same |
| GitHub push protection (U3) | every push | provider patterns, plus non-provider patterns when the plan offers them | on a finding |
| CI `security` (F02) | every push and pull request | the `.gitleaksignore` pin check, gitleaks on the pushed range, redacted SARIF, plus the self-test | on a finding, and when `.gitleaksignore` differs from the pinned list; required |
| CI `secrets-history` (F02) | every push and pull request | gitleaks over the full history with `.gitleaksignore`, redacted SARIF | on a finding; required |
| CI `quality` (F02) | every push and pull request | `scripts/gitleaks-config.test.ts` against the real binary | when the custom rule stops reporting its fixtures |
| `scheduled.yml` (F02) | weekly | gitleaks over the full history with the newest rules | reports |
| `images` job (F05) | every push | Trivy secret scanner inside the images | on a finding |

- There is no pre-push hook: the pre-commit scan covers every commit, and CI is the hard gate (ADR 0006, decision 9).
- `.gitleaks.toml` extends the default rules with the password-assignment rule; its fixtures are generated in a temporary directory at test time, so there is no allowlisted fixture path.
- Every scan, local and in CI, uses the options of `policyArguments()` (`scripts/lib/gitleaks.ts`): `--redact` and `--ignore-gitleaks-allow`, so an inline `gitleaks:allow` comment silences nothing ([01 §2](01-repo-and-tooling.md#git-editor-and-hooks)).
- The git history holds two findings of the removed v1 API, both added in commit `0011060` (2024-07-13): the v1 database credential in `MediBooker-ApI/dev.env` and `MediBooker-ApI/config/dbConfig.js`. The user declined to rotate it and accepted the risk on 2026-11-04 (U1 in [09](09-risks-and-decisions.md)).
- F02 therefore commits `.gitleaksignore` with exactly the commit-qualified fingerprints of these two findings, under a comment dated 2026-11-04 that names the decision, and `secrets-history` is required from F02 on. A commit-qualified fingerprint names its commit, file, rule and line, so the same secret in any new commit is reported. A commit-less entry (`file:rule:line`) would silence that finding in every commit, also in the staged scan.
- The file is pinned. gitleaks reads `.gitleaksignore` from the scan root whatever `--gitleaks-ignore-path` says, so the option cannot switch it off. F02 keeps the two fingerprints as the constant `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts`; `scripts/run-gitleaks.ts` (pre-commit hook and `pnpm verify`) and the `security` job fail closed when the non-comment lines of `.gitleaksignore` differ from it, with tests in `scripts/lib/gitleaks.test.ts`.
- A live secret is never added to `.gitleaksignore`; the U1 credential is the only accepted exception. Any other finding is rotated first; if it already reached the pushed history, its commit-qualified fingerprint is then added with a dated comment that names the rotation, in a commit the security-reviewer approves, which also updates the pinned list. A new finding in the v1 history (commits before L00), for example after a gitleaks upgrade or a rule change, goes to the user as a follow-up of U1 and needs a new dated user decision; so does re-recording the two U1 findings after a rule rename.
- Database credentials of practices never exist in the repository or in images: provisioning generates them into the secret store (ADR 0005 §4); local ones derive from the synthetic `DEV_SECRET_SEED`.
- A leaked secret is rotated first; deleting it from the history is not enough.

## 5. Supply chain

- **pnpm:** `minimumReleaseAge: 1440` and `trustPolicy: no-downgrade` with `trustPolicyExclude: [lefthook@2.2.2]` and a dated comment (both F01, ADR 0006 decision 3); reviewed `allowBuilds`; every CI install verifies the lockfile against them.
- **Renovate** (`renovate.json`, Renovate GitHub App installed by the user, U4):

  ```json
  {
    "$schema": "https://docs.renovatebot.com/renovate-schema.json",
    "extends": ["config:best-practices", ":semanticCommits", "customManagers:githubActionsVersions"],
    "minimumReleaseAge": "3 days",
    "schedule": ["before 6am on monday"],
    "lockFileMaintenance": { "enabled": true },
    "osvVulnerabilityAlerts": true,
    "postUpdateOptions": ["pnpmDedupe"],
    "packageRules": [
      {
        "description": "Moved with the Expo SDK (npx expo install --fix); vulnerability PRs still open at once",
        "matchFileNames": ["apps/mobile/package.json"],
        "matchPackageNames": ["expo", "expo-*", "@expo/*", "react-native", "react-native-*", "@react-native/*", "@react-native-community/*", "@react-native-async-storage/*", "jest-expo", "eslint-config-expo", "test-renderer"],
        "dependencyDashboardApproval": true
      },
      {
        "description": "Pinned to the Expo SDK's React through pnpm overrides",
        "matchPackageNames": ["react", "react-dom", "@types/react", "@types/react-dom"],
        "dependencyDashboardApproval": true
      },
      { "description": "typescript-eslint 8.72 peer", "matchPackageNames": ["typescript"], "allowedVersions": "<6.1.0" },
      { "matchDepNames": ["node", "@types/node"], "groupName": "node runtime" },
      { "matchPackageNames": ["@types/node"], "allowedVersions": "<27" },
      { "description": "Rebuilt base images carry security patches", "matchUpdateTypes": ["digest", "pinDigest"], "minimumReleaseAge": null },
      { "matchPackageNames": ["prisma", "@prisma/client", "@prisma/adapter-pg"], "groupName": "prisma" },
      { "matchPackageNames": ["@nestjs/*"], "groupName": "nestjs" },
      { "matchPackageNames": ["next", "eslint-config-next"], "groupName": "next" },
      { "matchPackageNames": ["eslint", "@eslint/*", "typescript-eslint", "eslint-*"], "groupName": "eslint" },
      { "matchPackageNames": ["vitest", "@vitest/*", "vite"], "groupName": "vitest" },
      { "matchManagers": ["github-actions"], "groupName": "github-actions" },
      {
        "description": "A PostgreSQL major upgrade needs a pg_upgrade plan for every cluster",
        "matchDatasources": ["docker"],
        "matchPackageNames": ["postgres"],
        "matchUpdateTypes": ["major"],
        "enabled": false
      }
    ]
  }
  ```

  - Plus regex `customManagers` entries for the Renovate-annotated Testcontainers image constant (`// renovate: datasource=docker depName=postgres`), for the gitleaks version and checksum in the setup action, and from OPS02 for the pinned `postgresql-client-18` package of the migrate image (`deb` datasource on the PGDG repository).
  - F02 validates the file with a pinned `renovate-config-validator` in `quality`.
  - No `baseBranchPatterns` (the default branch is `v2-planning`) and no global `rangeStrategy`: exact pins come from `savePrefix: ''` and the catalog, and `engines` keeps its range.
  - `dependencyDashboardApproval` instead of `enabled: false`, because disabled packages also lose their vulnerability PRs.
  - Automerge stays off until required checks exist on `v2-planning`.
  - An urgent fix younger than pnpm's one-day gate needs a dated `minimumReleaseAgeExclude` entry in the same pull request.
- **Vulnerability gates:** `pnpm audit --prod --audit-level=high` on every push and weekly; Renovate's OSV alerts; the SPDX submission feeds GitHub's dependency graph, which cannot read pnpm 12's two-document lockfile otherwise, so Dependabot alerts and dependency review work; Trivy on images; CodeQL.
- **SBOMs and provenance:** BuildKit SBOM and provenance attestations on every published image; `actions/attest-build-provenance` artifact attestations; from REL01 a CycloneDX SBOM of the app (`pnpm sbom --sbom-format cyclonedx --sbom-type application --filter @medibooker/mobile`) attached to each release.

## 6. Image publishing and the deploy placeholder

- GHCR images `ghcr.io/mohamadalaskari/medibooker-api`, `…/medibooker-api-migrate` and `…/medibooker-web` (lowercase prefix written out, not derived from the repository owner). Package visibility is private (decision D5).
- Tags from `docker/metadata-action`: `sha-<7>` (immutable; deployments pin the digest), the branch name and semver on `v*` tags; OCI labels.
- Images are published only by the `publish` job, after every other job is green.

`deploy.yml` (F05):

- `workflow_dispatch` inputs `environment` (`staging` or `production`) and `git_sha`.
- `concurrency: { group: deploy-${{ inputs.environment }}, cancel-in-progress: false }`; one job bound to the GitHub Environment of the same name. `production` requires a reviewer (U5); on a private repository with GitHub Free, Pro or Team that gate does not exist, and the repository stays public for now (decision D4, option A, 2026-11-04).
- `permissions: contents: read, packages: read`; no `id-token` until OPS01 uses OIDC.
- Steps: resolve the three `sha-<7>` tags to digests with `docker buildx imagetools inspect`; run `gh attestation verify oci://ghcr.io/mohamadalaskari/<image>@<digest> --repo MohamadAlaskari/MediBooker-v1 --signer-workflow MohamadAlaskari/MediBooker-v1/.github/workflows/ci.yml` for each; print the plan to the job summary; end with `::notice::No deployment target configured (hosting decision open)`. No secrets.
- The plan, which OPS01 makes real:
  1. `medibooker-db migrate platform` as a one-off task in the target region and network (the databases are never reachable from a runner);
  2. `medibooker-db migrate practices`, the migration runner, as a one-off task; the deploy continues only when the summary shows every practice the runner migrates at the target version, or an operator accepts the listed failures (those practices answer 503 until fixed, ADR 0005 §6);
  3. the API by digest, then the web by digest;
  4. `medibooker-db verify` and the smoke test.
- One-off tasks run with the cloud identity the workflow assumes through OIDC, which `medibooker-db` records as the operator principal in `platform_audit_events` (ADR 0005 §5.2). `deploy.yml` reads only each task's exit code and JSON summary; it never streams task logs into GitHub Actions, whose logs are public while decision D4 stays at option A.

Rollback and migrations (ADR 0010, ADR 0005 §6):

- Rollback means redeploying the previous digests. The previous code runs on the newer schema, because every migration is an expansion.
- Every migration is compatible with the previous release (expand, then contract). Destructive steps (`DROP`, `RENAME`, type changes) carry a `-- contract` comment and ship one release after the code stopped using the object, and only when every practice the runner migrates has reached the previous release's version.
- From F04, `pnpm check:migrations` in `quality` and `verify` checks every `migration.sql` of both schemas: the atomic header with both `SET LOCAL` timeouts and the final `COMMIT;`, `-- contract` on destructive statements, and reviewed exceptions ([02 §9](02-api.md#9-prisma-schemas-and-conventions)).

## 7. Mobile release (REL01)

- `eas-build.yml` (`workflow_dispatch`, secret `EXPO_TOKEN`) builds the preview and production profiles; signing credentials stay in EAS.
- `eas.json` pins `node` and `pnpm` per profile; the app config needs no workspace build (it imports `@medibooker/i18n/locales.json`).
- EAS Update is enabled only after the DPO approves it or an in-region update server exists; then `runtimeVersion: { policy: 'fingerprint' }` blocks updates to incompatible binaries.
- Raising `minimumSupportedVersion` (`APP_MIN_VERSION_IOS`, `APP_MIN_VERSION_ANDROID`) is a documented step of every release that drops support for older apps.
