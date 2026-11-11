# MediBooker v2 architecture

MediBooker v2 is a multi-practice SaaS for booking appointments at medical practices. Patients find free times on a public practice page, then book, reschedule and cancel in the patient app (React Native) or the patient portal (web). Staff manage availability, appointments, patients and services in the practice dashboard and see new bookings live. The UI is Arabic by default (right-to-left) and English; the target market is not fixed, so country rules are practice configuration. Appointment data is health data, and every part of the system follows the GDPR-level baseline in the `health-data-security` skill.

These documents describe the target architecture of the monorepo in this repository and the order in which it is built. They are binding for the agents in `.claude/agents/`: the skills in `.claude/skills/` describe how to work, these documents describe what to build.

## System overview

```text
Patient app (Expo, iOS/Android) ──────────────┐
                                              │ HTTPS, Bearer token
Browser ──► Web (Next.js: public page,        │
             portal, dashboard) ──────────────┤ same origin through the proxy, cookies + CSRF
                                              ▼
                                   API (NestJS, /api/v1)
                                    │   ├──► outbox worker (A02): e-mail, push, SMS providers
                                    │   └──► object storage and virus scanner (R02)
                                    │
                                    ├──► platform database: accounts, sessions, practice registry
                                    │    and routing, membership index
                                    └──► practice databases: one PostgreSQL database per practice,
                                         reached through the PracticeConnectionManager

medibooker-db (one-off tasks: provisioning, migration runner, backups) ──► platform and practice databases
```

- One deployment per market region: API, web, the platform database and a PostgreSQL cluster for the region's practice databases ([ADR 0005](../adr/0005-multi-tenancy.md)).
- Every practice has its own database and its own database roles; the platform database holds only what must exist outside a practice. A request reaches a practice database only after the practice is resolved from the path or the slug and the caller's access is checked.
- The API is the only way to patient data. Web and mobile call it only through the generated client `@medibooker/api-client`.
- The public practice page is rendered by the Next.js server; everything with personal or health data is fetched by client components and never cached.

## Decisions this architecture rests on

| ADR | Decision | Status |
|---|---|---|
| [0001](../adr/0001-notification-channels-and-content.md) | Notification channels and content | Accepted (channels); providers Open (D10), as in `CLAUDE.md` |
| [0002](../adr/0002-practice-themes.md) | Practice themes: presets and a checked custom colour | Accepted |
| [0003](../adr/0003-web-framework-nextjs.md) | Web framework: Next.js App Router, self-hosted | Accepted |
| [0004](../adr/0004-authentication.md) | Authentication built into the NestJS API | Accepted |
| [0005](../adr/0005-multi-tenancy.md) | Multi-tenancy: one platform, many practices, one PostgreSQL database per practice | Accepted (2026-11-02, decided by the client; revised 2026-11-04 before its first commit; accounts per deployment, reminder consent per practice and patient details per practice wait for D8 and D16) |
| [0006](../adr/0006-toolchain-and-version-policy.md) | Toolchain and version policy | Accepted; committed with F01. Builds on the Proposed toolchain rows of `CLAUDE.md`, which the client has not confirmed (U11) |
| [0007](../adr/0007-web-ui-shadcn.md) | Web UI components: shadcn/ui on React Aria | Accepted |
| [0008](../adr/0008-animation-gsap.md) | Animation: GSAP on the web, Reanimated in the app | Accepted |
| [0009](../adr/0009-ci-branch-model-and-supply-chain.md) | Branch model, CI gates and supply chain | Accepted (2026-11-05, F02; amended for F04) |
| 0010 | Container images and the two Docker stacks; delivery and the connection budget follow | Accepted; completed in F05 and OPS01 |
| 0011 | Error model (problem+json, codes, status policy) | Accepted |
| 0012 | Contract pipeline and committed generated code | Accepted |
| [0013](../adr/0013-i18n-binding.md) | i18n library binding: next-intl | Accepted (2026-11-06) |
| [0014](../adr/0014-time-handling.md) | Time handling: Temporal, practice zones, elapsed durations | Accepted (2026-11-06) |

The stack rows and their status (Confirmed, Proposed, Open) are in `CLAUDE.md`. A Proposed row is the default; a change to it needs a decision ([09](09-risks-and-decisions.md)).

## How these documents are organised

| File | Content |
|---|---|
| [01-repo-and-tooling.md](01-repo-and-tooling.md) | Repository layout, root tooling as built in F01, shared packages, conventions, version table |
| [02-api.md](02-api.md) | NestJS API: structure, request pipeline, the data layer with the platform and practice databases, the connection manager, provisioning and the migration runner, configuration, logging, Prisma, health, OpenAPI |
| [03-web.md](03-web.md) | Next.js web app: route groups, providers, API client, i18n and RTL, tokens and shadcn/ui, motion, CSP, error boundaries |
| [04-mobile.md](04-mobile.md) | Expo app: structure, navigation and practice selection, providers, i18n and RTL, theme, offline data, Metro in the monorepo |
| [05-errors-i18n-tokens.md](05-errors-i18n-tokens.md) | The error system end to end, i18n and RTL, design tokens, motion tokens and practice themes |
| [06-testing.md](06-testing.md) | Test pyramid, tools, naming, determinism, authorization and tenant-isolation tests, coverage gates, flaky tests |
| [07-docker-ci-cd.md](07-docker-ci-cd.md) | Dockerfiles and the migrate image, compose with the platform and practice databases, GitHub Actions, secret scanning, Renovate, image publishing, deploy order with the migration runner |
| [08-roadmap.md](08-roadmap.md) | Every roadmap item in order: scope, commit header, acceptance criteria, dependencies |
| [09-risks-and-decisions.md](09-risks-and-decisions.md) | Risks, the user's recorded decisions, user actions, decisions needed from the client, red-team decision log |

