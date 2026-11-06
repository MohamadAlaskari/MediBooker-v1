# MediBooker v2 — guide for Claude

MediBooker is an online appointment-booking platform for a medical practice (Arztpraxis). Patients book, reschedule and cancel appointments in a mobile app or on the web. Practice staff manage availability, appointments, patients and services in a web dashboard and see new bookings live.

v2 is a clean rebuild for a client. It keeps the idea of the university project v1 and fixes its architecture, security and UX. The v1 code (Angular client, Express API) was removed on 2026-11-02 and exists only in the git history; v2 shares no code with it. Never restore or copy v1 code; its security failures are the lessons in `health-data-security` §12.

Languages: **Arabic (default, right-to-left) and English**; more languages will follow. Target market: **not fixed** — country-specific rules (privacy law, data residency, insurance model, time zone, weekend, number format) are configuration per practice, not code.

## Repository layout

| Path | Content | Status |
|---|---|---|
| `.claude/agents/` | Project subagents (the team) | Active |
| `.claude/skills/` | Project skills (how we work) | Active |
| `docs/` | Product docs (`docs/product/`), architecture and roadmap (`docs/architecture/`), ADRs (`docs/adr/`), developer setup (`docs/dev/`) | Active |
| `packages/` | Shared configuration: `@medibooker/tsconfig` (TypeScript presets), `@medibooker/eslint-config` (ESLint presets and guardrail rules); `@medibooker/i18n` (locales, direction, negotiation); `@medibooker/design-tokens` (tokens from Figma, Tailwind stylesheet); `@medibooker/api-client` (generated client, `ApiError`, query client) | Active |
| `scripts/` | Repository scripts: commit-message check, staged secret scan, git-hook check, CI secret scans (`scan-secrets.ts`), CI-configuration test (`ci-config.test.ts`), generated-file check (`check-drift.ts`) | Active |
| `.github/` | GitHub Actions: workflows `ci.yml` (only required check `ci-ok`), `codeql.yml`, `scheduled.yml`; composite actions `setup` and `gitleaks`; actionlint config; pull request template. `renovate.json` sits at the root — `docs/adr/0009-ci-branch-model-and-supply-chain.md` | Active |
| `apps/` | `api` (NestJS 12, since F03), `db-migrate` (database CLI `medibooker-db`, since F04), `web` (Next.js, since F06); `mobile` (Expo) follows | Built feature by feature along `docs/architecture/08-roadmap.md` |

When v2 moves to its own repository, move `CLAUDE.md` and `.claude/` with it.

## Surfaces

- **Patient app**: React Native for iOS and Android. This is the main channel for patients.
- **Web**: React with Next.js. Public practice page (no sign-in, with free times), patient portal, and the practice dashboard (Praxis-Dashboard) for staff and admins.
- **API**: NestJS, REST plus realtime events.

## Tech stack status

