# Docker, CI and delivery

Images are built in CI and can be built locally with Docker Desktop. Hosting is open (CLAUDE.md), so delivery ends at a deploy placeholder behind a manual approval. Decisions are recorded in [ADR 0009](../adr/0009-ci-branch-model-and-supply-chain.md) (branch model, CI gates, supply chain; F02) and ADR 0010 (images and delivery; F05). The database lifecycle (one database per practice, provisioning, the migration runner) follows [ADR 0005](../adr/0005-multi-tenancy.md).

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

As built ([ADR 0010](../adr/0010-container-images-and-delivery.md)): two stacks in two files instead of one file with a profile, started through the control menu (`medibooker.cmd`, `medibooker.sh`, `scripts/medibooker.ts`).

- `compose.dev.yaml` (project `medibooker-dev`): `db` without a profile, so `pnpm db:up` starts only the database; profile `app` adds `migrate`, `seed`, `api` and `web` from the development image `infra/local/dev.Dockerfile`; profile `tools` adds the test containers `tools`, `integration` (with the Docker socket) and `e2e` (with Chromium). No bind mount of the sources: `docker compose watch` syncs changes.
- `compose.prod.yaml` (project `medibooker-prod`): `migrate`, `api`, `web` and `proxy` as in the table below, from the images of §1, and `db` extended from `compose.dev.yaml` without a published port. Profile `demo` adds `seed`, from the development image. The health links use the loopback ports 8081 (API) and 8082 (web), which publish the whole services past the proxy, until OPS01. The networks: `edge` for the proxy, the web app and the API, the internal `data` for the database, the API, `migrate` and `seed`. The proxy runs as uid 1000. This stack has no TLS and no backups: never real patient data.

The table below describes the services of `compose.prod.yaml` and `db`:

