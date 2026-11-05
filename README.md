# MediBooker

Online appointment booking for medical practices. Patients book, reschedule and cancel appointments in a mobile app or on the web. Practice staff manage availability, appointments, patients and services in a web dashboard and see new bookings live. Languages: Arabic (default, right-to-left) and English.

## Status

MediBooker v2 is under construction: one platform for many practices, with a NestJS API, a Next.js web app and an Expo (React Native) patient app. The monorepo tooling and the API skeleton are in place; the apps are built feature by feature along the [roadmap](docs/architecture/08-roadmap.md).

## Repository

| Path | Content |
|---|---|
| `apps/api` | NestJS API (skeleton: configuration, logging, request context, deny-by-default guard, health check) |
| `apps/web` | Next.js: public practice page, patient portal and practice dashboard (planned) |
| `apps/mobile` | Expo (React Native) patient app (planned) |
| `packages/` | Shared configuration: TypeScript presets, ESLint presets and guardrail rules |
| `scripts/` | Repository scripts: commit-message check, staged secret scan, git-hook check |
| `docs/product/` | Product documents and the feature catalogue |
| `docs/architecture/` | Architecture, roadmap, risks and decisions |
| `docs/adr/` | Architecture decision records |
| `docs/dev/` | Developer setup |

## Getting started

You need Node.js 26.13.0, pnpm 12.16.1 and gitleaks 8.30.1. Setup details, including notes for Windows, are in [docs/dev/getting-started.md](docs/dev/getting-started.md).

```sh
pnpm install            # installs dependencies and the git hooks
cp .env.example .env    # once: the local environment file (gitignored)
pnpm dev                # API on http://localhost:3001 (GET /health/live)
pnpm verify             # hook check, secret scan of staged files, formatting, lint, typecheck, tests and build
```

Commits follow Conventional Commits with a header of at most 72 characters. The git hooks check the commit message and scan staged files for secrets. Use only synthetic test data.

## History

v1 was a university project: an Angular client and an Express API with MySQL. It was removed from this repository on 2026-11-02 and exists only in the git history. v2 is a rebuild with different technology and features and shares no code with v1.