| Area | Choice | Status |
|---|---|---|
| API | NestJS + TypeScript | Confirmed |
| Web | React + TypeScript | Confirmed |
| Mobile | React Native + TypeScript | Confirmed |
| Monorepo | pnpm workspaces + Turborepo | Proposed |
| Database / ORM | PostgreSQL + Prisma | Proposed |
| Mobile toolchain | Expo (Expo Router, EAS) | Proposed |
| Data fetching | Generated OpenAPI client + TanStack Query | Proposed |
| UI sharing | Separate component implementations per platform; shared tokens, i18n, API client, validation | Proposed |
| Web styling | Design tokens as CSS variables + Tailwind CSS v4 (required by shadcn/ui) | Confirmed (2026-11-01) |
| Web UI components | shadcn/ui on React Aria Components, RTL mode, source in `apps/web/src/components/ui` (managed with the shadcn CLI); shadcn variables mapped to our tokens; sonner toasts, lucide icons — `docs/adr/0007-web-ui-shadcn.md` | Confirmed (2026-11-01) |
| Animation | Web: GSAP + `@gsap/react` (`useGSAP`; ScrollTrigger/Flip only where needed), CSS transitions for simple states; app: react-native-reanimated (GSAP has no React Native support); shared motion tokens; reduced motion and RTL respected — `docs/adr/0008-animation-gsap.md` | Confirmed (2026-11-01) |
| Practice themes | Brand colour layer: presets (Teal default, Ocean, Indigo, Violet, Graphite) or any custom colour with automatic contrast adjustment; applies to app, portal, public page, e-mails and dashboard; status colours and the MediBooker logo fixed — `docs/adr/0002-practice-themes.md` | Confirmed (2026-11-01) |
| Realtime | Socket.IO through a NestJS gateway | Proposed |
| Web framework | Next.js (App Router), self-hosted Node.js container; public practice page server-rendered for search engines — `docs/adr/0003-web-framework-nextjs.md` | Confirmed (2026-11-01) |
| Auth | Built-in in the NestJS API: argon2id, short-lived JWT + rotating refresh token, TOTP for staff; e-mail address required in v1, sign-in by phone number later — `docs/adr/0004-authentication.md` | Confirmed (2026-11-01) |
| i18n | i18next with ICU messages (web + mobile); RTL via CSS logical properties / React Native I18nManager | Proposed |
| Fonts | Noto Sans Arabic (ar) + Inter (en), self-hosted | Proposed |
| Target market(s) | Not fixed: drives privacy law, data residency, insurance model | Open |
| Hosting | Region per target market (data residency); provider open | Open |
| Notifications | Push in the patient app; appointment messages per practice by e-mail only, SMS only, or both (SMS to verified phones only); account and security messages always by e-mail; WhatsApp later — see `docs/adr/0001-notification-channels-and-content.md` and `docs/product/notifications.md` | Channels confirmed (2026-11-01); providers Open (SMS provider not chosen) |
| Tenancy | Multi-practice SaaS: one platform, many practices; **one PostgreSQL database per practice** (platform database for accounts, practice registry and membership index) — `docs/adr/0005-multi-tenancy.md` | Confirmed (2026-11-02) |

Rules: use a **Proposed** choice as the default. Never change a **Confirmed** one on your own. For an **Open** item, present options with a recommendation and wait for a decision. Record decisions as ADRs in `docs/adr/` (template in the `architect` agent).

## Team: subagents

| Agent | Use it for |
|---|---|
| `architect` | Domain model, schema, API contract, ADRs, splitting a feature into tasks. Runs first for every feature. |
| `ui-designer` | Figma: design system, screens, flows, handoff |
| `backend-engineer` | NestJS API, Prisma, auth, booking logic, jobs, realtime |
| `web-engineer` | React web: patient portal and practice dashboard |
| `mobile-engineer` | React Native patient app |
| `qa-engineer` | Test strategy, unit/integration/e2e/a11y tests, test data |
| `security-reviewer` | Read-only security and privacy (GDPR-level) review. Required before merging anything that touches auth, personal or health data, realtime or infrastructure. |
| `devops-engineer` | Docker, CI/CD, environments, EU hosting, backups, monitoring, app builds |

The `feature-delivery` skill describes the workflow that connects them.

## Skills

| Skill | Content |
|---|---|
| `feature-delivery` | Gates from requirement to done, handoff format, Definition of Done |
| `medibooker-domain` | Glossary DE/EN, entities, business rules (BR-xx), roles and permissions, v1 behaviour |
| `health-data-security` | GDPR-level baseline for health data + country overlays, auth, authorization, encryption, logging, v1 lessons, review checklist |
| `api-contract` | OpenAPI-first rules, endpoint catalogue, errors, versioning, client generation |
| `design-system` | Tokens, typography, components, Figma structure, token-to-code mapping |
| `nestjs-feature` | Backend module recipe and checklist |
| `react-web-feature` | Web feature recipe and checklist |
| `react-native-screen` | Mobile screen recipe and checklist |

## Non-negotiables