| Service | Profile | Image and settings |
|---|---|---|
| `db` | default | `postgres:18.6-trixie@sha256:bd5dfa494a5a259704365813dbfa5fa6b3e69be7348d43b547f540c730478583` (the image's multi-arch index digest; the integration tests pin the same image, and Renovate's `postgres` group moves both, §5), `command: ["postgres", "-c", "max_connections=200", "-c", "log_error_verbosity=terse", "-c", "log_parameter_max_length=0", "-c", "log_parameter_max_length_on_error=0"]` (the server log settings of ADR 0005 §4.10), port `127.0.0.1:5432`, `shm_size: 256mb`; `POSTGRES_PASSWORD`, `PLATFORM_OWNER_PASSWORD`, `PLATFORM_APP_PASSWORD`, `PROVISIONER_PASSWORD`, each `${…:?copy .env.example to .env}`; volumes `pgdata:/var/lib/postgresql` (PostgreSQL 18 expects the parent directory) and `./infra/local/postgres/init:/docker-entrypoint-initdb.d:ro`; health check `pg_isready -h 127.0.0.1 -U postgres` with `interval: 2s`, `retries: 30`, `start_period: 30s` |
| `migrate` | `app` | `medibooker-api-migrate:local`, `command: ["migrate", "all"]`; after `db` is healthy; `PLATFORM_MIGRATION_URL` with `platform_owner` at `db:5432`, `DATABASE_CLUSTER_ENDPOINTS: '{"local":"db:5432"}'`, `SECRET_STORE: dev`, `DEV_SECRET_SEED`, `APP_ENV: local`; `read_only: true`; `mem_limit` from the F05 measurement |
| `api` | `app` | `medibooker-api:local`; after `migrate` completed successfully; `PLATFORM_DATABASE_URL` with `platform_app` at `db:5432`, `DATABASE_CLUSTER_ENDPOINTS: '{"local":"db:5432"}'`, `SECRET_STORE: dev`, `DEV_SECRET_SEED`, `APP_ENV: local`, `TRUST_PROXY_HOPS: 1`; port 3001 |
| `web` | `app` | `medibooker-web:local`; `API_INTERNAL_URL=http://api:3001`, `PUBLIC_SITE_URL=http://localhost:8080`; tmpfs `/app/apps/web/.next/cache` |
| `proxy` | `app` | `caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee` with `infra/local/Caddyfile` on port 8080: `/api/*` → `api:3001`, everything else → `web:3000`; `/health*` is not routed; no access log; `/api/*` sets `X-Request-Id` itself (`header_up X-Request-Id {http.request.uuid}`), replacing any client value, so only a trusted hop chooses the request id ([02 §4](02-api.md#4-request-pipeline-and-core-abstractions)) |
| `mailpit` | `mail` (A02) | `axllent/mailpit:v1.33.0@sha256:…`, SMTP 1025, UI 8025 |

- `infra/local/postgres/init/01-cluster.sh` (LF) creates only cluster-level objects: the roles `platform_owner`, `platform_app` and `medibooker_provisioner` (`CREATEDB`, `CREATEROLE`, `ALTER ROLE … SET createrole_self_grant = 'set'`), and the database `medibooker_platform` owned by `platform_owner` with the builtin `C.UTF-8` locale, `CONNECT` revoked from `PUBLIC` and granted to `platform_app`. There is no group role for practices (ADR 0005 §4.1). Practice databases are never created by the init script; `medibooker-db provision` creates them as `medibooker_provisioner`, locally exactly as in production. The Testcontainers global setup prepares its cluster with this same file, and OPS01's `cluster bootstrap` does it in production.
- As built (F04): a bash script whose body runs in a subshell with `set -euo pipefail`, because the image's entrypoint runs it when it is executable and sources it otherwise (a git checkout may lose the mode). It requires `PLATFORM_OWNER_PASSWORD`, `PLATFORM_APP_PASSWORD` and `PROVISIONER_PASSWORD`; `psql` reads them with `\getenv`, never from its command line, and its session sets `log_statement = 'none'` and `log_min_error_statement = 'panic'`, so no role password reaches the server log, also in the Testcontainers cluster, which runs with `log_statement=all`. Each `PASSWORD` keyword and its psql variable stand on separate lines, because on one line the secret scan's password rule would read the variable name as a literal password.
- The health check connects over TCP: the image runs the init scripts against a temporary server that listens only on the Unix socket, so a socket check reports healthy before `01-cluster.sh` has finished and during the restart that follows.
- **One local environment file:** the root `.env`, copied from the root `.env.example`, which holds placeholders only (`changeme-…` values, which the gitleaks rule accepts). The API, both Prisma configs, `medibooker-db` and the e2e fixtures load it by path from the workspace root (the directory with `pnpm-workspace.yaml`), so `pnpm db:migrate` and the e2e fixtures get the same values as `pnpm dev` without Turborepo pass-through. `apps/api` has no `.env.example`; the web keeps `apps/web/.env` for `API_INTERNAL_URL` and `PUBLIC_SITE_URL` only. `docs/dev/getting-started.md` describes it (F04). Besides the API's variables it holds the compose passwords (`POSTGRES_PASSWORD`, `PLATFORM_OWNER_PASSWORD`, `PLATFORM_APP_PASSWORD`, `PROVISIONER_PASSWORD`) and the URLs of the database tools, each repeating its role's password ([02 §7](02-api.md#7-configuration)); the cluster keeps the passwords of its first start until `docker compose down -v` removes its volume.
- **Two addresses for one cluster:** host processes (`pnpm dev`, `pnpm db:migrate`, `pnpm db:seed`, the e2e fixtures) reach PostgreSQL at `127.0.0.1:5432`, which the first provisioning run registers for the cluster `local` from `PROVISIONER_DATABASE_URL` when no cluster exists; the `migrate` and `api` containers set `DATABASE_CLUSTER_ENDPOINTS` to `db:5432` for the same cluster id ([02 §5](02-api.md#5-data-layer-and-tenancy)).
- `api`, `web`, `migrate` and `proxy` run with `read_only: true`, tmpfs `/tmp`, `init: true`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]` and `pids_limit: 256`; `api` and `web` with `mem_limit: 512m`. `migrate` runs one Prisma CLI process per concurrently migrated practice, so its limit comes from F05's measurement of `migrate practices` with `MIGRATION_CONCURRENCY=4`. This is the run-time baseline OPS01 keeps.
- The compose image names equal the bake tags, so the CI smoke test runs exactly the images that get published.
- Local workflow: `cp .env.example .env`, then `pnpm db:up && pnpm db:migrate && pnpm db:seed`. The seed provisions `al-noor` (Asia/Riyadh) and `lindenhof` (Europe/Berlin) as their own databases and keeps a migrated `practice_template` for test fixtures; `docker compose -f compose.dev.yaml exec -T db psql -U postgres -lqt` then lists `medibooker_platform`, the two `practice_…` databases and the template (`-T`: no terminal, which Git Bash on Windows needs). `pnpm db:reset` starts over (local and CI only). Then `pnpm dev` (API on 3001, web on 3000 with the development rewrite). The full stack: the control menu ([getting-started.md](../dev/getting-started.md#run-everything-in-docker)). The mobile app: `pnpm --filter @medibooker/mobile start`.

## 3. GitHub Actions

### Branch model and triggers

- **Default branch `v2-planning`** (user action U2, done on 2026-11-05 before the F02 push). GitHub runs `schedule` and `workflow_dispatch` workflows only from the default branch, Renovate reads its configuration only there, and the dependency graph shows it; with `main` as default, the weekly scans, the deploy placeholder, Renovate and the dependency-graph view would not work for v2. `main` keeps v1 until v2 is merged; then `main` becomes the default again ([ADR 0009](../adr/0009-ci-branch-model-and-supply-chain.md)).
- Rulesets on `v2-planning`:
  - `v2-planning: no force push or deletion` (id 26587882, since 2026-11-05): the rules `deletion` and `non_fast_forward`, no bypass actors. Direct pushes stay allowed.
  - `v2-planning: ci-ok required` (id 26612252, created by the main agent on 2026-11-05 at about 12:21Z, after the first green `ci-ok` of the pushed F02 commit): the rule `required_status_checks` with `ci-ok` from the GitHub Actions integration (id 15368) and `strict_required_status_checks_policy: false`; bypass actor `RepositoryRole` 5 (the repository admin role) with `bypass_mode: always`, and `current_user_can_bypass` reads `always`. The main agent still pushes one commit per roadmap item directly, and Renovate works through pull requests, which need a green `ci-ok`. It is a ruleset of its own because a bypass covers its whole ruleset: in the first one, the admin bypass would also allow force pushes.
  - The effective rules on `v2-planning` are `required_status_checks`, `deletion` and `non_fast_forward`.
- **After the F02 push (2026-11-05):** `ci-ok` was green on `11a2113` (CI run 42025771881, all six jobs, `ci-ok` at 12:19:40Z); CodeQL gave 0 results and 0 open alerts, so nothing was dismissed, and code scanning holds the analyses `CodeQL`, `gitleaks-range` and `gitleaks-history`, each with 0 results; `scheduled.yml` ran once by hand (below); the `sbom` job's SPDX snapshot was submitted, and the dependency graph's SBOM lists 1220 packages.
- `ci.yml` runs on `push` to `v2-planning` and `main`, on tags `v*`, on `pull_request` and on `workflow_dispatch`. Concurrency group `ci-${{ github.workflow }}-${{ github.ref }}`, cancelled in progress only for pull requests. No workflow uses `pull_request_target`.

### Workflows

| File | Trigger | Content |
|---|---|---|
| `ci.yml` | push (`v2-planning`, `main`, tags `v*`), pull request, dispatch | the jobs below |
| `codeql.yml` | push (`v2-planning`, `main`), pull request, weekly (Mondays 03:23 UTC) | CodeQL `javascript-typescript` with `build-mode: none`, `queries: security-extended` and the config `paths-ignore: ['**/generated/**']`; skipped for pull requests from forks. An advanced workflow: GitHub's default setup stays off, because it would block these uploads |
| `scheduled.yml` | weekly (Mondays 03:41 UTC), dispatch | job `secrets`: gitleaks over the full history with the rules of the pinned release (`node scripts/scan-secrets.ts history`, no SARIF); job `audit`: Node from `.node-version`, then `pnpm audit --prod --audit-level=high`; from F07 a non-blocking `expo-doctor` job with the React Native Directory check. Read-only; a failed run notifies the repository owner. After the F02 push, the main agent ran it once by hand (`gh workflow run scheduled.yml --ref v2-planning`, run 42026574852): both jobs were green at 12:22Z on 2026-11-05 |
| `deploy.yml` | dispatch | the placeholder of §6 |
| `visual-baselines.yml` | dispatch (from X06) | runs the `@visual` tests inside `mcr.microsoft.com/playwright:v1.64.1-noble` with `--update-snapshots` and uploads the PNGs |
| `mobile-device.yml` | nightly, dispatch (X10) | Android emulator with Maestro flows; not a required check |
| `eas-build.yml` | dispatch (REL01) | EAS preview and production builds |

### ci.yml jobs

| Job | Since | Needs | Permissions | Steps |
|---|---|---|---|---|
| `config-lint` | F02 | — | `contents: read` | checkout → Docker Hub login when `DOCKERHUB_TOKEN` is set (U6; see Common rules) → actionlint (`docker run` of `ACTIONLINT_IMAGE` on the read-only checkout, with `.github/actionlint.yaml`) → `renovate-config-validator --strict --no-global renovate.json` (`docker run` of `RENOVATE_IMAGE`) → `docker logout` (`if: always()`). The only job that references a secret, so it runs no repository or package code: no setup action, no install, no repository script |
| `quality` | F02 | — | `contents: read` | checkout → setup (installs gitleaks with a checksum check, so the rule test runs under `CI=true`) → `pnpm format:check` → `pnpm dedupe --check` → `pnpm turbo run lint lint:root typecheck typecheck:root test test:root build` (coverage gates, JUnit reports, a package with 0 tests fails; `test:root` includes `scripts/ci-config.test.ts`, which checks the rules of this section) → `pnpm --filter @medibooker/api db:generate` (F04; the job sets no database variable, so this proves that `prisma generate` needs none) → `pnpm check:migrations` (F04, as in `pnpm verify`) → from X02 `pnpm check:drift` → from F07 `expo export`, `expo install --check`, `expo-doctor` and the one-React check → upload the reports and the coverage (`if: always()`) → save the Turbo cache (push to `v2-planning` only, when every step succeeded) |
| `security` | F02 | — | `contents: read`, `security-events: write` | checkout with `fetch-depth: 0` → Node from `.node-version` → the gitleaks action → `node scripts/scan-secrets.ts pin`: the `.gitleaksignore` pin check against `ACCEPTED_FINGERPRINTS`, failing closed (§4) → `scan-secrets.ts range --sarif gitleaks-range.sarif`: the pin check again, then gitleaks over the commits of this push or pull request (§4) → upload the redacted SARIF (category `gitleaks-range`; not for a fork's pull request) → `scan-secrets.ts self-test`: two secrets generated at run time must be reported by their rules and redacted (§4) → pnpm, without an install → `pnpm audit --prod --audit-level=high` |
| `secrets-history` | F02 | — | `contents: read`, `security-events: write` | checkout with `fetch-depth: 0` → Node → the gitleaks action → `scan-secrets.ts history --sarif gitleaks-history.sarif`: the pin check, then gitleaks over the full history (every branch and tag) with `.gitleaksignore` (the two accepted v1 findings, §4) → upload the redacted SARIF (category `gitleaks-history`; not for a fork's pull request) |
| `sbom` | F02 | — | `contents: write` | checkout → pnpm → Node, without an install, install scripts or a cache → `pnpm sbom --sbom-format spdx --lockfile-only --out sbom.spdx.json` → `advanced-security/spdx-dependency-submission-action` with `filePath: .` and `filePattern: sbom.spdx.json` (not for a fork's pull request) → `dependency-review-action` with `fail-on-severity: high` and `retry-on-snapshot-warnings: true`: on a pull request from this repository without refs (the action reads them from the event); on a push with `base-ref: ${{ github.event.before }}` and `head-ref: ${{ github.sha }}`, skipped when `before` is empty or all zeros (a new branch or tag); not on dispatch |
| `integration` | F04 | — | `contents: read` | `timeout-minutes: 30`; `TESTCONTAINERS_RYUK_DISABLED: 'true'` (Common rules, Docker Hub) → checkout → setup → `pnpm test:integration`: both migration sets and their drift, the platform schema, provisioning, credentials and both barriers, TLS, the connection manager under concurrency and its memory per client, the status table, the migration runner and its recovery, the seed and the `./testing` exports, readiness, the isolation specs, the server-log checks; later items add the cross-practice, constraint and concurrency specs. It references no secret: Testcontainers pulls the digest-pinned PostgreSQL image anonymously |
| `e2e-web` | F06; databases and API from P03 | — | `contents: read` | setup → from P03 `cp .env.example .env` with CI-only synthetic passwords generated at run time → `docker compose up -d --wait db` → `pnpm db:migrate && pnpm db:seed` (platform database, the two seeded practice databases, the template) → cache `~/.cache/ms-playwright` → `playwright install --with-deps chromium webkit` → `pnpm turbo run test:e2e -- --grep-invert @quarantine` → upload `playwright-report` and JUnit (`if: always()`, synthetic data only, 7 days) |
| `images` | F05; web from F06 | `quality` | `contents: read` | `docker/setup-buildx-action` → `docker/bake-action` with `load: true` and `cache-from`/`cache-to: type=gha,mode=max,scope=api` (`scope=web`) → Trivy per image → size budgets → setup, `cp .env.example .env` with generated passwords, `docker compose up -d --wait db`, `pnpm db:migrate && pnpm db:seed` from the runner, as on a developer machine → `docker compose --profile app up -d --wait --no-build` (the `migrate` service must exit 0 on the seeded database) → `docker compose run --rm migrate migrate all` a second time exits 0 → curl `/health/ready` on the API container, `/healthz` and `/ar` through the proxy → from P02 `/api/v1/public/practices/al-noor` through the proxy and throttling with forged `X-Forwarded-For` headers → from F06 Playwright `@smoke` and axe against <http://localhost:8080> → from P03 `robots.txt` of the same web image under `APP_ENV=local` and `APP_ENV=staging` → `docker compose down -v` |
| `publish` | F05 | `config-lint`, `quality`, `security`, `secrets-history`, `sbom`, `integration`, `e2e-web`, `images` | `contents: read`, `packages: write`, `id-token: write`, `attestations: write` | only on push to `v2-planning` or `main` and on tags `v*`; `concurrency: publish-${{ github.ref }}` without cancelling → GHCR login → `docker/metadata-action` → bake with `push: true`, `sbom: true`, `provenance: mode=max` from the warm cache → `actions/attest-build-provenance` per image digest |
| `ci-ok` | F02 | every other job (today `config-lint`, `quality`, `security`, `secrets-history`, `sbom`, `integration`, `e2e-web`, `images`) | none (`permissions: {}`) | `if: always()`; prints the result of each needed job and fails unless every one is `success`: a failed, cancelled or skipped job fails it. The only required status check; its job id and name stay `ci-ok`, and every new job joins its `needs`, which `scripts/ci-config.test.ts` checks |

Trivy settings: action `aquasecurity/trivy-action` v0.36.0 with `version: v0.76.1` (from a `TRIVY_VERSION` variable with a Renovate comment), `scanners: vuln,secret`, `severity: CRITICAL,HIGH`, `ignore-unfixed: true`, exit code 1. A `.trivyignore` entry needs a reason and an expiry date. Trivy runs in `images`, which holds no write token.

### Common rules

- Every action is pinned to a full commit SHA with a `# vX.Y.Z` comment, every image to its tag and digest, every downloaded binary to its SHA-256 (the pins of 2026-11-05: [01 §5](01-repo-and-tooling.md#5-versions)). There are no `docker://` steps: the runner pulls their images in "Set up job", before any step, so a Docker Hub login can never apply to them, and in the gitleaks image `gitleaks git` would likely stop at git's "dubious ownership" check (ADR 0009, correction 2). gitleaks runs as the checksum-verified binary of the gitleaks action; actionlint and the Renovate validator run with `docker run` in steps of `config-lint`, from the `ACTIONLINT_IMAGE` and `RENOVATE_IMAGE` lines, which Renovate moves.
- `scripts/ci-config.test.ts` checks the rules of this section on every workflow and composite action, on every push and in `pnpm verify`: the SHA pins with their version comments and the image digests, no `docker://` step, no `pull_request_target`, `ubuntu-26.04` and `timeout-minutes` on every job, top-level `contents: read`, `persist-credentials: false` on every checkout, `fetch-depth: 0` in every job that runs the range or history scan, `ci-ok`'s needs, its `if` and its empty permissions, and that `config-lint` is the only job that references a secret.
- `actions/checkout` with `persist-credentials: false` everywhere.
- Top-level `permissions: contents: read`; jobs elevate only what they need: `security-events: write` in `security`, `secrets-history` and CodeQL's `analyze`; `contents: write` only in `sbom`, which runs no install and no package code; `ci-ok` has none. `packages: write`, `id-token: write` and `attestations: write` exist only in `publish`, which runs no package install.
- `runs-on: ubuntu-26.04`, generally available since 2026-09-17; never `ubuntu-latest`, which moves from 24.04 to 26.04 until 2026-11-19 (`ubuntu-24.04` is the documented fallback). actionlint 1.7.12 does not know the label, so `.github/actionlint.yaml` declares it under `self-hosted-runner.labels`; the file goes when an actionlint release knows it.
- `timeout-minutes` on every job; `bash` as the default shell; `LEFTHOOK=0`; telemetry off (`TURBO_TELEMETRY_DISABLED`, `NEXT_TELEMETRY_DISABLED`, `EXPO_NO_TELEMETRY`, `CHECKPOINT_DISABLE`).
- No `${{ }}` expression inside a `run:` script: event values reach a script as environment variables (for example `SCAN_BEFORE`). Secrets cannot appear in `if:`, so a step maps a secret to an environment variable and decides in its script. In `config-lint` and `security`, a check that does not depend on an earlier step runs with `if: ${{ !cancelled() }}`, so one run reports several failures at once.
- **A job that references a secret runs no repository or package code.** GitHub sends every secret that a job references to the runner when the job starts, and it stays in the runner's memory until the job ends, where code of any later step could read it (the technique of the tj-actions/changed-files compromise, CVE-2025-30066). Such a job therefore runs no setup action, no install and no repository script; today that is `config-lint` alone.
- Pull requests from forks get a read-only token: they skip the SARIF uploads, the SBOM submission, the dependency review and CodeQL. Every scan still runs and fails its job on a finding, so `ci-ok` stays meaningful. The fork condition (`github.event.pull_request.head.repo.full_name == github.repository`) is written out in each `if:`, because an environment variable could be overwritten through `GITHUB_ENV` by code that ran before. A pull request runs its own version of the scan scripts and of `ACCEPTED_FINGERPRINTS`, so a change to `scripts/`, `.gitleaks.toml`, `.gitleaksignore` or `.github/` needs the security-reviewer's approval (pull request template, §4).
- `.github/actions/setup/action.yml` (`quality` and, since F04, `integration` use it): `pnpm/action-setup` without a `version` input (it reads `packageManager`; setting both fails), `actions/setup-node` with `node-version-file: .node-version` and `cache: pnpm` (after pnpm, which the cache needs on `PATH`), the gitleaks action, restore of the Turbo cache, `pnpm install --frozen-lockfile`. The install verifies the lockfile against `minimumReleaseAge` and `trustPolicy`, and unreviewed build scripts fail here. `security`, `secrets-history` and `sbom` run no install.
- `.github/actions/gitleaks/action.yml` (used by the setup action, `security`, `secrets-history` and `scheduled.yml`): downloads the gitleaks release archive, checks its SHA-256 with `sha256sum --check --strict` before anything from it is used, checks `gitleaks version`, puts the binary on `PATH` and exports `GITLEAKS_VERSION`, an input of the `//#test:root` Turbo task, so a gitleaks upgrade reruns the rule test. `GITLEAKS_VERSION` and `GITLEAKS_SHA256` stay on adjacent lines: one Renovate custom manager moves them together (§5).
- Turbo cache key `turbo-${{ runner.os }}-${{ github.job }}-${{ github.sha }}` with a restore prefix per job. Only `quality` saves it, only on push to `v2-planning` and only when every step succeeded (`actions/cache/save`), so pull requests cannot poison it. After F06, review the 10 GB repository cache under Settings → Actions → Caches (Turbo, the pnpm store and the BuildKit layers share it).
- Test reports: every Vitest config writes `reports/junit.xml` (the root, `packages/eslint-config`, `apps/api`), also locally, because it is an output of the Turbo test tasks and a cached run restores it; the `reports/` folders of the root and the packages are gitignored, anchored to those places. Every Vitest config also enforces its coverage gate ([06 §8](06-testing.md#8-coverage-gates)). `quality` uploads the reports and the `coverage/` folders of the root, `packages/*` and `apps/*` as `test-reports-<run attempt>` with `if: always()`, kept for 7 days; they hold synthetic test data only.
- Docker Hub (U6): when the repository secret `DOCKERHUB_TOKEN` (a read-only token) is set, `config-lint` logs in with the account name from the repository variable `DOCKERHUB_USERNAME`, and it pulls anonymously otherwise; a token without the variable fails the step. The login is a `docker login --password-stdin` step (not `docker/login-action`, which keeps the token until its post step at the end of the job); the actionlint and Renovate containers see only the read-only checkout and no token, and `docker logout` follows (`if: always()`). In F02 only the actionlint image comes from Docker Hub; the Renovate image comes from GHCR. A later job that pulls from Docker Hub pulls anonymously or in a job that runs no repository code, by the rule above, and records the choice (ADR 0009 decision 9):
  - **F04, `integration`:** an anonymous pull. Testcontainers pulls `postgres:18.6-trixie` by digest inside test code, so the job references no secret and `config-lint` stays the only job with one. Testcontainers' cleanup container (ryuk) is an unpinned Docker Hub image, so the job sets `TESTCONTAINERS_RYUK_DISABLED: 'true'`: the global teardown stops the test container, and GitHub discards the runner after the job. Should anonymous pulls hit Docker Hub's limit, a separate job that runs no repository code pulls the image by digest with the token and hands it over (`docker save`, an artifact, `docker load` in `integration`), and `scripts/ci-config.test.ts` gets a rule for that second job with a secret.
  - **F05, `images`:** decided with F05.

## 4. Secret scanning

| Layer | When | Tool | Fails |
|---|---|---|---|
| `pre-commit` hook (F01) | every commit | `scripts/run-gitleaks.ts`: since F02 first the `.gitleaksignore` pin check, then the gitleaks staged scan with `.gitleaks.toml`, which reads no `.gitattributes` of the repository | on a finding; when gitleaks is missing, cannot start or logs an error; when `.gitleaksignore` differs from the pinned list (F02) |
| `pnpm verify` (F01) | before every commit | the same | the same |
| GitHub push protection (U3) | every push | provider patterns; non-provider patterns are off (a user setting) | on a finding |
| CI `security` (F02) | every push and pull request | `scripts/scan-secrets.ts pin`, `range` (the commits of the push or pull request, redacted SARIF) and `self-test` | on a finding, a scan error or a failed self-test, and when `.gitleaksignore` differs from the pinned list; required through `ci-ok` |
| CI `secrets-history` (F02) | every push and pull request | `scan-secrets.ts history`: the pin check, then the full history with `.gitleaksignore`, redacted SARIF | on a finding, a scan error or a pin mismatch; required through `ci-ok` |
| CI `quality` (F02) | every push and pull request | `scripts/gitleaks-config.test.ts` against the real binary (36 rule cases), and the tests of the scan scripts, which also run the scans on throw-away repositories (below) | when the custom rule stops reporting its fixtures or a scan-script test fails |
| `scheduled.yml` (F02) | weekly, dispatch | `scan-secrets.ts history` with the rules of the pinned gitleaks release; no SARIF | the run fails, and GitHub notifies the repository owner |
| `images` job (F05) | every push | Trivy secret scanner inside the images | on a finding |

- There is no pre-push hook: the pre-commit scan covers every commit, and CI is the hard gate (ADR 0006, decision 9).
- `.gitleaks.toml` extends the default rules with the password-assignment rule; its fixtures are generated in a temporary directory at test time, so there is no allowlisted fixture path.
- **One policy.** Every scan, local and in CI, uses the options of `policyArguments()` (`scripts/lib/gitleaks.ts`): `--config .gitleaks.toml`, `--redact` and `--ignore-gitleaks-allow`, so an inline `gitleaks:allow` comment silences nothing ([01 §2](01-repo-and-tooling.md#git-editor-and-hooks)), plus `--no-banner` and `--no-color`. The repository scans add `--platform none`, which skips gitleaks' lookup of the remote for links in findings (it logs an error for a remote URL it cannot parse), and name the repository as the scan root and the only place of `.gitleaksignore`.
- **One tool in CI.** Every CI scan goes through `scripts/scan-secrets.ts` (`pin`, `range`, `history`, `self-test`; `--sarif <file>` for `range` and `history`; exit code 2 for a wrong command line). It also runs locally ([getting-started.md](../dev/getting-started.md#secret-scanning)). The repository root is the directory above the script: no environment variable or option moves the root, the config or the ignore file.
- **What the scans see.** gitleaks' repository scans read `git log -p`, which prints no diff for a merge commit and only "Binary files differ" for a path that `.gitattributes` marks `-diff` or `binary`. `range` and `history` therefore add `--diff-merges=first-parent` (a merge commit's changes against its first parent) and `--text` (every file as text) after their revisions; `history` names gitleaks' own default revisions, `--full-history --all --diff-filter=tuxdb`, because any `--log-opts` replaces them. On 2026-11-05 the full history of the GitHub repository gave exactly the two accepted findings with these options (2.59 MB scanned instead of 2.26 MB). gitleaks' staged mode takes no git options, so every gitleaks run sets `GIT_ATTR_SOURCE` to the empty tree: git (2.40 or later) then reads no `.gitattributes` of the repository, and the staged scan diffs a `-diff` file as text too. An older git ignores the variable; there, the range scan in CI is the first to catch that case.
- **Failing closed.** Every mode that reads `.gitleaksignore` (`pin`, `range`, `history`) checks the pin first. `range` and `history` then refuse a shallow clone: they exit 1 unless `git rev-parse --is-shallow-repository` prints `false`, because `git log` in a shallow clone sees only the fetched commits, so a checkout without `fetch-depth: 0` would pass as a clean scan. A missing gitleaks, a start error, a signal, or a scan that logged an error exits 1: gitleaks 8.30.1 logs a failed `git log`, such as an unknown revision, at `ERR` and still exits 0 with "no leaks found", although it scanned nothing, so the scripts read its uncoloured log and fail on an `ERR` or `FTL` line. The hook's `scripts/run-gitleaks.ts` decides the same way.
- **The commits of the range scan** (`scripts/lib/scan-range.ts`, from the event values `GITHUB_EVENT_NAME`, `GITHUB_SHA`, `SCAN_BEFORE`, `SCAN_BASE_SHA` and `SCAN_HEAD_SHA`):

  | Event | Scanned commits |
  |---|---|
  | pull request | from its base to its head (`<base.sha>..<head.sha>`) |
  | push | from the branch's previous commit to the pushed one (`<before>..<sha>`) |
  | push of a new branch or tag (`before` all zeros) | the commits that `origin/v2-planning` does not have (`origin/v2-planning..<sha>`); those were scanned when they were pushed there |
  | force push (`before` not in the clone), dispatch, any other event, or any missing input | the full history of the commit under test |

  A missing input never skips the scan. An empty `before` counts as missing, not as a new branch: comparing with `origin/v2-planning` would scan nothing on a push to that branch itself. Only full object names reach git, so no input can become a git option.
- **Redacted SARIF only.** `range` and `history` write their SARIF with `--redact`; `security` and `secrets-history` upload it to code scanning with the categories `gitleaks-range` and `gitleaks-history`, never from a fork's pull request. The weekly scan uploads none.
- **The self-test** (`scan-secrets.ts self-test`): two secrets generated at run time with `node:crypto`, never written to a file or printed. One is an AWS access key id, `AKIA` and 16 different characters of `A-Z2-7` without `L`: different characters keep its entropy above the rule's minimum, and without `L` it can never contain `FALSE`, which gitleaks' global allowlist skips. The other is a `password = "…"` line whose value is one random group of four hex digits, three times, joined with hyphens: its entropy is too low for gitleaks' built-in `generic-api-key` rule, so only `medibooker-password-assignment` can report it, and the hyphens keep it out of gitleaks' global allowlist for a value of one repeated letter. gitleaks scans each over standard input in an empty temporary directory (so it reads no `.gitleaksignore`) and must exit 1, report exactly the case's rule id, and show the value nowhere, neither in its output nor in its JSON report, which proves `--redact`.
- **Proven in throw-away repositories** (`scripts/scan-secrets.test.ts` and `scripts/run-gitleaks.test.ts`, in `quality` on every push; with gitleaks missing they skip locally and fail in CI). They build git repositories whose commits hold secrets generated at run time, never printed: a pushed range that adds and removes a secret fails, the removal alone passes, and a `before` that the clone lacks scans the full history; the history scan fails and its SARIF names the rule but not the value; a secret that only a merge commit adds and one in a `-diff` file fail both scans; a staged secret in a `-diff` file blocks the hook; a shallow clone fails both scans before gitleaks runs; an empty repository, where gitleaks logs the failed `git log` and exits 0, fails; and a re-created `MediBooker-ApI/config/dbConfig.js` with a password on line 8 fails the pinned history scan and passes only with a commit-less entry. The repositories get no `GIT_*` variable of the caller and no user or system git configuration.
- The git history holds two findings of the removed v1 API, both added in commit `0011060` (2024-07-13): the v1 database credential in `MediBooker-ApI/dev.env` and `MediBooker-ApI/config/dbConfig.js`. The user declined to rotate it and accepted the risk on 2026-11-04 (U1 in [09](09-risks-and-decisions.md)).
- `.gitleaksignore` (F02) therefore holds exactly the commit-qualified fingerprints of these two findings, under a comment dated 2026-11-04 that names the decision and the rule for later entries; a redacted full-history scan confirmed both on 2026-11-05. `secrets-history` is required from F02 on. A commit-qualified fingerprint names its commit, file, rule and line, so the same secret in any new commit is reported: in a throw-away clone, a re-created `MediBooker-ApI/config/dbConfig.js` with a generated password on line 8, committed anew, fails the full-history scan. A commit-less entry (`file:rule:line`) would silence that finding in every commit, also in the staged scan.
- **The pin.** gitleaks reads `.gitleaksignore` from the scan root whatever `--gitleaks-ignore-path` says, so the option cannot switch it off. The constant `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts` holds the two fingerprints, and `scripts/run-gitleaks.ts` (pre-commit hook and `pnpm verify`) and every mode of `scan-secrets.ts` that reads the file fail closed unless its entries are exactly these two, each once:
  - the file is read the way gitleaks 8.30.1 reads it: lines end at `\n` and are trimmed with Go's whitespace set, and empty lines and `#` comments are skipped; a byte order mark stays in the first line, as in gitleaks, where it makes that line an entry;
  - a missing file, invalid UTF-8, a duplicate and an entry with a backslash path fail; an unexpected entry that does not look like a fingerprint is named by its line number only, in case it is a secret;
  - `scripts/lib/gitleaks.test.ts` covers a third entry, a commit-less entry and a changed fingerprint;
  - the hook checks the working-tree file, which is the one gitleaks reads there; CI checks the committed one;
  - `node scripts/scan-secrets.ts pin` runs the check on its own;
  - the pin compares two files of the same commit, so a change to both `.gitleaksignore` and `ACCEPTED_FINGERPRINTS` passes the hook and CI. It turns a widening into a reviewed code change, which the security-reviewer approves (pull request template); it cannot stop one.
- A live secret is never added to `.gitleaksignore`; the U1 credential is the only accepted exception. Any other finding is rotated first; if it already reached the pushed history, its commit-qualified fingerprint is then added with a dated comment that names the rotation, in a commit the security-reviewer approves, which also updates the pinned list. A new finding in the v1 history (commits before L00), for example after a gitleaks upgrade or a rule change, goes to the user as a follow-up of U1 and needs a new dated user decision; so does re-recording the two U1 findings after a rule rename.
- Database credentials of practices never exist in the repository or in images: provisioning generates them into the secret store (ADR 0005 §4); local ones derive from the synthetic `DEV_SECRET_SEED`.
- A leaked secret is rotated first; deleting it from the history is not enough.

## 5. Supply chain

- **pnpm:** `minimumReleaseAge: 1440` and `trustPolicy: no-downgrade` with `trustPolicyExclude: [lefthook@2.2.2]` and a dated comment (both F01, ADR 0006 decision 3), since F04 also `prisma@7.10.1` with its dated comment; reviewed `allowBuilds`; every CI install verifies the lockfile against them.
- **Renovate** (`renovate.json`, committed in F02; the file is the source of truth, and this section summarises it). The user installs the Renovate GitHub App for this repository (U4) only after U2, because Renovate reads its configuration from the default branch and would otherwise have onboarded against `main`; U2 was done on 2026-11-05.
  - `extends`: `config:best-practices`, `:semanticCommits` and `customManagers:githubActionsVersions`; `minimumReleaseAge: "3 days"`, longer than pnpm's one-day gate, so a Renovate pull request never fails the install; `schedule: ["before 6am on monday"]`; `lockFileMaintenance`; `osvVulnerabilityAlerts`; `postUpdateOptions: ["pnpmDedupe"]`.
  - Package rules: dashboard approval for the Expo-managed packages of `apps/mobile/package.json` (moved with `npx expo install --fix`) and for `react`, `react-dom` and their types (pinned to the Expo SDK's React through pnpm overrides); `typescript` held below 6.1.0 (typescript-eslint's peer) and `chokidar` below 6 (@swc/cli 0.8.2, ADR 0006); the `node runtime` group with `@types/node` below 27; digest updates of Docker images without a release age (rebuilt images carry security patches); a digest update of an action or a release asset, which means a moved tag or a replaced archive for an unchanged version, keeps the release age and needs dashboard approval (datasources `github-tags` and `github-release-attachments`); groups `prisma`, `nestjs`, `next`, `eslint` (without `eslint-config-next` and `eslint-config-expo`, which move with `next` and the Expo SDK), `vitest`, `github-actions`, `gitleaks` (CI's gitleaks and the developer install move in one pull request) and, since F04, `postgres` (the image of `compose.dev.yaml`, which Renovate's own docker-compose manager finds, and the Testcontainers constant move in one pull request); no PostgreSQL major upgrade, which needs a `pg_upgrade` plan for every cluster.
  - `ignorePaths` (F04) replaces the list that `config:best-practices` brings, without its `**/test/**`, which would hide the Testcontainers constant in `apps/api/test/integration/support/` from every manager; the other patterns stay. Today only that constant gives a dependency under a `test` folder.
  - Custom managers (`customType: regex`), only where something matches today; later items add theirs:

    | Manager | File | Matches | Datasource | Since |
    |---|---|---|---|---|
    | gitleaks in CI | `.github/actions/gitleaks/action.yml` | `GITLEAKS_VERSION: v…` followed by `GITLEAKS_SHA256: …` | `github-release-attachments` (`gitleaks/gitleaks`): the version and the SHA-256 of the archive move together | F02 |
    | CI images | `.github/workflows/*.yml` | `<NAME>_IMAGE: <image>:<tag>@sha256:<digest>` (today `ACTIONLINT_IMAGE` and `RENOVATE_IMAGE` in `ci.yml`) | `docker` | F02 |
    | developer gitleaks | `docs/dev/getting-started.md` | the two install lines `version=<x.y.z>` (Linux) and `$version = '<x.y.z>'` (Windows), which keep exactly this form | `github-releases` (`gitleaks/gitleaks`) | F02 |
    | Testcontainers image | `apps/api/test/integration/support/postgres-image.ts` | the comment `// renovate: datasource=docker depName=postgres`, then `export const POSTGRES_IMAGE = 'postgres:<tag>@sha256:<digest>';` (`prettier-ignore` keeps it on one line) | `docker`: the tag and the digest move together | F04 |
    | PostgreSQL client tools | the pinned `postgresql-client-18` package of the migrate image | | `deb` on the PGDG repository | OPS02 |

  - `config-lint` validates the file with the pinned `renovate-config-validator --strict --no-global renovate.json`. `--no-global`: given a file name, the validator would otherwise check it as Renovate's global self-hosted configuration, which accepts options that a repository configuration must not set; `--strict` also fails a configuration that needs migration. The validator checks the schema only. `scripts/ci-config.test.ts` checks that each custom manager still matches the lines it moves (the Testcontainers constant exactly once, by tag and digest, with the `docker` datasource and the dependency name `postgres`, and no `ignorePaths` pattern matching its file), and that the two install lines of `getting-started.md` name the version of the gitleaks action; that a manager moves a version and its checksum or digest together is first proven by Renovate itself after U4. For F04 a local Renovate dry run (`dryRun: lookup` with Renovate 44.212.0, on a copy whose two images were set back to an older tag) found the compose image and the constant and proposed the same tag and digest for both.
  - No `baseBranchPatterns` (the default branch is `v2-planning`) and no global `rangeStrategy`: exact pins come from `savePrefix: ''` and the catalog, and `engines` keeps its range.
  - `dependencyDashboardApproval` instead of `enabled: false`, because disabled packages also lose their vulnerability PRs.
  - Automerge stays off; once the `ci-ok` ruleset exists (§3), Renovate's pull requests need a green `ci-ok`.
  - An urgent fix younger than pnpm's one-day gate needs a dated `minimumReleaseAgeExclude` entry in the same pull request.
- **Vulnerability gates:**
  - `pnpm audit --prod --audit-level=high` on every push and pull request (`security`) and weekly (`scheduled.yml`), over the whole workspace. It reads the lockfile only and fails closed: no `--ignore-registry-errors`, and `pnpm audit --ignore` never runs in CI, because it writes to `pnpm-workspace.yaml`. The accepted moderate minimatch advisory (ADR 0006, Accepted risks) lies below the gate, so there is no `auditConfig.ignoreGhsas` entry.
  - Renovate's OSV alerts.
  - The SPDX submission feeds GitHub's dependency graph, which cannot read pnpm 12's two-document lockfile otherwise, so the dependency review works, and so do Dependabot alerts once the user turns them on (U12, optional; Dependabot's own update pull requests stay off, because Renovate opens them).
  - Trivy on images (F05); CodeQL (§3). CodeQL alerts fail no check yet: after every push the main agent lists the open alerts of `v2-planning` (`gh api "repos/MohamadAlaskari/MediBooker-v1/code-scanning/alerts?state=open&tool_name=CodeQL&ref=refs/heads/v2-planning"`) and triages each new one before the next item; an alert on the deliberate logging probes in `apps/api/test/support` is dismissed as "used in tests" with a reason. By F05, CodeQL becomes a job of `ci.yml` that `ci-ok` needs and that fails on any result, with reviewed exceptions only as dated `query-filters` (ADR 0009; deferred from F04, whose scope did not list it).
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
