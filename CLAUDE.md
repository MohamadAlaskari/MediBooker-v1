# MediBooker v2 — guide for Claude

MediBooker is an online appointment-booking platform for a medical practice (Arztpraxis). Patients book, reschedule and cancel appointments in a mobile app or on the web. Practice staff manage availability, appointments, patients and services in a web dashboard and see new bookings live.

v2 is a clean rebuild for a client. It keeps the idea of the university project v1 (the two legacy folders in this repo) and fixes its architecture, security and UX.

Languages: **Arabic (default, right-to-left) and English**; more languages will follow. Target market: **not fixed** — country-specific rules (privacy law, data residency, insurance model, time zone, weekend, number format) are configuration per practice, not code.

## Repository layout

| Path | Content | Status |
|---|---|---|
| `MediBooker/` | v1 web client (Angular 17, Bootstrap) | Legacy, read-only reference |
| `MediBooker-ApI/` | v1 API (Express, Sequelize, MySQL, ws) | Legacy, read-only reference. Contains known security flaws (see the `health-data-security` skill). Never copy code from it. |
| `.claude/agents/` | Project subagents (the team) | Active |
| `.claude/skills/` | Project skills (how we work) | Active |
| `docs/` | Product docs (`docs/product/`) and ADRs (`docs/adr/`) | Active |
| `apps/`, `packages/` | v2 monorepo | Not scaffolded yet (waiting for tech decisions) |

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
| Web styling | Design tokens as CSS variables (+ Tailwind CSS) | Proposed |
| Practice themes | Brand colour layer: presets (Teal default, Ocean, Indigo, Violet, Graphite) or any custom colour with automatic contrast adjustment; applies to app, portal, public page, e-mails and dashboard; status colours and the MediBooker logo fixed — `docs/adr/0002-practice-themes.md` | Confirmed (2026-11-01) |
| Realtime | Socket.IO through a NestJS gateway | Proposed |
| Web framework | Next.js (App Router), self-hosted Node.js container; public practice page server-rendered for search engines — `docs/adr/0003-web-framework-nextjs.md` | Confirmed (2026-11-01) |
| Auth | Built-in (argon2id, short JWT + rotating refresh token, TOTP for staff) vs. an identity provider (e.g. Keycloak) | Open |
| i18n | i18next with ICU messages (web + mobile); RTL via CSS logical properties / React Native I18nManager | Proposed |
| Fonts | Noto Sans Arabic (ar) + Inter (en), self-hosted | Proposed |
| Target market(s) | Not fixed: drives privacy law, data residency, insurance model | Open |
| Hosting | Region per target market (data residency); provider open | Open |
| Notifications | Push in the patient app; appointment messages per practice by e-mail only, SMS only, or both (SMS to verified phones only); account and security messages always by e-mail; WhatsApp later — see `docs/adr/0001-notification-channels-and-content.md` and `docs/product/notifications.md` | Channels confirmed (2026-11-01); providers Open (SMS provider not chosen) |
| Tenancy | One practice vs. multi-practice SaaS | Open |

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

Add install, dev, lint, typecheck, test, e2e and db migrate/seed commands here once the monorepo exists.