1. Appointment data is health data (special category under GDPR Art. 9 and comparable laws in other markets): a booked service can reveal a condition. Follow `health-data-security` for every feature.
2. Every endpoint requires authentication by default. Authorization checks role and ownership. The user's identity comes from the verified token, never from the body or query.
3. No secrets in git. Configuration comes from validated environment variables.
4. Store times in UTC; show them in the practice's configured time zone (IANA, e.g. `Asia/Riyadh`, `Europe/Berlin`).
5. UI languages: Arabic (default, right-to-left) and English; more will follow. All strings go through i18n, every screen works in RTL and LTR, and adding a language needs only translation files.
6. Accessibility: WCAG 2.2 AA, touch targets of at least 44×44 pt, screen-reader and large-text support.
7. Colours, spacing, radii and type come only from design tokens. No hard-coded hex values in app code.
8. No feature is done without tests and, where required, a security review (Definition of Done in `feature-delivery`).
9. Only synthetic test data. Never real patient data in code, tests, fixtures, logs, screenshots or Figma.

## Design

Figma file: https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker (fileKey `8Ww6QyOO2Ni9kSfN6E5hNK`). Structure and names are in the `design-system` skill.

## Commands

Run from the repository root with Node 26.13.0 and pnpm 12.16.1; gitleaks (the version of the install lines in `docs/dev/getting-started.md`, which CI pins) must be on `PATH`. On this Windows machine `pnpm` on `PATH` is broken: run `npx --yes pnpm@12.16.1 <command>` instead (see `docs/dev/windows.md`).

| Task | Command |
|---|---|
| Install (also installs the git hooks) | `pnpm install` |
| Install exactly from the lockfile (CI) | `pnpm install --frozen-lockfile` |
| Lint (fails on any warning) | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Unit tests (Vitest) | `pnpm test` (run `pnpm test --force` once after installing gitleaks) |
| Format / check formatting | `pnpm format` / `pnpm format:check` |
| All checks before a commit, after `git add`: hook check, staged secret scan, formatting, lockfile dedupe check, migration check, lint, typecheck, tests with coverage gates, build, drift check | `pnpm verify` |
| Check the `.gitleaksignore` pin | `node scripts/scan-secrets.ts pin` |
| Scan the full git history for secrets, as CI does | `node scripts/scan-secrets.ts history` |
| Lint the workflows and validate `renovate.json` (Docker; before a commit that changes `.github/` or `renovate.json`) | commands in `docs/dev/getting-started.md` (images from `ACTIONLINT_IMAGE` and `RENOVATE_IMAGE` in `ci.yml`) |
| Create the local environment files (once; both are gitignored) | `cp .env.example .env` and `cp apps/web/.env.example apps/web/.env.local` |
| Dev servers (API on http://localhost:3001 with values from the root `.env`, web on http://localhost:3000) | `pnpm dev` |
| Start the local PostgreSQL (`compose.yaml`; Docker Desktop must run) | `pnpm db:up` |
| Apply all migrations (platform and every practice database) | `pnpm db:migrate` |
| Seed the synthetic practices | `pnpm db:seed` |
| Reset the local databases | `pnpm db:reset` |
| Integration tests (Docker, Testcontainers; run before a commit that changes database code) | `pnpm test:integration` |
| Web end-to-end tests in a real browser, against the production build (once: `pnpm --filter @medibooker/web exec playwright install chromium`) | `pnpm test:e2e` |
| Check the migration rules | `pnpm check:migrations` |
| Write the generated files: design tokens, the OpenAPI document `apps/api/openapi.json`, the API client (after a token, DTO or route change) | `pnpm generate` |
| Fail when a generated file differs from git | `pnpm check:drift` |
| Try the endpoints in the browser (`OPENAPI_UI_ENABLED=true`, dev server running) | http://localhost:3001/api/docs |
| Build | `pnpm build` |
| API tests with coverage | `pnpm --filter @medibooker/api test` |
| One package only | `pnpm --filter @medibooker/eslint-config test` |
| Ignore the Turborepo cache | `pnpm lint --force` |
| Reinstall missing or stale git hooks | `pnpm exec lefthook install` |

Commits follow Conventional Commits with a header of at most 72 characters; the `commit-msg` hook enforces it. Never use `--no-verify` or `LEFTHOOK=0` locally (`pnpm verify` fails while `LEFTHOOK` is `0` or `false` outside CI); inline `gitleaks:allow` comments are ignored. CI runs on GitHub Actions and `ci-ok` is the only required check; start the next roadmap item only after the pushed commit's `ci-ok` is green (`docs/architecture/08-roadmap.md`). Setup details: `docs/dev/getting-started.md`.