Each file covers one area and links to the others instead of repeating them. Product scope and screens are in `docs/product/`; local setup is in `docs/dev/` (F01).

## Roadmap status

| Item | Status |
|---|---|
| L00 Remove the v1 apps | Committed (`6c733c1`); the user removed the v1 folders on 2026-11-02 |
| R00 Architecture docs and decision records | Committed (`f89a019`) |
| F01 Monorepo workspace and shared tooling | Committed (`13044c5`) |
| F03 NestJS API skeleton | Committed (`f2b699e`) |
| F02 CI quality and security baseline | Committed (`11a2113`); the API skeleton (F03) came before CI (F02), as the user decided on 2026-11-04. Its post-push steps were done on 2026-11-05: `ci-ok` green, the `ci-ok` ruleset, the CodeQL triage, the first scheduled run |
| F04 Platform and practice data layer | Committed (`284776c`) |
| P01 and P02 Practice model and public practice endpoint | Committed (`b20f32c`): the first functional feature |
| X01 and X02 Error system and OpenAPI contract | Committed (`6bba58e`) |
| F06 Next.js web skeleton | Committed (`c80aa43`) |
| X05 and X03 Design tokens and generated API client | Committed (`099be7b`) |
| F05, first part: Docker images, dev and prod stacks, control menu | Committed (`027e10f`) |
| X04, X06, X07 and P03 Texts, web shell, first components and the public practice page | Committed (`8c1da1a`) |
| The sitemap with `GET /public/practices` | Committed (`54c9140`) |
| P04, P05 and P06 Slots from rules, the public free times, and the picker on the page | Committed (`c0dbca6`) |
| A01 (accounts and sessions), A02 (account e-mails) and A03 Sign-up, verification, reset, login, rotation and Mailpit | Committed (`22c0cd5`); memberships with B01 and A04 |
| A05 for patients The pages for signing up, confirming, signing in and out, and a new password; the account profile of D16 | Committed (`8d12915`, `b0e2f11`) and done; staff pages with A04 |
| B01 Patient profiles, insurance per practice, the membership index and its relay | Committed (`ddf90dd`) |
| B02 Booking an appointment with row locks and idempotency keys | Committed (`b9b2795`) |
| B03 for patients Cancel, reschedule and my appointments, also across practices | Committed (`447475e`); the staff half with M05 (`aadecdd`) |
| B04 Booking on the web: from a free time to an appointment, my appointments, cancel and reschedule | Committed (`628fd8e`) |
| F09 File storage: the port `ObjectStorage`, Azure Blob Storage, Azurite in development ([ADR 0015](../adr/0015-object-storage.md)) | Committed (`95e5b8e`) |
| I01 One installation per practice: its page at the root of its domain ([ADR 0016](../adr/0016-one-installation-per-practice.md)) | Committed (`f1af019`) |
| I02 The practice's brand: its name and colours on every page, "Powered by MediBooker", e-mails in its name | Committed (`7f2c8ac`) |
| A04 for the dashboard Staff roles, two-step sign-in with an authenticator app and recovery codes, the operator's role command, the dashboard's start | Committed (`d1aeeee`); invitations with M03, the rest later |
| M05, the team's day The day of the practice with its figures, an appointment with the patient's note, check-in, completion, no-show and a cancel with a reason, the dashboard's frame and its sign-out after 15 minutes | Committed (`aadecdd`) |
| M05, the team's lists The appointments of a week with filters, the patients with a search in Arabic and Latin letters however written, one patient's record | Committed (`0ab8005`) |
| M05, booking for a patient The team books on the phone and at the desk, also for a patient without an account | Committed (`09fc376`) |
| M05, the calendar One doctor's week: appointments, free and blocked times, absences | Committed (`e13b020`); M05 complete |
| M02, the practice's setup Services with texts per language, online booking and archive; the opening hours and special days of the public page | Committed (one commit) |
| Everything else | Planned, in the lean order of [08-roadmap.md](08-roadmap.md#order-since-2026-11-05-lean-mode): functional features first |

v1 was removed on 2026-11-02 and is in the git history; v2 shares no code with it. The v1 database credential in that history stays valid: the user declined to rotate it and accepted the risk on 2026-11-04 (U1 in [09](09-risks-and-decisions.md)). Since F02, `.gitleaksignore` holds its two findings, pinned to `ACCEPTED_FINGERPRINTS`, and the full-history secret scan is a required check ([ADR 0009](../adr/0009-ci-branch-model-and-supply-chain.md)).

## Where to start

| Agent | Read first |
|---|---|
| `backend-engineer` | ADR 0004 and 0005, 02, 05 (errors), 06 |
| `web-engineer` | 03, 05, 06, ADR 0003, 0007 and 0008 |
| `mobile-engineer` | 04, 05, 06, ADR 0005 §3 (practice selection) |
| `devops-engineer` | 01, 07, ADR 0005 (provisioning, migrations, backups), 0006 and 0009 |
| `qa-engineer` | 06, then the testing section of the app document |
| `security-reviewer` | ADR 0004, 0005 and 0009, 02 (data layer, logging), 07 (supply chain, secrets), 09 |
| `ui-designer` | 05 (tokens, motion), ADR 0002, 0007 and 0008 |
