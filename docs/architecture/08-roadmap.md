# Roadmap

The roadmap first commits the removal of the v1 apps (L00), then builds the foundation (docs, repository tooling, API, CI, the platform and practice databases, images, web, app), then the cross-cutting systems (errors, contract, client, i18n, tokens, UI kits), then the product in vertical slices: public practice page, accounts, booking, practice management, notifications, records, family, realtime, privacy, release and operations. The API skeleton (F03) comes before CI (F02): the user's decision of 2026-11-04. The IDs are stable; new items get new IDs (L00 is new with the removal of v1; OPS02 is new with the database-per-practice decision and runs before OPS01). F08 was merged into F02 when the user declined U1 on 2026-11-04. `U` and `D` references point to user actions and client decisions in [09](09-risks-and-decisions.md).

## Rules for every item

- **One item, one commit** with the given header (Conventional Commits, at most 72 characters, no final period; the `commit-msg` hook enforces it). The body follows [01 §4](01-repo-and-tooling.md#commits). The main agent commits and pushes to `v2-planning` and starts the next item only when the commit's `ci-ok` is green and no open CodeQL alert of `v2-planning` is untriaged (from F02; `gh api "repos/MohamadAlaskari/MediBooker-v1/code-scanning/alerts?state=open&tool_name=CodeQL&ref=refs/heads/v2-planning"`, [ADR 0009](../adr/0009-ci-branch-model-and-supply-chain.md) decision 6).
- **Order is dependency:** an item may use everything built by the items above it. The "Depends on" column lists only decisions and user actions that must exist first.
- **Before the commit:** `pnpm verify` is green (on this Windows machine `npx --yes pnpm@12.16.1 verify`; since F02 it includes `pnpm dedupe --check` and the CI-configuration test); when `.github/` or `renovate.json` changed, actionlint and `renovate-config-validator --strict --no-global` with the images that `ci.yml` pins pass too ([getting-started.md](../dev/getting-started.md#continuous-integration), Docker Desktop); from F04 also `pnpm test:integration` when database code changed; from X02 on, `pnpm generate` has run when DTOs, tokens or messages changed. A pushed commit cannot be amended (ruleset `non_fast_forward`), so a check that only CI runs would cost a second commit.
- **Definition of Done** from the `feature-delivery` skill: tests, the 401/403/404/200 matrix for every new endpoint (from A01), the cross-practice 404 for every practice-scoped endpoint (from P02), the security review where the skill requires it, docs and ADRs updated.
- **Skills and agent files** that describe the touched area are updated in the same commit, so the next agent does not build what this plan rejected. Items name the check where a convention changes.
- **Scope discipline:** an item does not repeat work of an earlier item; F01 is the committed scaffold (`13044c5`) and the base for everything else.

## Order since 2026-11-05 (lean mode)

The user's decision of 2026-11-05. It replaces the order of the overview, whose numbers stay; "order is dependency" applies to this order.

- Functional features first; a foundation item only when the next feature needs it. Related items may share one commit (`+` below). About one hour per item.
- New order: P01+P02 (`b20f32c`), X01+X02 (`6bba58e`), F06 (`c80aa43`), X05+X03 (`099be7b`), the Docker part of F05 (`027e10f`, the user's request of 2026-11-06), X04+X06+X07+P03 (`8c1da1a`), the sitemap (`54c9140`), P04+P05+P06 (`c0dbca6`), the accounts and sessions of A01 with the account e-mails of A02 and A03 (`22c0cd5`), the pages of A05 for patients (`8d12915`), the account profile of D16 (`b0e2f11`), a real mail server for the stacks (`dc6bd58`), the patient profiles of B01 (`ddf90dd`), booking through the API with B02 (`b9b2795`), the patient half of B03 (`447475e`), booking on the web with B04 (`628fd8e`), the file storage of F09 (`95e5b8e`), the user's request of 2026-11-07, one installation per practice with I01 (`f1af019`) and I02 (`7f2c8ac`), the user's decision of 2026-11-10 ([ADR 0016](../adr/0016-one-installation-per-practice.md)), the staff part of A04 that the dashboard needs (this commit), then M05, M02 and M04, then the other booking items and all later ones as listed. The rest of F05 moves to just before OPS01; F07, X08, X09 and X10 move to just before A06.
- Scope moves, each with its acceptance checks: X02's app-config endpoint → X08; `@PublicCache` → P05; ADR 0012 → X03; X03's mobile typecheck acceptance → F07; F06's web Dockerfile, compose `web` and `proxy` services and `images` job changes → F05; P03's checks that need F05 → F05.

## Overview

| # | ID | Title | Commit header | Depends on | Status |
|---|---|---|---|---|---|
| 1 | L00 | Remove the v1 apps | `chore(repo): remove the v1 apps` | - | committed (`6c733c1`) |
| 2 | R00 | Architecture docs and decision records | `docs: add architecture docs and record tenancy and UI decisions` | - | committed (`f89a019`) |
| 3 | F01 | Monorepo workspace and shared tooling | `chore(repo): scaffold pnpm workspace, Turborepo and shared tooling` | - | committed (`13044c5`) |
| 4 | F03 | NestJS API skeleton | `feat(api): add NestJS 12 skeleton with config, logging and context` | - | committed (`f2b699e`) |
| 5 | F02 | CI quality and security baseline | `ci: add GitHub Actions gates, secret scans and logging lint rules` | U2, U3 | committed (`11a2113`) |
| – | F08 | Full-history secret scan as a required check | – | – | merged into F02 (U1 declined, 2026-11-04) |
| 6 | F04 | Platform and practice data layer | `feat(api): add per-practice databases with provisioning and runner` | - | committed (`284776c`) |
| 7 | F05 | API images and delivery pipeline | `feat(docker): add dev and prod stacks with a control menu` (images and stacks); the delivery pipeline follows | U5 | images and stacks committed (`027e10f`), delivery planned |
| 8 | F06 | Next.js web skeleton | `feat(web): add Next.js 16 skeleton with CSP nonce and locale routes` | - | committed (`c80aa43`) |
| 9 | F07 | Expo app skeleton | `feat(mobile): add Expo SDK 58 skeleton with router and test setup` | - | planned |
| 10 | X01 | Server error system | `feat(api): add problem+json errors, validation and OpenAPI contract` | - | committed (`6bba58e`) |
| 11 | X02 | OpenAPI contract and app config | `feat(api): add problem+json errors, validation and OpenAPI contract` | - | committed (`6bba58e`) |
| 12 | X03 | Generated API client | `feat(shared): add design tokens and generated API client` | - | committed (`099be7b`) |
| 13 | X04 | Shared ICU catalogues | `feat(web): render the public practice page with i18n, theme and SEO` | D1 | done (`8c1da1a`) |
| 14 | X05 | Design and motion tokens | `feat(shared): add design tokens and generated API client` | - | committed (`099be7b`) |
| 15 | X06 | Web shell | `feat(web): render the public practice page with i18n, theme and SEO` | D1 | done (`8c1da1a`), rest with its first consumer |
| 16 | X07 | Web UI kit (shadcn/ui) | `feat(web): render the public practice page with i18n, theme and SEO` | - | first components done (`8c1da1a`), rest with their first consumer |
| 17 | X08 | Mobile shell | `feat(mobile): add i18n, RTL, theming, fonts and version gate` | D1 | planned |
| 18 | X09 | Mobile UI kit | `feat(mobile): add design-system UI kit v1` | - | planned |
| 19 | X10 | Android emulator smoke test | `ci(mobile): add Android emulator smoke test for Hermes and RTL` | - | planned |
| 20 | P01 | Practice aggregate data model | `feat(practice): add practice model and public practice endpoint` | - | committed (`b20f32c`) |
| 21 | P02 | Public practice endpoints | `feat(practice): add practice model and public practice endpoint` | - | committed (`b20f32c`) |
| 22 | P03 | Public practice page | `feat(web): render the public practice page with i18n, theme and SEO` | D2 | done (`8c1da1a`), sitemap in `54c9140` |
| 23 | P04 | Availability and slot generation | `feat(scheduling): generate slots and show free times on the page` | - | done (`c0dbca6`), rest with its first consumer |
| 24 | P05 | Public free times | `feat(scheduling): generate slots and show free times on the page` | - | done (`c0dbca6`) |
| 25 | P06 | Free times on the page | `feat(scheduling): generate slots and show free times on the page` | - | done (`c0dbca6`) |
| 26 | A01 | Accounts, sessions, memberships, audit | `feat(auth): add accounts, sessions, sign-up and account e-mails` | - | accounts and sessions done (`22c0cd5`), the index for patients with B01, rest with A04 |
| 27 | A02 | Notification outboxes and account e-mails | `feat(auth): add accounts, sessions, sign-up and account e-mails` | - | account e-mails done (`22c0cd5`), practice messages with E09 and N01 |
| 28 | A03 | Patient sign-up, verification, reset | `feat(auth): add accounts, sessions, sign-up and account e-mails` | - | done (`22c0cd5`) |
| 29 | A04 | Staff invitations, MFA, sessions, practice creation | `feat(auth): add staff invitations, TOTP MFA and session control` | - | staff roles, the second factor and the operator's role command done (this commit); invitations with M03, the rest later |
| 30 | A05 | Web authentication flows | `feat(web): add sign-in, sign-up, confirmation and reset pages` | D16 (decided: B) | pages for patients done (`8d12915`), account profile done (`b0e2f11`), the staff sign-in with its code and the dashboard's start with A04 (this commit) |
| 31 | A06 | Mobile authentication flows | `feat(mobile): add sign-in, sign-up and secure session storage` | D16 | planned |
| 32 | B01 | Patient profiles and insurance | `feat(api): add patient profiles with insurance validation` | - | done (`ddf90dd`) |
| 33 | B02 | Book an appointment | `feat(appointments): book with row locks and idempotency keys` | - | done (`b9b2795`) |
| 34 | B03 | Cancel, reschedule, status changes, my appointments | `feat(appointments): add cancel, reschedule and my appointments` | - | patient half done (`447475e`), the staff half with M05 |
| 35 | B04 | Portal booking | `feat(web): add portal booking flow and my appointments` | D16 | done (`628fd8e`) |
| 35a | B06 | Portal home and what B04 left | `feat(web): add the portal home` | - | planned |
| 35b | F09 | File storage: port, Azure and Azurite | `feat(storage): add object storage port with Azure and Azurite` | - | done (`95e5b8e`) |
| 35c | I01 | The installation's practice at the root of its domain | `feat(web): serve the installation's practice at the domain root` | - | done (`f1af019`) |
| 35d | I02 | The practice's brand with "powered by MediBooker" | `feat(web): show the practice's brand on its pages and e-mails` | - | done (`7f2c8ac`) |
| 36 | B05 | Mobile booking | `feat(mobile): add booking flow, my appointments and offline cache` | D16 | planned |
| 37 | M01 | Listing, practice page and theme settings | `feat(practice): add practice page and theme settings for admins` | D3 | planned |
| 38 | M02 | Services, opening hours, special days | `feat(practice): manage services, opening hours and special days` | - | planned |
| 39 | M03 | Team and public-profile consent | `feat(staff): manage team members and public-profile consent` | - | planned |
| 40 | M04 | Working hours and slots | `feat(scheduling): manage working hours, exceptions and slots` | - | planned |
| 41 | M05 | Dashboard and appointment handling | `feat(web): add dashboard today, calendar and appointment handling` | - | planned |
| 42 | N01 | Appointment e-mails and reminders | `feat(notifications): add appointment e-mails and reminders` | - | planned |
| 43 | N02 | Push notifications | `feat(notifications): add push notifications for the patient app` | D10, U8, U9 | planned |
| 44 | N03 | SMS channel | `feat(notifications): add SMS channel and phone verification` | D10 | planned |
| 45 | R01 | Clinical notes | `feat(records): add versioned clinical notes` | D13 | planned |
| 46 | R02 | Attachments, logo, staff photos | `feat(records): add attachments with pre-signed upload and scanning` | D9, D15 | planned |
| 47 | R03 | Patient record views | `feat(records): add patient record read model and views` | - | planned |
| 48 | FA01 | Family accounts | `feat(family): add family links, guardian declarations and invites` | D12 | planned |
| 49 | RT01 | Realtime dashboard | `feat(realtime): add Socket.IO gateway and live dashboard updates` | - | planned |
| 50 | PR01 | Data export and deletion | `feat(privacy): add data export and account deletion` | D8, D11 | planned |
| 51 | REL01 | Mobile build and release | `ci(mobile): add EAS build profiles, Maestro flows and releases` | D6, U9, U10 | planned |
| 52 | OPS02 | Practice backups, restore and offboarding | `feat(db-migrate): add per-practice backup, restore and offboarding` | - | planned |
| 53 | OPS01 | Deployment to the chosen hosting | `ci(deploy): deploy API and web to the selected region` | D4, D8, D9 | planned |

## Foundation

### L00 — Remove the v1 apps

**Commit:** `chore(repo): remove the v1 apps` · **Depends on:** - · **Owner:** main agent (the texts of the three `.claude` files by the architect)

On 2026-11-02 the user deleted the v1 folders `MediBooker/` (Angular 17 client) and `MediBooker-ApI/` (Express API) from the working tree: v2 is built with other technology and features and shares no code with v1. From this commit on, v1 exists only in the git history. The removal is committed first, before R00.

Scope:

- The deletions of the 217 tracked files under `MediBooker/` and `MediBooker-ApI/`, staged with `git add -u -- MediBooker MediBooker-ApI`.
- `CLAUDE.md`: only the intro and the repository layout without the two v1 rows (main agent). The decision rows and the `docs/` row without `docs/dev/` follow in R00; the Commands section, the rows `packages/`, `scripts/` and `apps/`, and `docs/dev/` in the `docs/` row follow in F01.
- `README.md`: a short v2 README (main agent); the full one follows in F01.
- `.claude/agents/architect.md`, `.claude/agents/backend-engineer.md` and `.claude/skills/health-data-security/SKILL.md`: the instructions that pointed at the v1 folders now say that v1 was removed and v2 shares no code with it. Every v1 lesson of `health-data-security` §12 stays with its v2 rule; §10 records the accepted v1 credential (U1) and keeps every rule.
- Stage explicit paths only, never `git add -A`; nothing else is staged.
- L00 and R00 are pushed together: the L00 texts name U1, F02 and `docs/architecture/09-risks-and-decisions.md`, and the short README describes the tenancy decision, all of which arrive with R00. No pushed state has a reference that does not resolve.

Acceptance:

- `git ls-files MediBooker MediBooker-ApI` prints nothing, and neither folder exists in the working tree.
- The commit holds the 217 deletions and five modified files; the first command prints `217`, the second prints exactly `.claude/agents/architect.md`, `.claude/agents/backend-engineer.md`, `.claude/skills/health-data-security/SKILL.md`, `CLAUDE.md` and `README.md`, one per line:

  ```sh
  git show --name-status --format= HEAD | grep -cE '^D[[:space:]]+MediBooker(-ApI)?/'
  git show --name-status --format= HEAD | grep -vE '^D[[:space:]]+MediBooker(-ApI)?/' | cut -f2 | LC_ALL=C sort
  ```

- No committed file points at the removed folders; this prints nothing:

  ```sh
  git grep -nE 'MediBooker-ApI|MediBooker/' HEAD
  ```

- Every v1 lesson stays; this prints 13, the rows of the lesson table in `health-data-security` §12:

  ```sh
  git show HEAD:.claude/skills/health-data-security/SKILL.md | sed -n '/^## 12\./,/^## 13\./p' | grep -c '^| [A-Z]'
  ```

### R00 — Architecture docs and decision records

**Commit:** `docs: add architecture docs and record tenancy and UI decisions` · **Depends on:** - · **Owner:** main agent (content by the architect)

Scope:

- Done in the working tree, as inputs of the commit:
  - `docs/product/feature-catalog.md`: open decision 15 reads `15. ~~Clinics with "SMS only"~~ — **decided 2026-11-01 (ADR 0004): every account needs an e-mail address in v1, also in SMS-only clinics.** Sign-in with phone number and SMS code follows once an SMS provider is chosen.`
  - `.claude/skills/medibooker-domain/SKILL.md`: the storage note of ADR 0005; in "Realtime events" the server-assigned rooms `practice:{practiceId}:staff` (staff, doctors and admins of that practice, after the membership check), `practice:{practiceId}:doctors` (note events) and `user:{userId}` instead of one `staff` room, and `practiceId` in every payload, so clients can call the practice-scoped paths (ADR 0005 §10); the note that v1 was removed.
  - `docs/adr/0001-notification-channels-and-content.md`: the status line `Status: Accepted (channels, incl. optional SMS) — 2026-11-01; providers Open (decision D10)`, matching `CLAUDE.md`.
  - `.claude/skills/design-system/SKILL.md`, `.claude/skills/react-web-feature/SKILL.md` and `.claude/skills/react-native-screen/SKILL.md`: the ADR 0007 and 0008 edits.
  - `docs/architecture/` (README and 01 to 09), including the user's decisions of 2026-11-04 ([09](09-risks-and-decisions.md)).
  - `CLAUDE.md` (main agent): the decision rows Web styling, Web UI components, Animation, Auth and Tenancy, and the `docs/` row of the layout without `docs/dev/`. The rows Monorepo, Database / ORM, Mobile toolchain and Data fetching stay Proposed; U11 is resolved, and no step waits for it.
- Stage explicit paths only, never `git add -A`:
  - `docs/adr/0001-notification-channels-and-content.md`, `docs/adr/0004-authentication.md`, `docs/adr/0005-multi-tenancy.md` (one database per practice), `docs/adr/0007-web-ui-shadcn.md`, `docs/adr/0008-animation-gsap.md`;
  - `docs/architecture/` (README and 01 to 09);
  - `CLAUDE.md`, only the hunks of the decision rows and the `docs/` row without `docs/dev/`;
  - `.claude/skills/design-system/SKILL.md`, `.claude/skills/react-web-feature/SKILL.md`, `.claude/skills/react-native-screen/SKILL.md`, `.claude/skills/medibooker-domain/SKILL.md`;
  - `docs/product/feature-catalog.md`.
- Not staged: the F01 files (the root tooling files, `packages/`, `scripts/`, `docs/adr/0006-toolchain-and-version-policy.md`, `docs/dev/`, `.gitignore`, `.claude/agents/security-reviewer.md`) and the F01 hunks of `CLAUDE.md` (the Commands section, the rows `packages/`, `scripts/` and `apps/`, and `docs/dev/` in the `docs/` row).

Acceptance:

- `git show --name-only --format= HEAD` lists exactly the paths above, and `git show --name-only --format= HEAD | grep -v '\.md$'` is empty.
- `git show HEAD:docs/product/feature-catalog.md | grep -c 'decide before building auth'` prints 0.
- The realtime section of the domain skill names the practice rooms, and no global `staff` room survives; the first command finds a line, the second finds nothing:

  ```sh
  grep -n 'practice:{practiceId}:staff' .claude/skills/medibooker-domain/SKILL.md
  grep -n 'rooms `staff`' .claude/skills/medibooker-domain/SKILL.md
  ```

- ADR 0001's status matches `CLAUDE.md`; this prints 1:

  ```sh
  git show HEAD:docs/adr/0001-notification-channels-and-content.md | grep -cx 'Status: Accepted (channels, incl. optional SMS) — 2026-11-01; providers Open (decision D10)'
  ```

- The committed `CLAUDE.md` keeps the four toolchain rows Proposed (U11); this prints 4:

  ```sh
  git show HEAD:CLAUDE.md | grep -cE '^\| (Monorepo|Database / ORM|Mobile toolchain|Data fetching) \|.*\| Proposed \|$'
  ```

- Every ADR that the committed `CLAUDE.md` names exists in the commit (ADR 0006 arrives with F01); this prints nothing:

  ```sh
  git show HEAD:CLAUDE.md | grep -o 'docs/adr/[0-9a-z-]*\.md' | sort -u | grep -v '/0006-' |
    while read -r p; do git cat-file -e "HEAD:$p" 2>/dev/null || echo "missing in HEAD: $p"; done
  ```

- `grep -rnE 'app\.practice[_]id|ENABLE ROW LEVE[L]' docs/adr docs/architecture` finds nothing: no Row-Level Security setting or policy of the shared-database draft survives.
- Every relative Markdown link of the architecture docs and the ADRs resolves; this prints nothing (links into `docs/dev/` and to ADR 0006 resolve in the working tree, and F01 commits them):

  ```sh
  for f in docs/architecture/*.md docs/adr/*.md; do
    grep -oE '\]\([^)#]+\.md' "$f" | sed 's/^](//' | while read -r l; do
      [ -e "$(dirname "$f")/$l" ] || echo "$f -> $l"
    done
  done
  ```

- No commit header in this file is longer than 72 characters; this prints nothing:

  ```sh
  grep -oE '`(feat|fix|refactor|perf|test|docs|build|ci|chore|revert)(\([a-z0-9-]+\))?: [^`]+`' docs/architecture/08-roadmap.md | tr -d '`' | awk 'length > 72'
  ```

### F01 — Monorepo workspace and shared tooling

**Commit:** `chore(repo): scaffold pnpm workspace, Turborepo and shared tooling` (66 characters) · **Depends on:** - · **Owner:** devops-engineer; architect and security-reviewer review

Scope, as committed in `13044c5` ([01 §2](01-repo-and-tooling.md#2-root-tooling-f01), ADR 0006):

- Root `@medibooker/root`: `engines.node` `^26.13.0`, `.node-version` 26.13.0; scripts `lint`, `lint:root`, `typecheck`, `typecheck:root`, `test`, `test:root`, `format`, `format:check`, `verify` (`scripts/check-hooks.ts`, the staged gitleaks scan, the Prettier check, then Turbo); every lint script with `--max-warnings=0`; root `eslint.config.js`, `tsconfig.json` and `vitest.config.ts` for the repo scripts.
- `pnpm-workspace.yaml` with the catalog, `catalogMode: prefer`, `savePrefix: ''`, `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade` with the dated `trustPolicyExclude: [lefthook@2.2.2]`, `allowBuilds: { lefthook: true }`; `pnpm-lock.yaml`; `turbo.json` with `build`, `lint`, `typecheck`, `test` (no outputs until coverage is turned on) and the root tasks `lint:root`, `typecheck:root`, `test:root` (`env: ["GITLEAKS_VERSION"]`).
- `prettier.config.js`, `.prettierignore` (`.claude/`, `*.md`, `pnpm-lock.yaml`), `.editorconfig`, `.gitattributes` (LF; CRLF for `*.cmd`, `*.bat`, `*.ps1`), `.gitignore` (additions: dependencies, caches and build output; environment files except `.env.example`; lefthook's local overrides; logs, OS and editor files; keys, certificates and signing material).
- `packages/tsconfig` (strict, node, library, nest, nextjs, each with a fixture) and `packages/eslint-config` (base with `reportUnusedDisableDirectives: 'error'`, nest, react, vitest; the plugin rules `no-hex-colors`, `no-physical-direction-classes` and `no-system-clock`) with rule and preset tests; `passWithNoTests: false` and `allowOnly: false` in every Vitest config.
- `lefthook.yml` (`assert_lefthook_installed: true`, `min_version: 2.2.2`; `commit-msg` through `scripts/check-commit-msg.ts`; `pre-commit` with the Prettier check and `scripts/run-gitleaks.ts`, which fails closed), `scripts/check-hooks.ts` at the start of `verify`, `.gitleaks.toml` with the password-assignment rule, every scan with `--redact` and `--ignore-gitleaks-allow`, proven by `scripts/gitleaks-config.test.ts` on fixtures generated in a temporary directory.
- `docs/adr/0006-toolchain-and-version-policy.md` (it claims no client confirmation for the Proposed toolchain rows, U11), `docs/dev/getting-started.md`, `docs/dev/windows.md` (`npx --yes pnpm@12.16.1` fallback).
- `.claude/agents/security-reviewer.md`: step 3 runs gitleaks with the repository policy (`gitleaks git` over the history and `gitleaks dir` per changed path, each with `--redact`, `--ignore-gitleaks-allow` and `--config .gitleaks.toml`, never without `--redact`) and names the two findings of commit `0011060` as the risk the user accepted (U1); any other finding is Critical.
- `CLAUDE.md`: the Commands section, the layout rows `packages/`, `scripts/` and `apps/`, and `docs/dev/` in the `docs/` row; `README.md`: the full v2 README (both written by the main agent).
- Stage explicit paths only, never `git add -A`: the root tooling files `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.json`, `eslint.config.js`, `prettier.config.js`, `vitest.config.ts`, `lefthook.yml`, `.gitleaks.toml`, `.editorconfig`, `.gitattributes`, `.prettierignore`, `.node-version` and `.gitignore`; `packages/`; `scripts/`; `docs/adr/0006-toolchain-and-version-policy.md`; `docs/dev/`; `.claude/agents/security-reviewer.md`; the remaining hunks of `CLAUDE.md`; `README.md`.

Acceptance:

- `npx --yes pnpm@12.16.1 install --frozen-lockfile` succeeds on Node 26.13.0 from the repository path; no build script runs outside `allowBuilds`.
- `pnpm verify` is green, and a second `pnpm turbo run lint lint:root typecheck typecheck:root test test:root` reports `FULL TURBO`.
- `pnpm --filter @medibooker/eslint-config test` passes and contains a failing fixture for each of the three guardrail rules. The plugin registers exactly these three; this prints `no-hex-colors no-physical-direction-classes no-system-clock`:

  ```sh
  node --input-type=module -e "import { plugin } from '@medibooker/eslint-config'; console.log(Object.keys(plugin.rules).sort().join(' '))"
  ```

- `CI=true pnpm test:root` passes with gitleaks 8.30.1 on `PATH` (the rule cases run against the real binary) and fails without it.
- `scripts/lib/commit-message.test.ts` passes its tests "a header of exactly 72 characters" (accepted) and "a header of 73 characters" (rejected); `scripts/check-commit-msg.test.ts` proves the hook's exit codes; `scripts/hooks.test.ts` proves the lefthook wiring and both outcomes of `scripts/check-hooks.ts`; `scripts/lib/gitleaks.test.ts` proves that a missing gitleaks binary blocks the commit and that every scan passes `--ignore-gitleaks-allow`.
- `grep -n 'ps1' .editorconfig` finds the CRLF section that matches `.gitattributes` (ADR 0006 follow-up, RT-44).
- `git ls-files --eol` shows `i/lf` for every new text file.
- `pnpm -r ls --depth -1` lists only `@medibooker/root` and the `packages/*` workspaces.
- ADR 0006 claims no client confirmation for the Proposed toolchain rows (U11): `git show HEAD:docs/adr/0006-toolchain-and-version-policy.md | grep -c 'confirmed by the client'` prints 0.
- The commit holds exactly the paths above. Outside `packages/`, `scripts/` and `docs/dev/`, this prints the 15 root tooling files, `.claude/agents/security-reviewer.md`, `CLAUDE.md`, `README.md` and `docs/adr/0006-toolchain-and-version-policy.md`, and nothing else:

  ```sh
  git show --name-only --format= HEAD | grep -vE '^(packages|scripts|docs/dev)/' | LC_ALL=C sort
  ```

### F03 — NestJS API skeleton

**Commit:** `feat(api): add NestJS 12 skeleton with config, logging and context` · **Depends on:** - · **Owner:** backend-engineer

Built before CI (F02), as the user decided on 2026-11-04; until F02 exists, `pnpm verify` on the developer machine is the only gate.

Scope ([02](02-api.md)):

- `apps/api` as an ESM package with `"files": ["dist"]`: `nest-cli.json` (SWC builder), `.swcrc`, tsconfig (`nest.json`, `lib: ["es2025", "esnext.temporal"]`, `useDefineForClassFields: false`), `vitest.config.ts` (SWC from `.swcrc`, `TZ=Pacific/Chatham`, coverage configuration with `@vitest/coverage-v8`), `eslint.config.js`; the API variables in the root `.env.example` (no `.env.example` in `apps/api`, [07 §2](07-docker-ci-cd.md#2-compose-for-local-development)).
- Coverage turned on: `@vitest/coverage-v8` in the catalog at Vitest's version (5.1.0 today), the thresholds in the API's `vitest.config.ts`, and `coverage/**` back as the output of the `test` task in `turbo.json` ([01 §2](01-repo-and-tooling.md#turbojson), ADR 0006 decision 4); CI enforces the thresholds from F02.
- `src/main.ts`, `config/load-env.ts` (the root `.env`, found through `pnpm-workspace.yaml`), `config/env.schema.ts` with `parseEnv`, `app.setup.ts` (`APP_OPTIONS`, `configureApp`), `app.module.ts` (`AppModule.forRoot(env)`, `EnvModule`).
- `common/logging` (the field allowlist, allowlist serializers with the route pattern, the error serializer, redaction, the `keepMessageConstant` hook and the `UnknownExceptionFilter`, so pino copies no error message and no interpolation value into `msg`, and the process handlers; [02 §8](02-api.md#8-logging-and-redaction)), `common/context` (`RequestContext` with the empty slots `practice` and `actor`; the request id is the CLS id), `common/security` (`@Public()` per handler, kept in a module-private set instead of metadata, deny-by-default `AuthenticationGuard`, and the route inventory test `public-routes.spec.ts`), named throttlers.
- `health/` with `GET /health/live` (version-neutral, outside `/api`, excluded from OpenAPI).
- `test/support/create-test-app.ts`, the AppModule smoke spec; root scripts `build` and `dev`, Turbo task `dev`.
- `nestjs-feature` skill: the layout of [02 §2](02-api.md#2-structure) (no repository files), rule 1 (`AuthenticationGuard` denies by default; `@Public()` only where 02 §4 allows it) and rule 9 (`parseEnv` once in `main.ts`, `AppModule.forRoot(env)`, no `@nestjs/config`). Rule 4 (`DomainException`) changes with X01.

Acceptance:

- `pnpm --filter @medibooker/api dev` serves on port 3001; `curl -s localhost:3001/health/live` returns `{"status":"ok"}`; `/v1/health/live` and `/api/v1/health/live` return 404; the boot log contains no "Unsupported route path".
- HTTP tests without Docker: a UUID `X-Request-Id` is echoed and an invalid one replaced; an unknown route returns 404; a test-only route without `@Public()` returns 401; helmet headers are present and `X-Powered-By` is absent; there is no `Access-Control-Allow-Origin` unless `CORS_ORIGINS` is set; with a limit of 3 the fourth request returns 429 with `Retry-After`.
- `parseEnv` tests: an invalid environment exits non-zero and names keys only; production rejects `OPENAPI_UI_ENABLED=true`, `LOG_PRETTY=true` and a missing `TRUST_PROXY_HOPS`; staging and production reject `LOG_LEVEL` `fatal` and `silent` and `RATE_LIMIT_PER_MINUTE` above 1000.
- Captured logs of `GET /nope?email=sara@example.test` with `Authorization` and `Cookie` headers contain the request id and no header value, path or query.
- The probe routes that log by hand (an interpolation value, an object three levels down, an error under another key than `err`, fields outside the allowlist, a Nest `Logger` without a context) leave no synthetic value in the captured logs; a reviewed field keeps only the form of its value; the error serializer logs no message, cause or detail and no line of a stack header in either of Node's forms, also for getters that throw; each unknown exception gives exactly one `unknown exception` line.
- An uncaught exception or an unhandled rejection writes one fatal pino line, nothing to stderr, and exits 1 (child-process tests of the handlers); `src/main.ts` itself on a taken port writes Nest's listen error line with the bind address, then one fatal line, nothing to stderr, and exits 1 (a child-process test of the entry point, which fails when the handlers are registered after `listen`).
- The route inventory test lists exactly `GET /health/live` as public; a handler with all metadata of a public one stays closed, and `@Public()` on a class throws.
- The smoke spec compiles `AppModule.forRoot(parseEnv(TEST_ENV))` and resolves `AuthenticationGuard` ([02 §12](02-api.md#12-testing-specifics)).
- `pnpm --filter @medibooker/api test` passes with coverage thresholds active; no authentication or database code exists yet.
- `grep -nE 'JwtAuthGuard|typed config service|repository\.ts' .claude/skills/nestjs-feature/SKILL.md` finds nothing.

### F02 — CI quality and security baseline

**Commit:** `ci: add GitHub Actions gates, secret scans and logging lint rules` (committed as `11a2113`; the plan's header was `ci: add quality and security workflows, CodeQL and Renovate`) · **Depends on:** U2, U3 · **Owner:** devops-engineer; security-reviewer reviews

Built after F03, as the user decided on 2026-11-04. F02 also takes over the former F08: with U1 declined, the full-history scan is a required check from the start.

U3 was done on 2026-11-04 (non-provider patterns stay off, a user setting). F02 was planned to be built without waiting for U2, with `schedule`, `workflow_dispatch`, Renovate's configuration and the dependency-graph item following U2; the user approved U2 on 2026-11-05 and the main agent applied it before the push, so they work from the first push, and Renovate runs after U4. After the first green `ci-ok`, the main agent adds the ruleset that requires `ci-ok` ([ADR 0009](../adr/0009-ci-branch-model-and-supply-chain.md)).

Scope:

- `.github/actions/setup/action.yml` (pnpm from `packageManager`, Node from `.node-version`, gitleaks 8.30.1 with a checksum check, Turbo cache restore, frozen install); `.github/workflows/ci.yml` with `config-lint` (the only job that references a secret, the optional Docker Hub token, so it runs no repository or package code), `quality`, `security`, `secrets-history`, `sbom` and `ci-ok`; `codeql.yml`; `scheduled.yml`; `.github/pull_request_template.md` with the Definition of Done, the CI permission rules, the security-reviewer's approval for changes to the scan scripts, `.gitleaks.toml`, `.gitleaksignore` and `ACCEPTED_FINGERPRINTS`, and "a bug fix names the test that failed before the fix" ([07 §3](07-docker-ci-cd.md#3-github-actions)).
- gitleaks in CI with the options of `policyArguments()` (`--redact`, `--ignore-gitleaks-allow`): the pushed-range scan and the runtime-generated self-test in `security`, the full-history scan in `secrets-history`, both needed by `ci-ok` ([07 §4](07-docker-ci-cd.md#4-secret-scanning)). Both repository scans see merge commits and `-diff` files (`--diff-merges=first-parent --text`) and refuse a shallow clone; every gitleaks run reads no `.gitattributes` of the repository (`GIT_ATTR_SOURCE`). Redacted SARIF only.
- `scripts/ci-config.test.ts`, which checks the rules of 07 §3 on every workflow and action (`ci-ok` needing every job included) and that Renovate's custom managers still match their lines, with `yaml` 2.9.1 as a root devDependency; coverage gates for the repo scripts' `scripts/lib` and for `@medibooker/eslint-config` ([06 §8](06-testing.md#8-coverage-gates)).
- `.gitleaksignore` with exactly the commit-qualified fingerprints of the two v1 findings in the git history, under a comment dated 2026-11-04 that records them as the risk the user accepted by declining U1 ([09](09-risks-and-decisions.md)). On 2026-11-04 they were:

  ```text
  001106047c044bbb4a21394a90a66023ce013c1a:MediBooker-ApI/config/dbConfig.js:medibooker-password-assignment:8
  001106047c044bbb4a21394a90a66023ce013c1a:MediBooker-ApI/dev.env:medibooker-password-assignment:5
  ```

- The pin ([07 §4](07-docker-ci-cd.md#4-secret-scanning)): gitleaks reads `.gitleaksignore` from the scan root whatever `--gitleaks-ignore-path` says, and a commit-less entry (`file:rule:line`) silences that finding in every commit and in the staged scan. The two fingerprints therefore become the constant `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts`; `scripts/run-gitleaks.ts` (pre-commit hook and `pnpm verify`) and the `security` job fail closed when the non-comment lines of `.gitleaksignore` differ from it, proven by tests in `scripts/lib/gitleaks.test.ts`.
- The rule for later entries, written into the comment of `.gitleaksignore` and into ADR 0009 (the `health-data-security` skill has it since L00): a live secret is never added to `.gitleaksignore`; the U1 credential is the only accepted exception. Any other finding is rotated first; if it already reached the pushed history, its commit-qualified fingerprint is then added with a dated comment that names the rotation, in a commit the security-reviewer approves, which also updates the pinned list. A new finding in the v1 history (commits before L00), for example after a gitleaks upgrade or a rule change, goes to the user as a follow-up of U1 and needs a new dated user decision; so does re-recording the two U1 findings after a rule rename.
- The header of `.gitleaks.toml` ("Never allowlist a real secret") and the secret-scanning rules of `docs/dev/getting-started.md` name this one exception and point to the rule.
- `renovate.json` ([07 §5](07-docker-ci-cd.md#5-supply-chain)), including the custom manager for the gitleaks version and checksum, checked by a pinned `renovate-config-validator` in `quality`.
- `pnpm dedupe --check` in `quality` and in `pnpm verify` (`trustPolicy` is already part of F01).
- Three logging rules in the `nest` preset of `@medibooker/eslint-config`, from the F03 security review ([02 §8](02-api.md#8-logging-and-redaction)), so they hold before F04 writes the first catch blocks: the message argument of a logger call (`log`, `info`, `warn`, `error`, `debug`, `verbose`, `fatal`, `trace`) is a string literal or a template literal without expressions, never an identifier, a member expression such as `err.message`, a concatenation or a call, and no argument of a logger call reads `.message` or `.stack`; `new Logger(…)` takes `<Class>.name`, never no argument; and `.child(`, `.setBindings(`, a logger's `.assign(` (nestjs-pino's `PinoLogger.assign`; `Object.assign` stays allowed), `runInContext(` and the `msgPrefix` option appear only in `apps/api/src/common/logging`. Test-only probes that make the forbidden calls on purpose (`test/support/probe.module.ts`) carry a disable comment with the reason; F03's own logging code already passes the rules (the process handlers log with a literal at each call). Nest's `Logger` logs constant messages only; an error or reviewed fields go through nestjs-pino's `PinoLogger` or `req.log` (02 §8, the `nestjs-feature` skill). `apps/api/test/lint/logging-rules.canary.ts` makes one forbidden call per rule against the installed declarations, each under a disable comment, so the API's lint fails when an upgrade blinds a rule.
- `docs/adr/0009-ci-branch-model-and-supply-chain.md`: default branch `v2-planning` and why (RT-27), triggers (push to `v2-planning` and `main`, pull requests, tags, dispatch), `ci-ok` as the only required check, the secret-scanning layers, the accepted v1 fingerprints (U1, declined 2026-11-04), the `.gitleaksignore` pin and the rule for later entries, Renovate rules, the SPDX dependency submission, repository visibility (D4: public for now, option A, decided 2026-11-04) and GitHub, Renovate and their data as processors without patient data.

Acceptance:

- The pushed commit has a green `ci-ok` on `v2-planning`, and `ci-ok` lists `secrets-history` among its needs.
- The full-history scan with the CI options passes, and `.gitleaksignore` holds the two fingerprints and nothing else besides comments; the first command exits 0, the second prints 2, and the third prints 0, because every entry names commit `0011060`:

  ```sh
  gitleaks git --redact --ignore-gitleaks-allow --config .gitleaks.toml .
  grep -cvE '^(#|$)' .gitleaksignore
  grep -vE '^(#|$)' .gitleaksignore | grep -cv '^001106047c044bbb4a21394a90a66023ce013c1a:'
  ```

- A `.gitleaksignore` with a third entry, a commit-less entry or a changed fingerprint makes `pnpm verify` and the `security` job fail; `scripts/lib/gitleaks.test.ts` covers the three cases.
- In a throw-away local clone without `pnpm install` (so no hook runs), re-create `MediBooker-ApI/config/dbConfig.js` with seven filler lines and a runtime-generated `password: '…'` on line 8 (the file, rule and line of one accepted fingerprint; `*.js` is not ignored) and commit it: the full-history scan exits 1 despite `.gitleaksignore`, because a fingerprint names its commit. With a commit-less entry for that file, rule and line the scan would exit 0, so the check also proves that the entries name their commit. Nothing is pushed, and the clone is deleted afterwards. `scripts/scan-secrets.test.ts` repeats this check on every push, together with the range, SARIF, merge-commit, `-diff`, shallow-clone and empty-repository cases of 07 §4.
- `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12` reports nothing.
- `grep -rhoE 'uses: [^ ]+' .github | grep -vE '@[0-9a-f]{40}$|^uses: \./|^uses: docker://.+@sha256:'` is empty: every action is SHA-pinned. `scripts/ci-config.test.ts` checks the pins and the other rules of 07 §3 on every push, and fails when a job is left out of `ci-ok`'s needs.
- The CI self-test step fails as intended for both runtime-generated secrets; in a throw-away local clone, a commit with a runtime-generated `password = "…"` line makes the pushed-range scan command of `security` exit 1 (nothing is pushed).
- `renovate.json` passes the pinned `renovate-config-validator`.
- The `quality` job runs `pnpm dedupe --check` and the gitleaks rule test without skips (JUnit report shows the gitleaks cases as passed).
- RuleTester cases of the three logging rules reject the probe calls of the F03 security review (`` req.log.info(`booked for ${email}`) ``, `new Logger('Probe').warn(err.message)`, `new Logger().error(err.message, err.stack)`, `new Logger(Probe.name).error('Failed to book', err.stack)`, `new Logger()`, `req.log.child({ … })` outside `common/logging`) and accept constant messages; `pnpm lint` passes on the API.
- The `sbom` job's snapshot appears under Insights → Dependency graph with the npm packages of `pnpm-lock.yaml`.

After the push, only the main agent (post-push steps of [ADR 0009](../adr/0009-ci-branch-model-and-supply-chain.md)), all done on 2026-11-05:

- **`ci-ok` green** on `11a2113`: CI run 42025771881, all six jobs green, `ci-ok` at 12:19:40Z.
- **The ruleset that requires `ci-ok`** (decision 1): `v2-planning: ci-ok required` (id 26612252), created at about 12:21Z. Rule `required_status_checks` with `ci-ok` from the GitHub Actions integration (15368) and `strict_required_status_checks_policy: false`; bypass actor `RepositoryRole` 5 (the admin role) with `bypass_mode: always`, and `current_user_can_bypass` reads `always`. The effective rules on `v2-planning` are `required_status_checks`, `deletion` and `non_fast_forward`.
- **The first CodeQL triage** (decision 6): CodeQL on `11a2113` gave 0 results and 0 open alerts, so nothing was dismissed. Code scanning holds the analyses `CodeQL`, `gitleaks-range` and `gitleaks-history`, each with 0 results.
- **`scheduled.yml` dispatched by hand** (run 42026574852): `secrets` and `audit` green at 12:22Z, before the first scheduled run on Monday at 03:41 UTC.
- **The dependency graph:** the `sbom` job's SPDX snapshot was submitted (step "Submit the SBOM to the dependency graph"), and the dependency graph's SBOM lists 1220 packages.

### F08 — Full-history secret scan as a required check (merged into F02)

Merged into F02 on 2026-11-04. F08 was to record the two `.gitleaksignore` fingerprints and make `secrets-history` required once the user had rotated the v1 credential (U1). The user declined U1 and accepted the risk, so F02 records the fingerprints with a dated comment and requires the scan at once. The ID stays reserved; nothing is committed under it.

### F04 — Platform and practice data layer

**Commit:** `feat(api): add per-practice databases with provisioning and runner` · **Depends on:** - · **Owner:** backend-engineer; devops-engineer for compose; security-reviewer reviews credentials and isolation

Scope ([ADR 0005](../adr/0005-multi-tenancy.md), [02 §5–§6](02-api.md#5-data-layer-and-tenancy), [02 §9](02-api.md#9-prisma-schemas-and-conventions)):

- Compose `db` (PostgreSQL 18.6, `postgres:18.6-trixie` pinned by its index digest, still the newest 18.x on 2026-11-05; `max_connections=200`, the server log settings, a TCP health check) with `infra/local/postgres/init/01-cluster.sh`: roles `platform_owner`, `platform_app`, `medibooker_provisioner` (`CREATEDB`, `CREATEROLE`, `createrole_self_grant = 'set'`), no group role for practices; database `medibooker_platform` with the builtin `C.UTF-8` locale and `CONNECT` revoked from `PUBLIC` ([07 §2](07-docker-ci-cd.md#2-compose-for-local-development)). The database variables in the root `.env.example`, among them `DATABASE_ADMIN_URL`, the cluster superuser for the local tools only; root scripts `db:up`, `db:migrate`, `db:seed`, `db:reset`, `test:integration`, `check:migrations`; Turbo tasks `db:generate`, `db:*`, `test:integration`.
- `apps/api/prisma/platform` and `apps/api/prisma/practice` with `prisma.platform.config.ts` and `prisma.practice.config.ts` (optional `process.env` URLs, the root `.env` outside production), generators `prisma-client` (ESM, `partialIndexes`) into `src/generated/platform` and `src/generated/practice`, `scripts/write-schema-versions.ts`.
- Platform models: `Practice` (`practices`: id, status with the seven values of ADR 0005 §5, market, `cluster_id`, `database_name`, `app_secret_ref`, `owner_secret_ref`, `route_version`, `schema_version`, `migrated_at`, `migration_error_code`, `purged_at`, timestamps), `PracticeSlug` (`practice_slugs`: `slug` primary key with `CHECK (slug ~ '^[a-z0-9-]{3,40}$')`, `practice_id`, `created_at`, `retired_at`; partial unique index: one current slug per practice), `DatabaseCluster` (`database_clusters`: id, region, host, port, `tls_mode`, `ca_secret_ref`, `provisioner_secret_ref`, `database_limit`, status), append-only `platform_audit_events`. First platform migration with `ALTER DEFAULT PRIVILEGES … TO platform_app`, then `REVOKE INSERT, UPDATE, DELETE ON practices, database_clusters FROM platform_app` and the revokes on `platform_audit_events` ([02 §9](02-api.md#9-prisma-schemas-and-conventions)).
- Practice model: `PracticeIdentity` (`practice_identity`, singleton with the practice id); the first practice migration grants to the role named in `medibooker.app_role` through `app_role()` and makes `practice_identity` read-only for it.
- `scripts/check-migrations.ts` with unit tests (`scripts/check-migrations.test.ts`) and the root script `check:migrations`, run by `verify` and by `quality`: the atomic header with both `SET LOCAL` timeouts, `-- contract`, reviewed exceptions, no literal role names in practice grants.
- `apps/db-migrate` (`@medibooker/db-migrate`, Node type stripping, `pg`, `@types/pg`): `medibooker-db migrate platform|practices|all` (with P3009 recovery, lock retries and timeout termination), `provision`, `verify`, `roles reconcile`, `reset-local`; `createPracticeDatabase()` as the only creator of practice databases; SCRAM verifiers, connection limits and role settings; the operator audit of every command; the JSON-only output; `DATABASE_CLUSTER_ENDPOINTS`; the `SecretStore` port with the development store (`dev:` and `env:` references, local and CI only); exports `.` and `./testing` (`provisionPractice` with the template fast path, `dropPractice`, `seedPracticeFixture`, `loadWorkspaceEnv`) for the seed, the test harness and later the web e2e fixtures.
- API: `common/time` with the `Clock` port, `SystemClock` and `FixedClock` (a correction of 2026-11-05: the acceptance below steps the `FixedClock`; `convert.ts` and `CLOCK_FIXED_AT` stay with P02); `PlatformPrismaService`, `PracticeConnectionManager` (purposes and budgets, `evictIdle()`, the secret cache, TLS options, the identity and ACL check), `PracticeContext`, `PracticeTransactionalAdapter` next to the platform `TransactionalAdapterPrisma` (two `ClsPluginTransactional` connections), `PracticeContextInterceptor` and `@PracticeScoped('id')` (the mechanism with the status table, the market check and the schema guard, and a test-only route; slugs in P02, the index and membership checks in A01), `PracticeRunner` with `runInPractice()` and `forEachPractice()`, `PracticeCache`, `PracticeUnavailableError` (as a 503 `ServiceUnavailableException` with `Retry-After: 30` until X01 catalogues it), the schema guard, `GET /health/ready` (platform database, platform schema version, `MARKETS` set, draining), `MARKETS`, `DATABASE_TX_*`, the pool, client and budget limits; `parseEnv` rejects a `PLATFORM_DATABASE_URL` without `sslmode=verify-full` outside `local` and `ci`; `SECRET_STORE` accepts only `dev`, in `local` and `ci`, and stays unset elsewhere until OPS01, so every practice answers 503 there.
- Seed: `al-noor` (Asia/Riyadh) and `lindenhof` (Europe/Berlin) with fixed UUIDs, provisioned through `provisionPractice()` as `medibooker_provisioner`, plus the migrated `practice_template` with its migration recorded as the database comment.
- Integration harness: Testcontainers global setup with the production log settings, `log_statement=all` and durability off, its cluster prepared by `01-cluster.sh` itself (run by the image's entrypoint), ryuk off in CI (`TESTCONTAINERS_RYUK_DISABLED`), templates that accept no connections after the drift copies, per-file databases through `createPracticeDatabase()`, `test/support/practices.ts`; the drift spec `migrations.int-spec.ts` for both schemas and the specs `platform-schema`, `seed`, `db-migrate-testing`, `health-ready` and `logging`; the tenancy specs `provisioning`, `credentials`, `tls` (with the staging case, because staging requires TLS), `connection-manager`, `connection-memory`, `status`, `context` and `migration-runner` ([06 §4](06-testing.md#4-authorization-and-tenant-isolation)); CI `integration` job, which pulls the digest-pinned image anonymously ([ADR 0009](../adr/0009-ci-branch-model-and-supply-chain.md) decision 9); the `quality` steps `db:generate` without database variables and `check:migrations`. The API's tsconfig, one for sources and tests (`noEmit`), sets `allowImportingTsExtensions`; `@peculiar/x509` generates the TLS spec's certificates at run time.
- Logging of the data layer ([02 §8](02-api.md#8-logging-and-redaction)): `bindLogFields(logger, fields)` in `common/logging`, which passes bindings through the field allowlist before nestjs-pino's `assign`, with the first binding (`practiceId`); the reviewed fields `practiceId`, `clusterId` and `reasonCode`. No provider does I/O while the app is built or initialised: the pools connect on their first query, and `src/main.ts` checks the platform database (`SELECT 1`) after `listen`, once `registerProcessHandlers` logs through pino, so a failed connect becomes one fatal pino line and never a line of Nest's console logger ([02 §3](02-api.md#3-bootstrap); the plan's `onModuleInit` would have broken F03's Docker-free taken-port test).
- `nestjs-feature` skill: rule 5 and the booking example (`@InjectTransactionHost('practice')` and `@Transactional('practice')` instead of `PrismaService` and `this.prisma.$transaction`, the two schemas, row locks without a `userId` filter on a shared table); `.claude/agents/architect.md`: the schema paths `apps/api/prisma/platform/schema.prisma` and `apps/api/prisma/practice/schema.prisma`.
- `docs/dev/getting-started.md`: Docker Desktop as the prerequisite for database work, the one root `.env`, the database commands, how to author a migration; no `prisma dev` fallback.

Acceptance (integration tests in CI unless stated):

- Both migration sets apply to an empty PostgreSQL 18.6, and both drift specs exit 0.
- `provision` runs as `medibooker_provisioner`, never as the superuser, on a cluster prepared only by `01-cluster.sh` (or the identical Testcontainers setup). It creates `practice_<id32>` with the builtin `C.UTF-8` locale, its app and owner roles with their connection limits and settings, and an `ACTIVE` registry entry with the current `schema_version`; a second run changes nothing; a run stopped after the role step completes on the next run; both runs leave `platform_audit_events` rows.
- A's app role gets `permission denied for database` on B's database, on a template copy of B and on `medibooker_platform`. With B's `CONNECT` opened to `PUBLIC` by the test, A's role connects but reads no table of B, and the connection manager refuses B's client with `PRACTICE_ACL_OPEN`. In its own database A's role has DML on a new table, cannot `CREATE` or `DROP`, and cannot change `practice_identity`.
- `platform_app` gets `permission denied` when it updates `cluster_id`, `database_name`, a secret reference, `route_version` or `status` of a practice, or any `database_clusters` row.
- `tls.int-spec.ts`: a practice client with the right CA connects with `verify-full`; with a wrong CA it answers 503 and the server log shows no authentication attempt; the runner's Prisma URL with a wrong CA fails; a unit test covers the TLS options built for each `tls_mode`.
- 200 interleaved concurrent requests over A and B through a test-only `@PracticeScoped` route each return only their own `practice_identity`; concurrent first use of one practice creates one client.
- A registry entry pointing at B's database for A's id is refused with 503 and the log code `PRACTICE_IDENTITY_MISMATCH`.
- Every status of ADR 0005 §5 gives its answer on the test-only route and in `runInPractice`, also through a client cached before the change; after the test revokes `CONNECT` from B's app role and terminates its sessions, a cached client answers 503; nothing returns B's data. Under `APP_ENV=staging`, a practice with market `XX` answers 503 while `/health/ready` stays 200 (in `tls.int-spec.ts`, because staging requires TLS).
- With `PRACTICE_CLIENTS_MAX=2`, a third practice evicts the least recently used idle client; a client with a request in flight is never closed; after stepping the `FixedClock` by `PRACTICE_CLIENT_IDLE_MS`, `evictIdle()` closes an idle client. With two clients in use by signed-in requests, `forEachPractice` over five practices and a burst of public acquisitions evict neither, and at most `JOB_PRACTICE_CLIENTS_MAX` job clients are open at once.
- Practice data access without a resolved practice throws `PracticeContextMissingError`; `runInPractice` and `forEachPractice` isolate a failing practice and run the others; concurrent `PracticeCache` reads for A and B return their own values.
- Migration runner: with a fixture migration both practices end at the same `schema_version`. A fixture that fails in B leaves A migrated and B on its previous version with `migration_error_code`, and the runner exits 1; after the fixture is fixed, the next `medibooker-db migrate practices` resolves B's failed entry and completes B without a manual step. A fixture that waits on a lock held by the test fails with `lock_not_available` and succeeds on a retry once the lock is released.
- `pnpm check:migrations` fails for a fixture without the transaction header, for a `DROP` without `-- contract` and for a grant naming a role literally.
- A practice whose `schema_version` is older than `PRACTICE_SCHEMA_REQUIRED` answers 503 with `Retry-After`; `medibooker-db verify` exits 2 after the test alters a practice table by hand.
- `/health/ready` returns 200 with the platform database and 503 without it.
- A child-process test of `src/main.ts` (as `src/main.spec.ts` runs it) whose platform database refuses the connection at boot writes one fatal pino line without host, user or password, nothing to stderr, and exits 1; `bindLogFields` drops a binding outside the allowlist.
- The slug `Al Noor` is rejected by the CHECK and `al-noor` accepted; a second current slug for one practice is rejected; a retired slug of A cannot be inserted for B.
- Running the seed twice leaves all row counts unchanged.
- `pnpm --filter @medibooker/api db:generate` succeeds without any database variable; `pnpm test` still needs no Docker; `pnpm --filter @medibooker/api typecheck` covers `prisma/seed.ts` and `test/**`, which import `@medibooker/db-migrate/testing`.
- A forced `PrismaClientValidationError`, a CHECK violation and a unique violation carrying `secret-value` or `sara@example.test` leave no trace of the value in the captured logs or in the Testcontainers server log (which runs with `log_statement=all`); the server log contains no generated password after the provisioning tests; log capture during provisioning, migration and a refused connection finds no password, host or connection string.
- The heap per open practice client is measured in an integration test that opens 20 clients (`connection-memory.int-spec.ts`, which writes `apps/api/reports/practice-client-memory.json`); the result and the derived `PRACTICE_CLIENTS_MAX` default are in the commit body.
- `grep -nwE 'PrismaService|prisma\.\$transaction' .claude/skills/nestjs-feature/SKILL.md` (whole words, so `PlatformPrismaService` does not count) and `grep -n 'apps/api/prisma/schema.prisma' .claude/agents/architect.md` find nothing.
- Recorded: `pnpm db:up && pnpm db:migrate && pnpm db:seed` works locally with Docker Desktop from one root `.env`, and `docker compose exec -T db psql -U postgres -lqt` lists `medibooker_platform`, both practice databases and `practice_template`.

### F05 — API images, compose app stack and delivery pipeline

**Commit:** `build(docker): add API images, compose stack and GHCR publishing` · **Depends on:** U5 · **Owner:** devops-engineer; security-reviewer reviews

Scope ([07 §1–§6](07-docker-ci-cd.md)):

- From B04: one journey in the `images` job through the real API, sign-up to a cancel, because no test in CI books against it today (a stub stands in for the browser tests, and the journey was run by hand on the development stack).
- `apps/api/Dockerfile` (`base`, `deps`, `build`, `runtime`, `migrate`), `docker-bake.hcl`, `.dockerignore`, `.trivyignore`; `packageExtensions` for the Prisma peer; `apps/db-migrate/package.json` with `"files": ["src"]`.
- The migrate image: `medibooker-db` as entrypoint, both schemas, migration folders and configs under `/app/schema`, `PRISMA_ROOT=/app/schema`.
- Compose profile `app` with `migrate` (`migrate all`) and `api`, both with `DATABASE_CLUSTER_ENDPOINTS` set to `db:5432`, and the hardening baseline; the `migrate` service's memory limit from the measurement below.
- `ci.yml` jobs `images` (seeding the compose database from the runner before the stack starts) and `publish`; `deploy.yml` placeholder with the plan (platform migration, the practice runner, API, web, `verify`, smoke).
- The CodeQL job in `ci.yml` (ADR 0009 follow-up, deferred from F04, whose scope did not list it): a job that `ci-ok` needs, with an `output:` directory on `analyze` and a step that fails when the SARIF holds any result; reviewed exceptions only as dated `query-filters`; the weekly schedule of `codeql.yml` stays. Until then the main agent triages the CodeQL alerts after every push.
- `docs/adr/0010-container-images-and-delivery.md`: the image set, the `pnpm fetch` pattern, the migrate image as the home of every database task, secrets only as BuildKit secrets or run-time identity, tags, attestations, rollback by digest and expand/contract migrations across practices.

Acceptance:

- CI builds `api` and `api-migrate` on every push; on `v2-planning`, `publish` pushes `sha-<7>` and branch tags only after every other job is green, and `gh attestation verify oci://ghcr.io/mohamadalaskari/medibooker-api@<digest> --repo MohamadAlaskari/MediBooker-v1` exits 0.
- Runtime image: `docker run --rm --entrypoint id <api image>` prints `uid=1000`; `docker run --rm --entrypoint sh <api image> -c 'command -v npm; ls node_modules/.pnpm | grep -E "^(prisma|vitest|typescript)@"; ls node_modules/@medibooker 2>/dev/null | grep -x db-migrate'` prints nothing; the image contains no `.env`.
- The build fails when the OpenSSL 3 schema engine is missing from `/out/migrate`; `docker run --rm <migrate image> --help` lists `migrate` and `provision`.
- After `pnpm db:seed` from the host, the compose `migrate` service (`read_only: true`) exits 0 against the seeded practices through `DATABASE_CLUSTER_ENDPOINTS`, and `docker compose run --rm migrate migrate all` exits 0 a second time. From P02 the `images` job also gets `/api/v1/public/practices/al-noor` through the proxy.
- In the CI run of this commit, `docker compose down -v && docker compose up -d --wait db && pnpm db:migrate` passes ten times in a row (the TCP health check); afterwards the step runs once.
- The peak memory of `migrate practices` with `MIGRATION_CONCURRENCY=4` is measured with `docker stats`; the `migrate` service's `mem_limit` derives from it, and both numbers are in the commit body for OPS01's task size.
- Trivy (vulnerabilities and secrets, HIGH and CRITICAL, unfixed ignored) reports nothing for both images.
- Smoke test: `docker compose --profile app up -d --wait --no-build` brings `/health/ready` to 200.
- `docker save <api image> | gzip | wc -c` is at most 157286400 (150 MB); the migrate image at most 209715200 (200 MB); the measured sizes are in the commit body.
- `deploy.yml` dispatched for `staging` prints three digests, verifies their attestations, prints the plan with both migration steps and ends with the no-target notice; for `production` it waits for the reviewer.

As built, first part (the user's request of 2026-11-06, ADR 0010): the API and web images, two stacks (`compose.dev.yaml`, `compose.prod.yaml`) and the control menu `medibooker.cmd` / `medibooker.sh` with `scripts/medibooker.ts`, which needs only Node and Docker. A smoke test in the menu checks a running stack, and the CI job `images` starts both stacks through the menu and runs it. Still open, just before OPS01: `docker-bake.hcl`, `.trivyignore` and Trivy, publishing to GHCR with attestations, `deploy.yml`, the CodeQL job in `ci.yml`, the memory measurement of `migrate` (a 1 GB limit until then) and the size budgets. The Dockerfile of 07 §1 needed no change except health-check timings; `pnpm install --trust-lockfile` is left out. Open minors of the security review: `apps/web/src/proxy.ts` matches too little (`/apifoo`, `/en/foo.bar` get a 404 without CSP), to fix with P03, which adds `robots.txt` and the sitemap there; ports 8081 and 8082 go in OPS01; during a run of the integration tests Testcontainers publishes its PostgreSQL on all interfaces, with random passwords and synthetic data (accepted).

### F06 — Next.js web skeleton

**Commit:** `feat(web): add Next.js 16 skeleton with CSP nonce and locale routes` · **Depends on:** - · **Owner:** web-engineer; devops-engineer for the image

Scope ([03](03-web.md)):

- `packages/i18n` (minimal): committed `locales.json` (`["ar","en"]`, exported as `./locales.json`), `locales.ts`, `direction.ts`, `negotiate.ts`, tests, `tsc` build with `library.json`.
- `apps/web`: `next.config.ts` with the static headers, `src/proxy.ts` with `buildCsp`, the nonce and a locale-prefix redirect, `instrumentation.ts`, `[locale]/layout.tsx` (`lang`, `dir`), placeholder page, `not-found`, `global-error.tsx`, `healthz`; `typecheck` = `next typegen && tsc --noEmit`; ESLint 10-compatible Next.js and accessibility rules, recorded in ADR 0006.
- `vitest.config.ts` (React Compiler through `@rolldown/plugin-babel`, `server-only` alias, `TZ`); `playwright.config.ts` (projects, retries with `failOnFlakyTests`, `updateSnapshots`, reporters, the axe fixture).
- `apps/web/Dockerfile`, bake target `web`, compose `web` and `proxy` (Caddyfile without access log); CI job `e2e-web`; the `images` job gains the web image and the Playwright `@smoke` project against port 8080.
- `react-web-feature` skill: `src/proxy.ts` instead of `middleware.ts`, `src/app`, the `no-store` public fetch, the JSON-LD exception.

Acceptance:

- `curl -sI localhost:3000/` answers 307 to `/ar`, with `Accept-Language: en` to `/en`; `/de` answers 404.
- `/ar` has `lang="ar" dir="rtl"`, `/en` has `dir="ltr"`.
- Every HTML response carries a CSP with a fresh nonce, no `'unsafe-inline'` in `script-src`, HSTS and COOP, and no `Set-Cookie`; Playwright records no CSP violation; `/healthz` returns 200; axe reports no serious or critical violation.
- Unit tests: `buildCsp`; `negotiateLocale('en-US,en;q=0.9,ar;q=0.8')` is `en` and an unknown language gives `ar`; `headers()` output is identical for `APP_ENV=local` and `APP_ENV=production`.
- `git clean -xfd apps/web && pnpm --filter @medibooker/web typecheck` passes after `pnpm install --frozen-lockfile`.
- The web image runs as `node`, becomes healthy, and is at most 150 MB compressed; `docker compose --profile app up` serves port 8080 with `/api/*` proxied, and the `@smoke` project passes there.
- The proxy chooses the request id: a request to port 8080 with a client `X-Request-Id` (a valid UUID) is answered with a different id ([02 §4](02-api.md#4-request-pipeline-and-core-abstractions)).
- `grep -rn "middleware.ts" .claude/skills/react-web-feature/SKILL.md` finds nothing.

As built (lean mode): `output: 'standalone'`, the web Dockerfile, the compose `web` and `proxy` services and the `images` job move to F05, so the e2e tests run `next start`; the React Compiler in Vitest and the `server-only` alias wait for the first component test (X06). The reserved-slug list moves to M01, the first code that writes a slug. A 404 for a language we lack renders `global-not-found.tsx` (`experimental.globalNotFound`), because the root layouts live under `[locale]`. `eslint-plugin-jsx-a11y` runs on ESLint 10 although it does not declare it.

### F07 — Expo SDK 58 mobile skeleton

**Commit:** `feat(mobile): add Expo SDK 58 skeleton with router and test setup` · **Depends on:** - · **Owner:** mobile-engineer

Scope ([04](04-mobile.md)):

- `apps/mobile` from the SDK 58 default template, trimmed to `app/_layout.tsx`, `app/index.tsx` and `+not-found.tsx`; native packages through `npx expo install`; committed `expo-env.d.ts`; tsconfig order `strict.json`, then `expo/tsconfig.base`.
- `app.config.ts` (placeholder identifiers, `supportedLocales` from `@medibooker/i18n/locales.json`, `android.allowBackup: false`, `expo-build-properties` with `usesCleartextTraffic: false`, React Compiler, no `expo-updates`); `eas.json` (https origins for preview and production); `lib/env.ts` with the https rule.
- `jest.config.js` (ios and android projects, `passWithNoTests: false`, reporters, `transformIgnorePatterns`, `TZ` global setup) with a smoke test; a `jest` preset in `@medibooker/eslint-config` with `eslint-plugin-jest`; ESLint 10-compatible Expo rules, recorded in ADR 0006.
- pnpm `overrides` for React; a CI check for one `react` resolution; `expo export`, `expo install --check` and `expo-doctor` (directory check off) in `quality`.
- The home screen imports `getDirection` from `@medibooker/i18n`, proving workspace resolution through Metro.
- `react-native-screen` skill: tsconfig order, `reloadAppAsync()`, no `expo-updates`, https rule.

Acceptance:

- `pnpm --filter @medibooker/mobile test` runs at least one test in each project; with a `testMatch` that matches nothing it fails.
- `expo export --platform android --platform ios` passes in CI with the isolated linker; `npx expo install --check` and `expo-doctor` are clean.
- The lockfile resolves exactly one version of `react` (CI check).
- `git clean -xfd apps/mobile && pnpm --filter @medibooker/mobile typecheck` passes after `pnpm install --frozen-lockfile`.
- CI fails when `eas.json` gives `preview` or `production` an `EXPO_PUBLIC_API_ORIGIN` that does not start with `https://`; a unit test proves `env.ts` rejects `http://` outside `__DEV__`.
- `npx expo config --type public` shows `android.allowBackup: false` and no `updates` key.
- After the push (and U4), Renovate's dependency dashboard shows the Expo-managed packages of `apps/mobile/package.json` as awaiting approval.
- Recorded: the app opens in Expo Go (SDK 58) on an Android emulator from the Windows machine and shows RTL for an Arabic device.

### F09 — File storage: port, Azure and Azurite

**Commit:** `feat(storage): add object storage port with Azure and Azurite` · **Depends on:** - · **Owner:** backend-engineer and devops-engineer; security-reviewer reviews

The user's request of 2026-11-07: images and PDFs in Azure Blob Storage in production, in Azurite on the developer's machine, behind an abstraction so that another provider can be connected later ([ADR 0015](../adr/0015-object-storage.md)). The foundation of R02, M01 and M03; nothing but the check command uses it yet.

Scope: the port `ObjectStorage` with `ObjectKey`, an adapter for Azure and Azurite, an in-memory adapter for tests, the unconfigured variant, the env rules, the check command `dist/cli/check-storage.js`, the `azurite` service in `compose.dev.yaml` and the menu entries "Datei-Speicher prüfen" (both stacks), "Azure-Speicher eintragen" and "Azure-Speicher austragen" (production stack).

Acceptance: the contract suite `test/support/object-storage-contract.ts` passes on the in-memory adapter and on a real Azurite; a signed upload creates and cannot replace, an expired or edited signed URL is refused, a signed download cannot write, one practice's URL does not reach another's object; no key, signature or provider message reaches an error or the check command's output; the API starts without a provider; "Datei-Speicher prüfen" passes in the development stack.

As built (`95e5b8e`): all of the scope. The adapter bounds every call with abort signals, because `tryTimeoutInMs` does not end a silent server, and uploads a stream block by block, because the SDK's `uploadStream` passes no signal to its blocks (ADR 0015). `AZURE_LOG_LEVEL` joins the debug switches that staging and production refuse. The development image installs `--prefer-offline` instead of `--offline`, because pnpm's trust policy needs the metadata of a new package. Measured on Azurite 3.37.0 and on local fake servers, not on Azure: that needs the user's account (RT-95).

From the security review, which approved it: a signed upload with `c` also allows Copy Blob into its key, on Azurite even from another practice, so `ObjectInfo.copied` shows such an object for R02 to refuse; a signed download now also sets `Cache-Control: private, no-store`, because the uploader chooses the object's own headers. What the review left to R02 is in its section.

### I01 — The installation's practice at the root of its domain

**Commit:** `feat(web): serve the installation's practice at the domain root` · **Depends on:** - · **Owner:** web-engineer

The user's decision of 2026-11-10: one installation per practice, under the practice's own domain, and a patient learns nothing of other practices ([ADR 0016](../adr/0016-one-installation-per-practice.md)).

Scope: `PRACTICE_SLUG` in the web server's environment, required in staging and production; the practice's page at `/{locale}`; its own path and a retired slug lead there with 308; canonical address, `hreflang`, structured data and the sitemap name the root and nothing else; both stacks and the browser tests run as an installation of the demo practice; the menu's links and checks point at the root.

Acceptance: `/en` and `/ar` show the practice with its search data; `/en/al-noor` and `/en/old-name` answer 308 to `/en`; the sitemap names `/ar` and `/en` and no other practice; staging and production refuse to start without `PRACTICE_SLUG`.

As built (`f1af019`): all of the scope. The walk over all published practices left the web server: the sitemap of an installation has one practice. `GET /public/practices` stays in the API, unused by the web, until a cleanup removes it.

### I02 — The practice's brand

**Commit:** `feat(web): show the practice's brand on its pages and e-mails` · **Depends on:** - · **Owner:** web-engineer and backend-engineer

Scope: the practice's name (its logo with M01 and R02) instead of the MediBooker logo in the header of every page, also the sign-in, account and portal pages; a small "powered by MediBooker" in the footer; page titles with the practice's name; account e-mails in the practice's name, from `MAIL_FROM` of the installation; ADR 0002's fixed MediBooker logo becomes the footer note.

As built (`7f2c8ac`): the sign-in, account and portal pages carry the practice's name and a footer "Powered by MediBooker"; the practice's own page keeps its footer "Booking with MediBooker". Its colours stand in the head of every document, set once by the root layout: a layout that a client navigation renders anew would bring a style with another request's nonce, which the CSP refuses. Titles end with the practice's name through the root layout's title template, and the practice's page names it once. The API reads `PRACTICE_SLUG` too, required in staging and production, and an account e-mail says "your account at <practice>" with the name from the registry in the account's language. No catalogue text names MediBooker any more; the product's name comes as `{product}`. The logo of a practice follows with M01 and R02; until then its name stands in the frame.

## Cross-cutting systems

### X01 — Server error system and field validation

**Commit:** `feat(api): add problem+json error system and field validation` · **Depends on:** - · **Owner:** backend-engineer; security-reviewer reviews

Scope ([05 §1](05-errors-i18n-tokens.md#1-error-system)): `common/errors` (catalogue, field codes, `DomainException`, `ProblemDetailsFilter` with status-only mapping and `detail` = title, replacing F03's `UnknownExceptionFilter` and keeping its logging rule of [02 §8](02-api.md#8-logging-and-redaction), the `PracticeUnavailableError` and `PracticeContextMissingError` rows, validation exception factory, Prisma error mapper, `@ApiErrors`, `ProblemDetails` DTO); `common/validation` field decorators; `JsonOnlyMiddleware`; 401, 413, 415, 429 and 503 as problem+json; `docs/adr/0011-error-model.md`; `api-contract` skill (generic codes, status policy, URN type, `requestId` and `params`); `nestjs-feature` skill (`DomainException` signature, field decorators, `@PracticeScoped`).

Acceptance (HTTP tests without a database):

- Unknown route → 404 `NOT_FOUND`; `GET /api/v1/nope?email=sara@example.test` → 404 with the query in neither the body nor the captured logs.
- Deny-by-default → 401 `UNAUTHENTICATED`.
- The probe DTO returns `items[0].name` paths with field codes; an unknown property (including `practiceId`) → `UNKNOWN_FIELD`.
- Malformed JSON containing `secret-value` → 400 `VALIDATION_FAILED`, value in neither body nor logs; a body over 100 kB → 413; a `text/plain` POST → 415; throttled → 429 with `Retry-After`.
- A thrown `Error('secret-value')` → 500 `INTERNAL_ERROR` with a request id and no stack, message or value in the body or logs; a `PracticeUnavailableError` → 503 `SERVICE_UNAVAILABLE` with `Retry-After`.
- Every error response has `application/problem+json`, `Cache-Control: no-store` and `X-Request-Id`.
- Unit: catalogue invariants and one table test per filter source.

As built (one commit with X02): `jsonOnly` is a plain middleware in `common/errors`; the shared field decorators of `common/validation` wait for their first consumer, until then a DTO uses class-validator directly; `PracticeContextInterceptor` keeps answering with a `ServiceUnavailableException`, which the filter renders by its status, and the filter also renders a `PracticeUnavailableError` that reaches it directly.

### X02 — OpenAPI 3.1 contract and app-config endpoint

**Commit:** `feat(contract): generate OpenAPI 3.1 document and app-config endpoint` · **Depends on:** - · **Owner:** backend-engineer; architect reviews

Scope:

- `src/openapi/document.ts` and `generate.ts` (explicit placeholder env), Swagger UI behind `OPENAPI_UI_ENABLED`, committed `apps/api/openapi.json`; root scripts `generate` and `check:drift` (`scripts/check-drift.ts` regenerates and fails on any change or untracked generated file); `verify` gains `check:drift` (it runs `build` since F03).
- `modules/app-config`: `GET /api/v1/public/app-config` → `{ minimumSupportedVersion: { ios, android }, supportedLocales, defaultLocale }` with `@PublicCache(300)`.
- `NoStoreInterceptor` with the `@PublicCache` guardrail; architecture tests ([02 §11](02-api.md#11-openapi-generation-x02)), including the `@PracticeScoped` placement and the `@Public()` path allowlist, which extends the route inventory test of F03 (`common/security/public-routes.spec.ts`: every route Nest maps, read at runtime through `DiscoveryService` and `isPublicHandler`, so a marker applied through `applyDecorators` counts too) with the allowed path prefixes; `test/integration/authz/matrix.ts` with `PUBLIC_OPERATIONS` and the registry architecture test.
- `docs/adr/0012-contract-pipeline.md` (Orval, committed generated code, drift checks).
- `api-contract` skill: public endpoints under `/public/practices/{slug}/…`, practice-scoped paths under `/practices/{practiceId}/…`, account-level ones under `/me` (ADR 0005 §3); tokens never in paths (`POST /practices/{practiceId}/staff-invitations/accept`, `POST /practices/{practiceId}/family-invitations/accept` and the E10 revoke-all token in the body); cache rules (practice page `no-store`, free times `max-age=30`, app config `max-age=300`, no ETag until a consumer needs one).

Acceptance:

- Running `pnpm generate` twice leaves `git status --porcelain` empty; a DTO change without regeneration makes `pnpm check:drift` exit 1.
- `openapi.json` declares `3.1.0`; operationIds are unique; every operation has `ProblemDetails` responses.
- `GET /api/v1/public/app-config` → 200 with `Cache-Control: public, max-age=300`; every non-public test route answers `Cache-Control: no-store`; a `@PublicCache()` on a route outside `/api/v1/public/` keeps `no-store` and logs an error.
- `/api/docs` returns 404 when disabled.
- Architecture tests fail for a fixture controller with `@Public()` outside the allowed prefixes, for a route under `/practices/{practiceId}` without `@PracticeScoped`, and for an operation missing from the registries.
- `grep -n "family-invitations/{token}" .claude/skills/api-contract/SKILL.md` finds nothing.

As built (one commit with X01): deferred are the app-config endpoint (→ X08), `@PublicCache` (→ P05) and ADR 0012 (→ X03). `@ApiErrors` is replaced by a post-processing step in `src/openapi/document.ts`: each operation gets its ProblemDetails responses by what its path says. `AUTHZ_MATRIX` and `CROSS_PRACTICE` arrive with A01; `test/integration/authz/matrix.ts` holds `PUBLIC_OPERATIONS`.

### X03 — Generated API client package

**Commit:** `feat(api-client): generate typed client, query hooks, zod and mocks` · **Depends on:** - · **Owner:** web-engineer; mobile-engineer reviews

Scope ([05 §1.6](05-errors-i18n-tokens.md#16-client-apierror-medibookerapi-client)): `packages/api-client` as a source package: `orval.config.ts` (react-query with the fetch mutator, zod target, MSW mocks), `src/http/fetcher.ts` (`configureApiClient({ baseUrl, credentials, getHeaders, timeoutMs, fetch })`, `apiFetch`), `src/errors`, `src/query` (`createQueryClient`, `createTestQueryClient`, `shouldRetryQuery`), committed `src/generated`, exports `.`, `./zod`, `./mocks`; tsconfig with shared fetch types; Vitest with MSW 3 and coverage gates; the drift check covers the client; `react-web-feature` skill: form schemas from `@medibooker/api-client/zod`, no `packages/validation`.

Acceptance:

- Tests: problem+json → `ApiError` with code, field errors and request id; an unknown future code is kept and `errorMessageKey` falls back by status; a non-JSON 502 → `UNEXPECTED_RESPONSE`; a rejected fetch → `NETWORK_ERROR`; a timeout → `TIMEOUT`; 204 → `undefined`; headers and the abort signal pass through; an injected `fetch` is used; the `shouldRetryQuery` table; nested field paths map; `useGetAppConfig` works against the generated MSW handler.
- A test asserts the client's `ErrorCode` equals the server catalogue.
- `pnpm --filter @medibooker/web typecheck` and `pnpm --filter @medibooker/mobile typecheck` pass.
- `grep -n "packages/validation" .claude/skills/react-web-feature/SKILL.md` finds nothing.

As built (one commit with X05): the app-config endpoint moved to X08, so the query test runs against `getPublicPractice`, and it uses `queryClient.query` with the generated options instead of rendering the hook, because no renderer exists before X06. The mobile typecheck moved to F07; the web consumes the package from P03. `msw` and `@faker-js/faker` are devDependencies. MSW 3 renames `onUnhandledRequest` to `onUnhandledFrame`.

### X04 — Shared ICU message catalogues

**Commit:** `feat(i18n): add shared ICU catalogues for Arabic and English` · **Depends on:** D1 · **Owner:** web-engineer and mobile-engineer; ui-designer reviews the copy

Scope ([05 §2](05-errors-i18n-tokens.md#2-i18n-and-rtl)): `packages/i18n/src/messages/{ar,en}.json` with `common`, `app`, `a11y`, `errors` (every catalogue code plus the client codes) and `validation`; `scripts/generate.ts` writing `src/generated/catalog.ts` and `locales.json`; `formats.ts`, `format-locale.ts`, `bidi.ts`; a `dev` script `tsc -b -w --preserveWatchOutput`; tests including render-all with the chosen engine; the `.gitleaks.toml` allowlist for the message files with a new case in `scripts/gitleaks-config.test.ts`; `docs/adr/0013-i18n-binding.md` recording D1; the `CLAUDE.md` i18n row changed by the main agent if D1 is option B.

Acceptance:

- Catalogue tests pass: key parity, ICU parse, argument parity, Arabic plural categories, every server and client code present, no HTML.
- The render-all test formats every key in both locales with the runtime engine without an error.
- Deleting one Arabic key fails `pnpm test`; a fixture locale file plus `pnpm generate` needs no code change; `locales.json` equals `LOCALES`.
- Unit tests: `getDirection`, `negotiateLocale`, `toFormattingLocale('ar', { numberingSystem: 'arab', hourCycle: 'h23' })` = `ar-u-nu-arab-hc-h23`, `isolateLtr`.
- `CI=true pnpm test:root` passes with a message key ending in `password` and a long label in the catalogue.
- Recorded: with `pnpm dev` running, an edit to `ar.json` reaches the web app without a manual build.

As built (one commit with X06, X07 and P03, ADR 0013): the catalogue with `common`, `app`, `a11y`, `errors`, `validation`, `errorPage` and `practicePage`, `formats`, `toFormattingLocale`, `isolateLtr`, the generator and the tests of 05 §2.3, among them the render-all test with `use-intl/core`. The `.gitleaks.toml` allowlist waits for the first key that needs it (A05), because the rule does not report labels with spaces. No `dev` script: `pnpm generate` and a rebuild of the image.

### X05 — Design and motion tokens from Figma variables

**Commit:** `feat(design-tokens): build design and motion tokens from Figma` · **Depends on:** - · **Owner:** ui-designer (export, Motion collection) and web-engineer

Scope ([05 §3](05-errors-i18n-tokens.md#3-design-tokens-motion-tokens-and-practice-themes)): the DTCG export into `packages/design-tokens/tokens/*.json`, including the new Motion collection with the confirmed values; `scripts/build-tokens.ts`; committed `css/tokens.css` and `src/generated/tokens.ts` with motion exports; `createColorTheme`, `BRAND_PRESETS`, `spacing`, `radius`, `borderWidth`, `typography`, `motion`, `contrastRatio`; a `dev` script; the drift check covers the outputs; the `design-system` skill pipeline section and `.claude/agents/ui-designer.md`.

Acceptance:

- Contrast: all five presets in light and dark match the `design-system` table (±0.01); every semantic text/background pair ≥ 4.5:1; borders and icons ≥ 3:1.
- Every semantic token exists in light and dark; only the nine brand tokens reference `var(--brand-*)`.
- Two builds are byte-identical; the snapshot of variable names and motion exports is stable.
- A Tailwind compile of a fixture generates no utilities for primitives or Tailwind defaults.
- `grep -rn "tokens.json" .claude/agents/ui-designer.md .claude/skills/design-system/SKILL.md` finds nothing.

As built (one commit with X03):

- A build of our own (`scripts/build-tokens.ts`) replaces Style Dictionary: every output would have been a custom format, and the package has one dependency less.
- The token files were checked against Figma with a read-only script: a hash per collection and mode, all 11 equal.
- Beyond the six namespaces, the stylesheet also resets `--font-weight-*`, `--leading-*`, `--tracking-*`, `--shadow-*`, `--ease-*` and `--container-*`. It adds what these replace: `shadow-elevation-*` from the Figma effect styles, `ease-standard`, `-enter`, `-exit`, and `max-w-page` with the two breakpoints from the `design-system` skill (`tokens/layout.json`, no Figma variables).
- Line heights are set directly per `:lang()`, so a passage in another language gets its own.
- No `dev` script: `node --watch-path` is not available on Linux and tokens change rarely; run `pnpm generate`.
- Open for the ui-designer: the `Motion` collection in Figma (`tokens/motion.json` is the source until then), and the decision on `text/tertiary` on `bg/subtle`, 4.43:1 in light. Until then the rule in the `design-system` skill applies, and a test keeps the value visible.

### X06 — Web shell: i18n, RTL, theme, fonts, motion and error routes

**Commit:** `feat(web): add i18n, RTL, theming, fonts, motion and error routes` · **Depends on:** D1 · **Owner:** web-engineer

Scope ([03](03-web.md)): the i18n binding (routing, request config, navigation, composition with the CSP proxy); fonts through `next/font/local`; Tailwind with `tokens.css` and the base layer; `data-theme` (cookie from signed-in areas, default `system`) and `data-brand`; providers (i18n, query); `lib/api.server.ts` (forwards `X-Forwarded-For`), `lib/api.client.ts`, `lib/errors.ts` (`useErrorMessage`), `lib/format.ts`; `[locale]/error.tsx` and `not-found.tsx`; skip link and focus on route change; `lib/motion` (`gsap.ts`, `inlineX`, `use-motion`); `no-system-clock` on `src/app/**`; `test/render.tsx`, `test/setup.ts`; `visual-baselines.yml`; the i18n section of `react-web-feature`.

Acceptance:

- Playwright: `/ar` renders RTL with Noto Sans Arabic and `/en` LTR with Inter (computed `font-family`); every request is same-origin; public routes set no cookie; dark mode follows `prefers-color-scheme` emulation and `data-theme`; `data-brand="ocean"` changes only the brand tokens (computed style of a neutral token unchanged); axe reports 0 serious or critical violations.
- Component test: an `ApiError` with `SLOT_NOT_AVAILABLE` renders the Arabic and English messages.
- Unit tests: `format.ts` in `Asia/Riyadh` with Western and Arabic-Indic digits and in `Europe/Berlin` across 2027-03-28; `inlineX` in `ltr` and `rtl`; the reduced-motion wrapper applies the end state; `api.server.ts` forwards `X-Forwarded-For` unchanged.
- A lint fixture with `new Date()` under `src/app/` fails.
- Dispatching `visual-baselines.yml` uploads the PNGs as an artifact.

As built (one commit with X04, X07 and P03): the next-intl binding (ADR 0013), the fonts, Tailwind with `tokens.css`, `theme.css`, `lib/api.server.ts`, `lib/format.ts`, `error.tsx`, `not-found.tsx`, the skip link, `lib/motion/gsap.ts` and `no-system-clock` on pages. `proxy.ts` matches files at the top level by extension, which closes the review finding of F05. Wait for their first consumer: the query provider, `lib/api.client.ts`, `lib/errors.ts`, the focus on route change and `inlineX` (P06, A05), `visual-baselines.yml`. Component tests render with `renderToStaticMarkup`, so no DOM library is needed yet. React Aria reads the nonce from `<meta property="csp-nonce" nonce>` for the style it injects.

### X07 — Web UI kit: shadcn/ui on React Aria

**Commit:** `feat(web): add shadcn/ui kit on React Aria mapped to design tokens` · **Depends on:** - · **Owner:** web-engineer, using the Figma pages Buttons, Form Controls, Badges & Avatars and Feedback

Scope (ADR 0007, [03 §9](03-web.md#9-styling-tokens-tailwind-and-shadcnui)):

- First `shadcn` as an exact-pinned devDependency of `apps/web` through the catalog, so pnpm's release-age gate and the lockfile apply to the CLI (ADR 0006); then `pnpm --filter @medibooker/web exec shadcn init --base aria --rtl`; `components.json`; `src/styles/theme.css` (variable mapping, `dark` variant).
- Components for v1: Button, Field/FieldGroup, Input, Textarea, Checkbox, RadioGroup, Switch, Select, Badge (status map), Avatar, Alert, Dialog, Sheet, Popover, Tooltip, Tabs, Skeleton, Spinner, Empty, sonner Toaster; `ErrorState` and `QueryState` composed from them. Variants and sizes adapted to Figma.
- The sonner CSP hash generator (`src/generated/csp-hashes.ts`) and the `buildCsp` change; `MutationCache` toasts.
- `prettier-plugin-tailwindcss`.
- `[locale]/dev/kit` overview in RTL and LTR, light and dark, with the motion patterns of ADR 0008 documented.
- `e2e/rtl-layout.spec.ts`; Figma node links in the handoff.

Acceptance:

- A test resolves every shadcn variable used by the components to a `--color-*` or `--radius-*` token; lint and the test find no hex, `oklch()`, `rgb()` or `hsl()` literal in `theme.css` or `components/ui`.
- Component tests by role and label: Dialog focus trap and Escape, RadioGroup arrow keys in RTL and LTR, disabled and loading states, mirroring of directional icons only.
- Playwright: the kit page is axe-clean in `ar` and `en`, light and dark; a page that shows a toast has no CSP violation; at 390 px with long synthetic Arabic strings `document.documentElement.scrollWidth <= innerWidth` and no button or badge overflows; the focus outline colour equals the `border/focus` token.
- `pnpm --filter @medibooker/web generate` twice leaves no diff.
- `pnpm --filter @medibooker/web exec shadcn add button --dry-run` reports no change to existing files; `grep -rn 'npx shadcn' .claude/skills docs/adr` finds nothing.

As built (one commit with X04, X06 and P03): `shadcn init --base aria --rtl` and `components.json`, `theme.css` with the variables of ADR 0007, and Button, Badge and Alert adapted to Figma and the tokens. `tokens/layout.json` gains `size.touch-target`, so `min-h-touch-target` exists; a class without a token generates nothing. The other components, the `dev/kit` page and the sonner hash come with their first consumer. When a component is added, map its classes to tokens: shadcn's defaults (`h-8`, `text-sm`, `px-2.5`) have none. It also imports `cn` from the package: use `@/lib/utils`, whose `cn` knows the type tokens, because the package's own reads `text-label-large` as a colour and silently drops it next to `text-text-brand`; a lint rule says so. `--overwrite` on the CLI replaces the adapted components, so leave it off.

### X08 — Mobile shell: i18n, RTL, theme, fonts and version gate

**Commit:** `feat(mobile): add i18n, RTL, theming, fonts and version gate` · **Depends on:** D1 · **Owner:** mobile-engineer

Scope ([04](04-mobile.md)): the i18n provider with the shared catalogue; `locale.ts`; `direction.ts` (`forceRTL`, `reloadAppAsync()`); `LocaleProvider`; fonts through the `expo-font` plugin; `ThemeProvider`, `useTheme`, `createColorTheme`; `query.ts` and `OfflineBanner`; `api.ts`; `VersionGate`; the `ErrorBoundary` export; `app/(dev)/intl-check.tsx`; `intl-polyfills.ts` only for gaps found; Jest transform list for the binding; the offline-cache rules ([04 §10](04-mobile.md#10-offline-data)) in the `react-native-screen` skill.

Acceptance:

- Jest: `ar` is chosen when the device is neither `ar` nor `en`; a direction mismatch calls `forceRTL` and `reloadAppAsync` (mocked); the version gate blocks below the minimum (fake fetch); the offline banner appears when NetInfo reports offline; `ErrorBoundary` renders the translated fallback; the provider renders a real Arabic plural from the catalogue.
- Recorded emulator check: the intl-check screen shows the Arabic plurals for 0, 1, 2, 3, 11 and 100, Arabic-Indic digits with `numberingSystem: 'arab'`, times in Riyadh and Berlin, RTL and LTR, light and dark, the largest font size.
- `grep -n "src/locales" .claude/skills/react-native-screen/SKILL.md` finds nothing.

### X09 — Mobile UI kit v1

**Commit:** `feat(mobile): add design-system UI kit v1` · **Depends on:** - · **Owner:** mobile-engineer, using Figma

Scope: `src/components/ui`: Text (11 presets per locale, `textAlign`, `writingDirection`), Button, IconButton, Icon (lucide-react-native and react-native-svg, RTL mirroring), TextField (LTR mode for phone and code), Checkbox, Radio, Switch, Badge, Avatar, Alert, Dialog (Modal), Toast (announced), EmptyState, ErrorState, Skeleton, Screen (safe area, keyboard); motion through Reanimated with the motion tokens; the dev-only `(dev)/kit` screen.

Acceptance:

- RNTL tests: `accessibilityRole`, label and state on every touchable; a hit-area helper proves at least 44 pt from style size plus `hitSlop`; `allowFontScaling` is never false; no `numberOfLines` on body text; only directional icons mirror in RTL; with reduced motion the end state applies.
- Lint finds no hex values and no `left`/`right` style keys.
- Recorded: VoiceOver and TalkBack spot checks in `ar` and `en`; screenshots at 375 pt and on a large device.

### X10 — Android emulator smoke test

**Commit:** `ci(mobile): add Android emulator smoke test for Hermes and RTL` · **Depends on:** - · **Owner:** devops-engineer and mobile-engineer

Scope: `.github/workflows/mobile-device.yml`, nightly and on dispatch, not a required check: `npx expo prebuild -p android` with `EXPO_PUBLIC_E2E=1`, `./gradlew assembleRelease`, `reactivecircus/android-emulator-runner` v2.38.0, Maestro (newest release past one day) with `.maestro/smoke-intl-rtl.yaml` in `ar` and `en`; B05 adds `.maestro/offline.yaml` with `toggleAirplaneMode`.

Acceptance:

- A dispatched run passes: Maestro sees the Arabic plural texts for 0, 1, 2, 3, 11 and 100, Arabic-Indic digits, RTL layout markers in `ar` and LTR in `en`.
- The JUnit report is uploaded; `ci-ok` does not depend on the job.

## Public practice page

### P01 — Practice aggregate data model

**Commit:** `feat(practice): add practice model and public practice endpoint` (one commit with P02; the plan's header was `feat(practice): model practice aggregate, services and staff members`) · **Depends on:** - · **Owner:** architect (schema), then backend-engineer

Scope: practice-schema tables without `practice_id`, with plain foreign keys, data-class comments and per-locale `jsonb` CHECKs, in one atomic practice migration that also runs `CREATE EXTENSION IF NOT EXISTS btree_gist`:

- `practice_settings` (singleton): time zone, default and supported locales, `week_start`, `weekend_days`, `numbering_system`, `hour_cycle`, public contact, booking parameters with range CHECKs (BR-02, BR-03, BR-04, BR-13 defaults);
- `practice_pages` (singleton): `about` and `directions` per locale, section flags, legal URLs; publication is not here but in the registry;
- `opening_hours`: weekday, opening and closing minutes, `CHECK (opens_at < closes_at)`, `EXCLUDE USING gist (weekday WITH =, int4range(opens_at, closes_at) WITH &&)`;
- `special_days`: unique `date`; closed or valid hours;
- `practice_themes` (singleton): preset enum, `custom_color` and `scale text[]` with the CHECKs of [05 §3.2](05-errors-i18n-tokens.md#32-custom-brand-colour-br-23-m01), `adjusted`, `initials` (at most 2 characters);
- `services`: names per locale, duration CHECK 5–480, `is_bookable_online`, `allowed_insurance_types`, `active`, `sort_order`;
- `staff_members`: profile (title, names, position, `is_provider`, specialty per locale, languages, `hidden_at`); the membership link arrives in A01;
- `staff_consents`: `type` (`PHOTO`, `PUBLIC_PROFILE`), `text_version`, `given_at`, `withdrawn_at`; partial unique `(staff_member_id, type) WHERE withdrawn_at IS NULL`.

Platform schema: `practices.name` (per-locale `jsonb`, public) and `practices.published_at`, with `GRANT UPDATE (name, published_at, updated_at) ON practices TO platform_app` as the only update right of the API on the registry. `medibooker-db provision` gains `--time-zone` and `--default-locale` and writes them into `practice_settings`; the migration inserts the static singleton defaults. The seed fills every practice table in both practice databases. A unit-project architecture test fails when the practice schema declares a `practiceId` field. `medibooker-domain` skill: `StaffMember`, `StaffConsent`, `Membership` (planned); market, name, slug and publication in the platform registry instead of `PracticeSettings.country`, `PracticePage.slug` and `PracticePage.published`.

Acceptance:

- Integration, in a practice database: an overlapping opening interval is rejected by `EXCLUDE`; an invalid hex, a 10-item or `#000;}` scale, a duration of 4 and a non-object locale text are rejected by CHECK; a duplicate special day is rejected; a second `practice_settings` row is rejected; a second active consent of one type is rejected; deleting a service referenced elsewhere is restricted.
- `provision` of a new practice succeeds on a cluster where `btree_gist` was never installed, as the practice owner without superuser rights.
- The architecture test fails for a fixture model with a `practiceId` field.
- Running the seed twice changes nothing; both drift specs are clean; no new endpoints.

### P02 — Public practice endpoints

**Commit:** `feat(practice): add practice model and public practice endpoint` (one commit with P01; the plan's header was `feat(practice): add public practice endpoints with open-now status`) · **Depends on:** - · **Owner:** backend-engineer; security-reviewer reviews the `@Public()` endpoints

Deferred in lean mode (2026-11-05):

- `GET /api/v1/public/practices` (the cursor list with `CursorQueryDto` and `CursorPage`) → P03, whose sitemap is its consumer.
- The route cache (`PUBLIC_ROUTE_CACHE_MS`), the 100-practice crawl test, the two-instance test and `CLOCK_FIXED_AT` → later, when a measurement or the web e2e needs them.
- The reserved-slug list and its web-route test → F06; OpenAPI and client regeneration → X02 and X03; problem+json → X01.

As built: the route sets its limit of 60 requests per minute on the `default` throttler with `@Throttle` instead of a named `public` one, which keeps the plain `Retry-After` header and needs no `RATE_LIMIT_PUBLIC_PER_MINUTE`. Times in the response are wall-clock strings such as `09:00`. `staff_members.position` is text per locale like `specialty`. `weekend_days` has no column default, because Prisma 7.10.1 reports a `SMALLINT[]` default as drift on every run; the migration writes the first value. Since a slug now routes public requests, `platform_app` may only add a slug and set its `retired_at`; it can no longer repoint or delete one.

Scope:

- `GET /api/v1/public/practices/{slug}` and `GET /api/v1/public/practices` (cursor list of published slugs, read only from the platform database, no `lastmod`; introduces `CursorQueryDto` and `CursorPage`).
- `@PracticeScoped('slug')` with retired-slug resolution and the route cache (`PUBLIC_ROUTE_CACHE_MS`, `Clock`-based); the status table decides before any practice client is leased (unknown, unpublished, provisioning and offboarded practices 404, suspended, moving and under-review ones 503); leases with purpose `public`; name and slug from the registry, page, theme, team and hours from the practice database.
- Explicit response DTOs with BR-22 and BR-24 fields only and the scale item pattern; localisation by `Accept-Language` with `Content-Language`; `openNow` and `nextChangeAt` from a pure `computeOpenNow` (Temporal, practice zone, special days of the next 60 days); `Clock` with `CLOCK_FIXED_AT`.
- Team members only with an active `PUBLIC_PROFILE` consent and not hidden; `photoUrl` null until R02.
- `Cache-Control: no-store` (no ETag); the named `public` throttler.
- Reserved-slug list including every static first segment of the web routes; the `CROSS_PRACTICE` registry starts; `tenancy/resolution.int-spec.ts` (slug cases); contract and client regenerated; `api-contract` skill catalogue rows updated.

Acceptance:

- The response key set equals an allowlist snapshot: no staff e-mail, phone or user id, no counts, no member without consent or with `hidden_at`.
- Unknown, unpublished, provisioning and deprovisioning slugs return identical 404 bodies, and the connection manager's count of open clients is unchanged after them; a suspended practice answers 503 with `Retry-After`; a retired slug returns 200 with the current `slug`.
- After unpublishing, the same instance answers 404 at once and another instance within `PUBLIC_ROUTE_CACHE_MS` (two app instances in one test, `FixedClock` steps).
- Crawling the public pages of 100 practices with `PRACTICE_CLIENTS_MAX=40` causes no 503 for a signed-in test route that runs in parallel and never evicts its client; above `PRACTICE_CLIENT_CREATIONS_PER_SECOND` the crawl gets 503 at once instead of waiting.
- `openNow` is correct at the boundaries with `FixedClock`: a Riyadh Friday, the 2026-11-19 closure, a Berlin evening across the DST change.
- `Cache-Control` is exactly `no-store`; `Content-Language` is set.
- With `TRUST_PROXY_HOPS=1`, requests from two forwarded addresses are counted separately: the 61st from one address gets 429 while the other still gets 200.
- B's services never appear in A's page; the cross-practice registry test passes.
- `parseEnv` rejects `CLOCK_FIXED_AT` under `APP_ENV=production`.
- A unit test proves every static first segment under `apps/web/src/app/[locale]` is reserved.

### P03 — Public practice page on the web

**Commit:** `feat(web): render public practice page with theme and SEO metadata` · **Depends on:** D2 · **Owner:** web-engineer (Figma PW13/PW14)

Scope:

- `[locale]/(public)/[slug]` as a server component fetched with `no-store`; `notFound()` on 404; `permanentRedirect()` for a retired slug.
- Sections: header (Practice Mark, section links, language switch, Sign in, Book appointment), hero with the open-now Badge, facts and opening hours (today from the API), special days, services, team, find us and contact (plain maps link, `rel="noopener noreferrer"`, the "no medical details by e-mail" hint), footer (legal links, "Online booking with" and the Teal logo), free-times placeholder.
- Theme through `data-brand` or `brandStyle`; first GSAP use (section reveals below the fold with ScrollTrigger, reduced motion respected).
- SEO: `generateMetadata` with hreflang, canonical and `metadataBase` from `PUBLIC_SITE_URL`; escaped JSON-LD `MedicalClinic`; `sitemap.ts` and `robots.ts` with `force-dynamic`.
- CI: `e2e-web` gains the compose databases (`pnpm db:migrate && pnpm db:seed`) and the built API with `CLOCK_FIXED_AT`; the `webkit-ar-rtl` project; the first `@visual` baselines; the `images` job checks `robots.txt` under two `APP_ENV` values.

Acceptance:

- Playwright in `ar-rtl`, `en-ltr` (390 and 1440 px) and `webkit-ar-rtl`: both seeded practices render from their own databases with the right `dir` and their own theme; no `Set-Cookie`, no third-party request, no CSP violation; axe 0.
- hreflang and canonical are correct; the JSON-LD has name, address and opening hours and escapes `<`.
- An unpublished practice → 404; a retired slug → 308 to the current URL.
- With JavaScript disabled, every section is visible; with `prefers-reduced-motion: reduce`, sections are in their end state.
- `@visual` baselines for PW13/PW14 in light, dark and Ocean exist and are approved by the ui-designer in the handoff.
- Component test: the open-now text in the practice zone with Arabic-Indic digits.
- The same web image serves `robots.txt` with the run-time `PUBLIC_SITE_URL` under `APP_ENV=local` and `APP_ENV=staging`.
- The page at 390 px has no horizontal overflow with long synthetic Arabic values.

As built (one commit with X04, X06 and X07, decision D2: not cached): all sections of the page from the API, with `today` added to the DTO so the web reads no clock; the theme through `brandStyle` for presets and custom scales; section reveals with GSAP and ScrollTrigger; metadata with hreflang and canonical, escaped JSON-LD, `robots.ts`; links to https only; a slug that cannot be one never reaches the API. The end-to-end tests run against a stub of the API, in both directions, and also prove that the web passes the visitor's address on; the smoke test of the control menu proves the whole way to a practice's database and that the proxy replaces a forged address (RT-03), in the CI job `images`. A page that cannot reach the API is marked `noindex`; `robots.ts` keeps search engines out of `/api/`, the portal and the dashboard follow with A05. Left out until they have something to link to or show: Sign in (A05), the reception card (M03, D14). In its own commit: `sitemap.ts` with `GET /public/practices`, which `PublicPracticeService` answers from `PublishedPractices` in the tenancy layer (active, published, in a served market; a suspended practice is not listed while it answers 503), with `CursorQueryDto` and `CursorPage` in `common/http/cursor-page.ts`. The sitemap names every practice in every language of the site, because the registry does not know a practice's languages. Its walk over the API runs on the visitor's limit of 60 requests per minute, so `loadPublishedSlugs` stops at 50 pages, 5,000 practices, without saying so. Before that number the sitemap needs a short in-process memo with the last good list (not `use cache`, where `headers()` throws), a log line at the cap, and several files; `generateSitemaps` runs at build time, without the environment and without `headers()`, so it cannot reuse this client setup. Moved: the `webkit-ar-rtl` project and the `@visual` baselines, until the ui-designer reviews them; the logo as an image. Free times stay a placeholder until P06.

### P04 — Availability rules and DST-safe slot generation

**Commit:** `feat(scheduling): add availability rules and DST-safe slot generation` · **Depends on:** - · **Owner:** backend-engineer

Scope:

- Practice schema: `availability_rules` (provider = a staff member with `is_provider`; weekday; start and end minutes with CHECK; `slot_minutes` 5–240; `valid_from`/`valid_to`), `availability_rule_services`, `availability_exceptions` (`starts_at < ends_at`, reason enum without health values), `slots` (provider, `starts_at`, `ends_at`, status `OPEN`/`BOOKED`/`BLOCKED`, `rule_id`; unique `(provider_id, starts_at)`; `EXCLUDE USING gist (provider_id WITH =, tstzrange(starts_at, ends_at) WITH &&)`; `CHECK (ends_at > starts_at)`; partial index `(starts_at) WHERE status = 'OPEN'` declared in the schema).
- Pure `generateSlots()` with Temporal: skips nonexistent local times, uses the earlier instant for ambiguous ones, skips weekend days, closed special days and exceptions. `SlotGenerationService` (`createMany` with `skipDuplicates`; removes only `OPEN` slots no longer backed by a rule).
- CLI `slots:generate`; a nightly `@nestjs/schedule` job that runs per practice through `forEachPractice`; `practice_job_runs (job, practice_id, period)` in the platform schema and `PracticeJobRuns.claim()`, so each practice is visited by one instance per night before any client is leased ([02 §5](02-api.md#5-data-layer-and-tenancy)).
- `DomainEvents` (`emitAfterCommit`, listeners awaited before the lease is released) and `slots.changed` after commit; lint restriction on `@nestjs/event-emitter`.
- `docs/adr/0014-time-handling.md`: Temporal, practice zones, elapsed durations for BR-03, BR-04 and BR-13, nonexistent and ambiguous times. `medibooker-domain` skill: BR-04's deadline counts elapsed hours.

Acceptance:

- Unit tests with 100 % coverage of the rules file pass the BR-15 fixtures of [06 §3](06-testing.md#br-15-fixtures).
- Integration: a second run, also concurrent, creates 0 rows; an overlapping insert violates `EXCLUDE`; `BOOKED` and `BLOCKED` slots survive a rule change; the event fires after commit and never on rollback; with two app instances, the `practice_job_runs` claim makes the second run for the same practice and night a no-op that leases no client; the nightly job generates for A and B with each practice's own zone and weekend, and a failure in B does not stop A.
- Test names cite BR-06, BR-07 and BR-15.

As built (one commit with P05): the schema, `generateSlots`, `dayRange` and `bookableWindow` in `slots.rules.ts`, `SlotGenerationService`, the nightly `SlotGenerationJob` and ADR 0014. The job also runs at every start of the API, for a night an instance was down, and `pnpm slots:generate` (`src/cli/generate-slots.ts`) runs it by hand; the menu's seed entry calls it, because the seed never reads the clock and writes no free times itself. The seed has rules, an absence and one fixed `BLOCKED` slot per practice, so tests have real ids. A database seeded before this commit has no rules: menu entry `reset-db`, then `seed`.

Deferred in lean mode: `DomainEvents` and `slots.changed` (no consumer before realtime; M04's admin changes and R03 are the first), `practice_job_runs` and `PracticeJobRuns.claim()` (a second instance only repeats idempotent work; before OPS01 runs more than one).

### P05 — Public free-times endpoints

**Commit:** `feat(scheduling): expose public free times per practice` · **Depends on:** - · **Owner:** backend-engineer; security-reviewer reviews

Scope: `GET /api/v1/public/practices/{slug}/availability?serviceId&providerId&from&to` (practice-local dates, at most 42 days, `hasFreeTimes` per day) and `GET /api/v1/public/practices/{slug}/slots?serviceId&providerId&date` (free start times). `providerId` only for doctors with a public profile, otherwise grouped as any provider; BR-03 through the `Clock`; BR-08; never counts or booked times; `@PublicCache(30)`; the `public` throttler; contract regenerated; `api-contract` catalogue updated.

Acceptance:

- With `FixedClock`, a slot at now + 119 min is absent and at now + 120 min present; slots beyond the horizon are absent; booked and blocked slots are absent; a fully booked day has `hasFreeTimes: false`.
- An unconsented `providerId`, an unknown service and a service id of another practice each → 404; a range over 42 days → 400 with a field error on `to`.
- The `Africa/Cairo` day range of 2027-04-30 is [2027-04-29T22:00Z, 2027-04-30T21:00Z).
- 429 after the limit; `Cache-Control` is exactly `public, max-age=30`; responses match the OpenAPI schemas.

As built (one commit with P04): the routes are `GET /api/v1/public/practices/{slug}/availability` and `…/slots`, `getPublicAvailability` and `getPublicFreeTimes`. `from` and `to` are optional: today and the 42nd day. A free time is only `{ startsAt }`, and several providers with the same start give one time. The first version also named a slot id; its security review showed that comparing two answers by it reveals the times and absences of a provider without a public profile, and that a withdrawal would not have taken effect (BR-24). So the booking of B02 takes `serviceId`, `startsAt` and optionally `providerId`, and picks the slot in its transaction, unlike the `slotId` of the sample in the `nestjs-feature` skill. `@PublicCache` and the limit of 60 requests per minute per route and address follow P02's way with `@Throttle`. The smoke test of the control menu checks that the demo practice has free times, the whole way from the rules through the job to the public route.

### P06 — Free times on the public page

**Commit:** `feat(web): show free times on the practice page` · **Depends on:** - · **Owner:** web-engineer (PW13/PW14 free-times section)

Scope: service select, Doctor Options with initials and "Any doctor", week strip from `weekStart` and `weekendDays` (weekend and closed days disabled), morning and afternoon Time Slots; generated hooks polling every 45 s with `cache: 'no-cache'`; roving tabindex with arrow keys in reading direction; GSAP transitions of the time chips (reduced motion respected); choosing a time links to `/[locale]/sign-in#next=…` through `safeReturnPath`, with `serviceId` and `slotId` only; a sign-in placeholder; `e2e/support/fixtures.ts` with `createPractice`, which provisions a practice database for the test through `@medibooker/db-migrate/testing` (`provisionPractice`, `seedPracticeFixture`, `dropPractice`; no raw SQL in the web tests) with the values of the root `.env` ([06 §3](06-testing.md#3-determinism)); `@medibooker/db-migrate` as a devDependency of the web, and `allowImportingTsExtensions` in the e2e tsconfig.

Acceptance:

- Component tests: loading, empty, error with retry, and arrow-key order in RTL and LTR.
- Playwright through `pnpm turbo run test:e2e` in `ar` and `en`: keyboard-only selection works; the hand-off URL carries the IDs only in the fragment; digits follow `numberingSystem`; axe 0; a slot made unavailable through the fixture in the test's own practice disappears after `page.clock.fastForward('00:46')`.
- `pnpm --filter @medibooker/web typecheck` covers `e2e/**`.
- After the suite, `psql -lqt` on the e2e database lists no `practice_…` database and `SELECT rolname FROM pg_roles WHERE rolname LIKE 'practice_%'` lists no role created by a fixture (teardown works).
- `safeReturnPath` unit tests reject `//evil.example`, `/\evil.example`, `/%2F%2Fevil.example`, `https://evil.example` and `javascript:alert(1)`.

As built (one commit with P04 and P05): `free-times-picker.tsx` is a client island with its own query client and only its own texts. It reads the next 42 days, so the strip shows six weeks; later weeks come with booking. The hand-off carries only the practice page in the fragment: a second review pointed out that a URL stays in the browser's history, where a service and a doctor say something about someone on a shared computer (health-data-security §1, §8). The placeholder needs no more, so A05 adds what it needs. Service select from the shadcn CLI, adapted to the tokens. The sign-in placeholder is `[locale]/(public)/sign-in`, marked `noindex`; M01's reserved slugs must name `sign-in`. Without JavaScript the frame and the phone remain. Moved: `createPractice` and provisioned practices in the web tests, until a test must change data on the real path (booking). The tests run against the API stub, through a route in the test fixture that does what the proxy does; the smoke test proves the real way up to the free times.

## Accounts

### A01 — Accounts, sessions, memberships and audit

**Commit:** `feat(auth): add accounts, sessions, memberships and audit log` · **Depends on:** - · **Owner:** backend-engineer; security-reviewer (BLOCK gate)

Scope (ADR 0004, ADR 0005):

- Platform schema: `users` (`citext` e-mail; `CREATE EXTENSION IF NOT EXISTS citext`), `sessions` (hashed refresh token, family, rotation, reuse detection, `amr`), `mfa_recovery_codes`, `practice_access` (the index, with `kind`, `expires_at` and `updated_at`), `revocation_journal` (ids only).
- Practice schema: `memberships` (user id, role, status, `kind` `MEMBER` or `SUPPORT`, `expires_at` with `CHECK (kind <> 'SUPPORT' OR expires_at IS NOT NULL)`; unique user), `staff_members.membership_id`, append-only `audit_events` (revoked through `app_role()`), `integration_outbox`.
- `IntegrationRelay`: versioned idempotent upserts into `practice_access`; events name no practice, the relay takes it from its `runInPractice` context; revocation events (here: a membership removed) also go into `revocation_journal`. It runs through `forEachPractice` every `WORK_POLL_SECONDS`, next to the write-through after commit. `PracticeAccessIndex`; `AuditService` for both logs (a platform row names at most one practice).
- argon2id (`allowBuilds`), breached-password check against a bundled list (no third-party call), asymmetric access JWT of at most 15 minutes with `iss`, `aud`, `sub`, `sid`, `amr` and a `kid` (two active keys for rotation), no role claim; login, refresh, logout. Web: `HttpOnly; Secure; SameSite=Strict` cookies and a CSRF header; mobile: Bearer.
- `AuthenticationGuard` implementation (JWT and the session row on every request); `@PracticeScoped('id', { staffRoles })` with the index pre-filter, the status table and the authoritative check of an `ACTIVE`, unexpired membership in the practice database (an expired support row counts as absent); `RequestContext.actor`; `@CurrentUser()`. The patient mode follows in B01, family links in FA01.
- `SUPPORT_ACCESS_ENABLED` (default `false`) and `SUPPORT_ACCESS_MAX_HOURS` (ADR 0005 §9.4); support invitations arrive in A04.
- Auth throttles; `GET /me`, `PATCH /me`, `GET /me/practices` (index rows with the registry's name and slug); `AUTHZ_MATRIX` and `expectAuthMatrix`; OpenAPI security schemes; the architecture test that only the allowlisted platform tables carry a `health` field (ADR 0005 §1.1).
- `health-data-security` skill: §3 token claims without `role`; "a practice admin disables a membership, effective on the next request; revoking all sessions is an account-level action of the user"; §4 the role comes from the active membership in the resolved practice (`@PracticeScoped('id', { staffRoles })`), never from the token; §9 rooms per practice. `nestjs-feature` skill: rule 2 with `@PracticeScoped` instead of `@Roles`.

Acceptance:

- The auth matrix (401, 403, 404, 200) passes for `/me`, `/me/practices` and a staff probe route; the cross-practice test returns 404, and no client for B is opened for a caller without a B index row.
- Disabling a membership in B's database makes the next request with a still-valid access token return 404, also while the index row is still active (relay stopped in the test); the removal is in `revocation_journal`.
- A new membership is usable on the next request through the write-through; with the write-through forced to fail, the relay applies it on its next run; a replayed older event does not overwrite a newer index row; an event read from A's outbox only ever changes A's index rows.
- A support membership inserted by the test is answered with 404 one second after its `expires_at` (`FixedClock`), also while its index row is still active.
- Reusing a rotated refresh token revokes the whole family; a missing CSRF header on an unsafe cookie request returns 403; login errors are generic.
- The app roles cannot `UPDATE` or `DELETE` audit rows in either database; `/me/practices` returns only the caller's rows.
- The architecture test fails for a fixture `health` field in a platform table outside the allowlist.
- Log capture finds no tokens, personal data or user id next to a practice id from the index; security-reviewer verdict APPROVE.
- The outdated rules are gone; this finds nothing:

  ```sh
  grep -nE '`sub`, `role`|@Roles\(' .claude/skills/health-data-security/SKILL.md .claude/skills/nestjs-feature/SKILL.md
  ```

As built (one commit with the account e-mails of A02 and with A03, the lean order of 2026-11-05): the accounts and sessions a patient needs to sign up and sign in. No membership can exist before something creates one, so these move, each with its acceptance checks:

- Memberships, `practice_access`, `integration_outbox`, `IntegrationRelay`, `revocation_journal`, `@PracticeScoped('id')`, `GET /me/practices` and the practice's `audit_events` → B01 for patients, A04 for staff, whichever comes first. `expectAuthMatrix` grows with them; until then `test/e2e/authz-matrix.e2e-spec.ts` proves the 401 of every protected operation and the integration spec the answers of an account.
- `mfa_recovery_codes`, the `amr` of a second factor, support access and its settings → A04.
- The architecture test on `health` fields in platform tables → with the first platform table that holds one; the new tables hold none.

In this commit: `users`, `sessions` (one row per refresh token, with its family), `account_tokens`, `account_consents` and `account_notifications` in the platform database; `node:crypto` argon2id instead of a native package; EdDSA access tokens through `jose`, from a 32-byte seed in the secret store; `AUTH_SIGNING_KEY_REFS` and `AUTH_SECRET_REF`, which staging and production refuse as `dev:` references; a refresh answered 401 without revoking anything within ten seconds of its rotation, so two tabs of one person do not sign each other out, and with a revoked family after that; `SessionAuthenticator` behind the `Authenticator` port, so `common/security` knows no module. The CSRF token is an HMAC of the session id and needs no storage. The list of known passwords is bundled as code (2,311 entries of at least ten characters from SecLists, MIT) and no call leaves the API: as a data file it never reached the image, which only the smoke test noticed.

What the BLOCK of the security review changed: a reset confirms the address, because its link reached the mailbox. A sign-in does not need a confirmed address: the review asked for that, and the user decided on 2026-11-06 against it for a sign-up without a break, so signing up and then signing in tells whether an address has an account (RT-89, ADR 0004 §8). An attempt is counted before its password is checked, under a lock of the row, because guesses at the same moment all passed the wait on one count. Also fixed: a sign-in does not start after a reset took its password; at most three links of a kind an hour to one account while one of them works, also for requests at the same moment; a reset ends the other reset links; new addresses are ASCII, because the column's `lower()` turns look-alikes into another person's address; SMTP in staging and production is encrypted with the certificate checked; a logout without a cookie clears none. Moved, each to the item named: A04 refresh and revocation under a lock of the user's row, a count that decays, a family lifetime and a "password changed" e-mail; A05 the mailbox proof at confirmation and a notice for a known address, the privacy-notice version from configuration, the cookie prefix; M01 `verify-email` and `reset-password` as reserved slugs; PR01 retention of accounts that are never confirmed, sessions, tokens and outbox rows, and these tables in export and deletion; OPS01 shared throttler storage, an alert on token reuse, the writes of a known address that can be told by timing, and the data processing agreement of the mail provider.

### A02 — Notification outboxes and account e-mails

**Commit:** `feat(notifications): add outbox, SMTP adapter and account e-mails` · **Depends on:** - · **Owner:** backend-engineer; ui-designer provides the templates

Scope: `account_notifications` in the platform database (account and security e-mails) and `notifications` in the practice schema (practice messages, from E09 on); both with a unique `dedupe_key`, no rendered text, `scheduled_for` and `next_attempt_at` from the `Clock`. The notifications module exports `NotificationOutbox.enqueue(tx, …)` and `AccountNotifications.enqueue(tx, …)`, the only way to queue a message: inside the business transaction, never after commit. `OutboxProcessor.processDue(now, limit)` per database with `FOR UPDATE SKIP LOCKED` and backoff; practices with due rows are found by polling, `findPracticesWithDueWork()` every `WORK_POLL_SECONDS` (it also drives the relay), with the `job` budget; a thin `@nestjs/schedule` loop. `EmailSender` port with an SMTP adapter and an in-memory fake; the recipient's e-mail address, locale and preferences are read from the platform database at send time. Mailpit (compose profile `mail`); templates E01, E02, E09 and E10 rendered at send time with the D1 engine (RTL HTML and plain text, inline brand colours, no tracking); every link built from `PUBLIC_WEB_URL` with tokens in the fragment. `nestjs-feature` skill rule 7: messages are enqueued in the transaction; after-commit events only for realtime and best-effort reactions.

Acceptance:

- One notification per recipient and `dedupe_key`; a failing send retries with backoff and ends `FAILED` (driven by `processDue` with `FixedClock` steps).
- A committed change always has its outbox row, and a change whose transaction fails after the enqueue has none, in both databases.
- The poller finds a practice with a due row within one `WORK_POLL_SECONDS` step (`FixedClock`); a practice that is not `ACTIVE` is skipped and its rows wait; with two clients in use by signed-in requests, polling never evicts them.
- Mailpit receives an Arabic (RTL) and an English e-mail in one e2e smoke test.
- Template snapshots exist per locale; a test proves template variables never include service, doctor, note or file fields.
- Links use `PUBLIC_WEB_URL` even with a forged `Host` header; logs contain IDs and status only.
- `grep -n 'After a successful commit, emit a domain event' .claude/skills/nestjs-feature/SKILL.md` finds nothing.

As built (one commit with A01 and A03): the platform half. `account_notifications`, `AccountNotifications.enqueue`, `AccountOutbox.processDue` with a five-minute lease, retries after 1, 2, 4 and 8 minutes and `FAILED` after five attempts, a timer every `OUTBOX_POLL_SECONDS`; `EmailSender` with SMTP through `nodemailer`; templates E01 and E02 rendered at send time with `use-intl`. Without `SMTP_URL` e-mails wait and retry. An outbox row holds the id of its token and no token: the raw token is an HMAC of that id, so the database holds neither the token nor anything to send it with, and a link that is over by the time it could go out is not sent. Mailpit is part of both stacks and not a profile of its own: the menu must show a sign-up working, so its smoke test signs up in Arabic and English and finds both e-mails in Mailpit. The renderer takes a template, a locale, an address and a token, so no service, doctor, note or file can reach it. Moved: the `notifications` table, `NotificationOutbox`, the poller over practices and its checks → E09 and N01; E09 → A04; E10 → A04. The D1 engine stays open for the practice messages.

A real mail server (`dc6bd58`, the user's request of 2026-11-06): both stacks take `SMTP_URL`, `MAIL_FROM` and `MAIL_ALLOWED_RECIPIENTS` from their environment file, with Mailpit as the default, and the menu writes them (`mail-setup`, `mail-test`, `mail-off`). Everything but a local catcher needs TLS in every environment, and from a machine of the team a real server reaches only the listed addresses. The transport gives up on a server that stays silent: 10 seconds to connect and to greet, 30 while talking. The smoke test leaves out its test sign-ups then. The provider stays a decision of D10 (RT-91).

### A03 — Patient sign-up, e-mail verification and reset

**Commit:** `feat(auth): add patient sign-up, e-mail verification and reset` · **Depends on:** - · **Owner:** backend-engineer; security-reviewer reviews

Scope: `POST /auth/register` creates the account only, in the platform database; the practice a patient came from stays in the client flow (the fragment), and the patient profile is created in that practice in B01 (D16). `/auth/verify-email`, `/auth/password/forgot`, `/auth/password/reset` (tokens in the body, `account_tokens`); the verification and reset e-mails are queued with `AccountNotifications.enqueue(tx, …)` in the transaction that creates the account or the token; `consents` with the platform's privacy-notice version; single-use hashed tokens valid 30 minutes; enumeration-safe responses; throttles; BR-09 prerequisites.

Acceptance:

- Known and unknown e-mail addresses get identical status codes and bodies; reused or expired tokens are rejected; register and reset are rate-limited.
- A registration whose transaction fails after the enqueue leaves neither an account nor a queued e-mail; a committed one always has its verification e-mail row.
- Registering writes no row in any practice database (integration check of both practice databases).
- BR-09 tests pass; `POST /auth/password/forgot` with a forged `Host` header produces a link on `PUBLIC_WEB_URL`.
- An integration test covers sign-up → verification → reset with the in-memory `EmailSender`.

As built (one commit with A01 and A02): `POST /auth/verify-email/resend` joins the routes, because a link that is over needs a way to a new one. The forged `Host` is tested on the way that creates a link, for a known account. `account_consents` holds the privacy-notice version. "Writes no row in any practice database" moves to B01, the first item with a practice table for a patient; `AuthModule` imports the platform database only. The e-mail links lead nowhere until A05 builds their pages (`/[locale]/verify-email`, `/[locale]/reset-password`).

### A04 — Staff invitations, TOTP MFA, sessions and practice creation

**Commit:** `feat(auth): add staff invitations, TOTP MFA and session control` · **Depends on:** - · **Owner:** backend-engineer; security-reviewer reviews

Scope:

- Staff invitations in the practice database (E09; hashed, single-use, 7 days; link `…#practice=<id>&token=<token>`; `POST /practices/{practiceId}/staff-invitations/accept` with the token in the body) through `@PracticeScoped('id', { invitation: 'staff' })`: a verified account whose e-mail matches, one uniform 404 for every failure, the named throttler `invitation` ([02 §5](02-api.md#5-data-layer-and-tenancy)); the X02 architecture test gains the rule that this mode appears only on `-invitations/accept` routes. Acceptance creates the membership and its index event in one practice transaction.
- Support access (ADR 0005 §9.4), active only with `SUPPORT_ACCESS_ENABLED` (D8, question 4): an admin invites a support user with a reason, a role (default `STAFF`) and an expiry of at most `SUPPORT_ACCESS_MAX_HOURS`; acceptance creates a membership with `kind = SUPPORT` and `expires_at`; both steps are audited and flagged in the practice's audit log.
- TOTP mandatory for every staff membership, with hashed recovery codes (platform); session list and `POST /auth/sessions/revoke-all` (E10 token in the body); audit events for sign-in, MFA and role changes in the right log.
- Operator commands in `src/cli.ts`: `practice:create --slug --name-ar --name-en --market --time-zone --default-locale [--cluster]` (registry row through the column grant `INSERT (id, market, name)` that this item's platform migration adds, so the status defaults to `PROVISIONING` and no routing is set; the slug; a platform audit event with the operator principal from the task's cloud identity, locally `local:<OS user>`, never a command-line flag; prints the `medibooker-db provision` command) and `practice:invite-admin <practiceId> --email`.

From the security review of A01 to A03: lock the user's row in refresh and in revoking a family, so that no session outlives a reset; let the failure count decay, because one guess an hour keeps an account waiting; give a family an absolute lifetime; send a "password changed" e-mail (BR-21). Read a token from the fragment once and `replaceState` it away, because invitation tokens live 7 days in a browser's history (the review of A05). Lock the user's row at the start of `consumeToken`, so that a confirmation or a reset and a deletion take their locks in one order (the review of the profile).

Acceptance:

- No staff route answers without a completed MFA sign-in (`MFA_REQUIRED`), also when the index does not show the membership yet; recovery codes are single-use; revoke-all invalidates every refresh token; audit rows are written; the role matrix passes.
- An unknown practice, an unknown, expired or used token and an e-mail mismatch give identical 404 bodies on `…/staff-invitations/accept`, and no practice client is opened before the registry check passes; the throttler answers 429 after its limit.
- With `SUPPORT_ACCESS_ENABLED=true`, a support invitation without a reason or with a longer expiry is rejected and an accepted one answers 404 one second after `expires_at` (`FixedClock`); with the flag off, support invitations are refused.
- `practice:create` rejects a market outside `MARKETS` and a reserved or taken slug (also a retired one of another practice); the row it inserts has status `PROVISIONING` and no routing, and `platform_app` cannot set either.
- The architecture test fails for a fixture route with the `invitation` mode outside `-invitations/accept`.
- An integration test runs the chain `practice:create` → `provisionPractice()` → `practice:invite-admin` → accept → staff sign-in with TOTP → a staff route of the new practice.

As built (this commit), cut to what the dashboard needs, the user's choice of 2026-11-10: with one installation per practice (ADR 0016) the operator, not a platform, starts a practice, so its first admin comes from a command and not from an invitation.

- **Roles:** `memberships` in the practice database (`user_id` unique, role `STAFF` for the reception, `DOCTOR` or `ADMIN`, status `ACTIVE` or `DISABLED`); a change writes its `STAFF` index event through the outbox in the same transaction, and the write-through or the relay applies it. `@PracticeScoped('id', { staff: [...] })` asks in this order: a second factor in the session's `amr` (403 `MFA_REQUIRED`, whatever the index says), a `STAFF` index row (404 without one, 403 with only another capacity), the status table, then an `ACTIVE` membership in the practice database (404 without, so a stale index row does not count) with a role the route names (403 otherwise). `GET /practices/{practiceId}/me/membership` answers the role.
- **The operator's command:** `node dist/cli/staff-role.js <e-mail> [ADMIN|DOCTOR|STAFF|NONE]`, the menu entry "Konto zum Admin der Praxis machen". It gives an existing account with a confirmed address its role in the practice of `PRACTICE_SLUG`; `NONE` disables the membership, effective on the next request. The practice's audit log records it as `operator:local:<user that runs it>`, which is `node` when the menu runs it in the API container. The answer is one JSON line without the address, with `mfaEnabled`: true means an app was set up before the grant, so the operator asks the person whether it was them (RT-96).
- **Second factor:** `POST /me/mfa/totp` starts, only for an account with an active `STAFF` index row (FORBIDDEN otherwise), with a new secret (160 bits, encrypted with the platform's field keys and bound to its row) and its otpauth URI in the practice's name; `POST /me/mfa/totp/confirm` puts it in force with a first code, answers ten recovery codes once (stored as HMACs with the auth secret, bound to the account) and replaces the session like a refresh, in the same family, with `amr` `pwd` and `otp`; every other session of the account ends. The new tokens go into cookies when the request came with cookies, and into the answer only for a Bearer client, so a script that can send the CSRF header never reads a refresh token. At sign-in an account with a factor sends the code, or a recovery code, with the password in the same request: without it `MFA_CODE_REQUIRED` (401) and no session, a wrong or used code `MFA_CODE_INVALID` (400). There is no challenge token to steal or keep. Every request counts as a failed sign-in until one succeeds, and wrong codes also count on their own (`mfa_failed_count`, `mfa_locked_until`) with the same wait, 1, 2, 4 … up to 60 minutes after the fifth: a new password clears the failed sign-ins but not the wrong codes, so whoever reads the mailbox gets no new tries (the major finding of the security review). A code counts once (`totp_last_step`), one step of 30 seconds before or after is accepted, and digits typed on an Arabic keyboard count as digits. RFC 6238 is `node:crypto` only; the QR code is drawn by the web from `uqr`'s matrix as SVG, dark on light in both schemes.
- **Web:** the sign-in page asks for the code as a second step (W4) with a way to a recovery code; `/{locale}/dashboard` sets up the app with the QR code and the key, shows the recovery codes once, and then the role; an account outside the team reads that it has no access.
- **Moved:** staff invitations (E09), the team and an admin's reset of a lost factor → M03; the dashboard's idle logout and two tabs in two practices → M05; support access, `practice:create`, the session list and `revoke-all` (E10), a decaying failure count, a family's absolute lifetime and the "password changed" e-mail → later, before the first real practice; the 12-character minimum for staff passwords → M03, whose invitation sets one; re-issuing the recovery codes after a rotation of the auth secret, which voids them, and the host's user in the operator's audit row → OPS01. A slug route takes no access rule: `@PracticeScoped('slug', …)` with one throws at start. RT-96 holds what stays open meanwhile.

### A05 — Web authentication flows

**Commit:** `feat(web): add sign-in, sign-up, verification and two-factor flows` · **Depends on:** D16 · **Owner:** web-engineer

Scope: `(auth)` screens (PW1, sign-up 09 and 12, W3, W4, forgot password 13); the personal details and insurance (screens 10–11) stay in the sign-up and save to the account profile (D16 decided on 2026-11-06: option B); cookie session and CSRF header in `api.client.ts`; proxy redirects for `(patient)` and `(practice)` with the return path in the fragment through `safeReturnPath`; the practice segment in portal and dashboard routes (default per D3); the practice switcher from `GET /me/practices`; the `theme` cookie; dashboard logout after 15 minutes of inactivity with a warning dialog; logout clears the query cache; the P06 placeholder is replaced; verification, reset and invitation pages read tokens and the practice id from the fragment.

From the security review of A01 to A03: an attacker's password must not become valid through the owner's click, so the confirmation asks for the password (`POST /auth/verify-email` with `{ token, password }`): closed in `8d12915`, as B01 needs it before anyone can book. A known address gets a notice instead of silence, with the templates of N01. The API compares `privacyNoticeVersion` with the current version. Decide the cookie prefix together with the page addresses. A signed-in person whose address is not confirmed sees that, with `POST /auth/verify-email/resend`.

D16 option B, on the API: `account_profiles` in the platform database (name, date of birth, contact phone, insurance type, provider and number) with `GET` and `PUT /me/profile`, the number encrypted with `FIELD_ENCRYPTION_KEYS` and never returned in full; which insurance options a person sees comes from the practice they came from, or otherwise from the market of the deployment (BR-10). B01's join copies the profile into the practice, and from then on that copy is authoritative for that practice. Risk for the client's data protection officer: RT-90.

A profile is entered before the address is confirmed, so a mistyped address must not hand it to a stranger, and a stranger's sign-up must not stick to its owner. This ships with the profile and not later (the review of A05): accounts never confirmed are deleted after 7 days, in that commit and not in PR01; a reset of an account never confirmed treats it as new, by deleting the row and creating another in one transaction, so that the foreign keys clear profile, consents, tokens and sessions; no field of a profile goes into an e-mail to an address not confirmed, with a test; `PUT /me/profile` locks the user's row and checks the session again, so that no write lands after such a reset; the insurance number has no uniqueness check, which would be a new oracle; who mistyped can delete an account never confirmed. A session no longer means a confirmed address, and `Actor` has no such flag: B01's join and B02's BR-09 need a test with a signed-in account that is not confirmed.

As built (`b0e2f11`): `account_profiles`, `GET` and `PUT /me/profile`, `FieldCipher` (AES-256-GCM from `FIELD_ENCRYPTION_KEY_REFS`, each value bound to its row), `UnconfirmedAccountsJob` at night, `DELETE /me/unconfirmed`, screens 10 and 11 as the second step of the sign-up, the same form at `account/details`, and the details on the account page. The three types of BR-10 with general labels, so a sign-up needs no market choice and no practice; the number has a general format, and a practice checks its own rules at the join (B01). The phone is optional, as in B01. A known number stays when it is left out, because only its end is ever sent back. An account that started anew at a reset has no consent, so B01's join must ask for the privacy notice.

Acceptance:

- Playwright in `ar` and `en`: sign-up → verification link → sign-in → portal; staff sign-in → TOTP → dashboard; the free-times hand-off resumes after sign-in; no token in web storage; cookies are `HttpOnly`, `Secure` and `SameSite=Strict`; axe 0.
- Two tabs in two practices of one staff user each show their own practice's data.

As built (`8d12915`): the pages for patients. Sign-in PW1, sign-up 09, check inbox 12, confirm, forgot password 13, reset, and `(patient)/account` as the landing until the portal (B04), with the state of the address and sign-out. `lib/api.client.ts` sends the CSRF header and tries one refresh after a 401; `proxy.ts` sends a visitor without the `mb_csrf` cookie from `account` to sign-in, with the way back in the fragment. `POST /auth/verify-email` takes the password, and `privacyNoticeVersion` must be `PRIVACY_NOTICE_VERSION` of `@medibooker/i18n`. `privacy` is a placeholder until the text of the client's data protection officer. The confirmation judges the link first, because an old e-mail must not become a way to test passwords, and counts the password like a sign-in through `SignInAttempts` (the BLOCK of the security review). What the browser tests found: a form the browser sends before the page is alive would put the password into a URL, so forms use POST and their button stays disabled until then, and fields are read-only, because React drops what was typed earlier; after a sign-in the next page is a new document, because a practice page's style carries the nonce of its own document and a client navigation breaks it. Moved: W3, W4, two-factor, the dashboard's inactivity logout and two tabs in two practices to A04; the practice switcher and `GET /me/practices` to B01 and A04; the `theme` cookie and the resumed booking in `sessionStorage` to B04. A known address still gets no notice: with the notification templates of N01.

From the review of P06: the chosen service, doctor and time travel in `sessionStorage`, written by the time's click handler, not in the URL (`next` names only the practice page), and they do not go into an e-mail link. `safeReturnPath` proves the same site, not the same practice, and only the shape of what follows: the resumed booking only pre-fills, shows the practice, service and time, and books after an explicit confirmation; the server checks everything again.

### A06 — Mobile authentication flows

**Commit:** `feat(mobile): add sign-in, sign-up and secure session storage` · **Depends on:** D16 · **Owner:** mobile-engineer

Scope: screens 01, 09, 12 and 13 (screens 10–11 follow D16 as in A05, in B05 for option A); the `(tabs)` layout with the auth gate; tokens in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); one in-flight refresh; logout cleanup (secure storage, query cache, offline cache, push token); practice selection from `GET /me/practices`, a practice-page link or a QR code, stored in secure storage (ADR 0005 §3); token links handled by the web; the custom scheme carries IDs only.

Acceptance:

- Jest: three concurrent 401s trigger one refresh; logout leaves secure storage and the caches empty; switching the practice clears the query cache; the deep-link handler ignores a `token` parameter; no token reaches AsyncStorage or a log line.
- Recorded checks on iOS and Android in `ar` and `en`.

## Booking

### B01 — Patient profiles and insurance

**Commit:** `feat(api): add patient profiles with insurance validation` · **Depends on:** - · **Owner:** backend-engineer; security-reviewer reviews

Since D16 was decided for option B, the join copies the `account_profiles` row and asks only for what is missing (decrypting the number with `FieldCipher` and encrypting it with the practice's key), and it asks for the privacy notice when the account has no consent. Scope: `patients` in the practice schema (user id nullable for children; at most one `SELF` profile per user through a partial unique index; an optional contact phone, while the verified phone stays on the account, ADR 0005 §1.3); `POST /practices/{practiceId}/me/patients` creates the caller's `SELF` profile in a published practice from the "Your details" data (D16: name, date of birth, contact phone, insurance with that practice's options) through `@PracticeScoped('id', { join: true })` with the named throttler `join`, and writes the index event; `@PracticeScoped('id', { patient: true })` for the patient's own routes; `GET`/`PATCH /practices/{practiceId}/me/patients/{patientId}`; insurance types and validators from the practice settings (BR-10). Field encryption (AES-256-GCM) with the practice's own versioned data key: `provision` gains the step that creates it (`field_key_ref`), and rerunning `provision` adds it to existing practices. The HMAC blind index of `insuranceNumber`, and from here on `ip_hash` in practice audit rows, use keys derived per practice with HKDF from `BLIND_INDEX_KEY` and the practice id (ADR 0005 §4.8); masked output.

Acceptance: joining with a signed-in account that is not confirmed follows BR-09, with a test, because a session no longer means a confirmed address; an account without a consent is asked for the privacy notice; the same number in two scripts is normalised or refused before the copy and the blind index; validator tests per market (Germany `PUBLIC`: a letter and 9 digits; `SELF_PAY` without a number); an encryption round trip and a key-rotation test; the same insurance number stored in practices A and B has different ciphertext keys and different blind indexes; the full number is never returned; the patient auth matrix (401, 403, 404, 200) and the cross-practice 404 pass on the `{ patient: true }` routes; joining an unpublished practice → 404; the sixth join of one account on one day → 429; a second `SELF` profile for the same user is rejected by the index; after joining, `GET /me/practices` lists the practice with capacity `PATIENT`; security review passed.

As built (`ddf90dd`): `patients`, `integration_outbox` and an append-only `audit_events` in the practice schema, the three insurance columns in `practice_settings`, `practice_access` and `practices.field_key_refs` in the platform schema; `PracticeKeys`, `PracticeAccessIndex`, `IntegrationRelay` and `PracticeAudit` in the tenancy layer; `{ patient: true }` and `{ join: true }` on `@PracticeScoped`; `POST` and `GET` on `/practices/{practiceId}/me/patients`, `GET` and `PATCH` on `/{patientId}`, and `GET /me/practices`. Three changes against the text above: `field_key_refs` holds a list, the first encrypts and all decrypt, as for the platform's keys; the number is refused at the join unless it normalises to ASCII letters and digits, because a letter of another script can look Latin and would index differently; and the limit per address is 10 a minute, because a limit per day in front of the sign-in would let a stranger on a practice's network lock its patients out, while the account's limit of five holds under its row lock with an inactive index row as the reserved place. `practice_access` has no staff columns yet (A04), and rotating a key needs a registry change until OPS01 adds the command that also re-encrypts. The relay visits every practice every 15 minutes and tries a failed write-through again every 30 seconds, because a visit opens a client from the budget public requests share. For B04, from the security review: the join screen shows what goes to the practice before it sends (RT-92).

### B02 — Book an appointment

**Commit:** `feat(appointments): book with row locks and idempotency keys` · **Depends on:** - · **Owner:** backend-engineer; qa-engineer adds the concurrency tests

Scope: `appointments` in the practice schema (lifecycle statuses, encrypted `patient_note`, partial unique index on `slot_id` for active statuses declared in the schema); `POST /practices/{practiceId}/appointments` with `FOR UPDATE` on the patient and the slot; BR-01, 02, 03, 08, 09 as pure rules; the `Idempotency-Key` store in the practice database (key, actor, request hash, appointment id, 24 h; `INSERT … ON CONFLICT DO NOTHING` and `SELECT … FOR UPDATE`); `appointment.booked` after commit, for realtime only (N01 adds the confirmation e-mail through `NotificationOutbox.enqueue(tx, …)` inside this transaction); audit in the transaction; new codes with Arabic and English messages.

Acceptance: booking with a signed-in account that is not confirmed answers `EMAIL_NOT_VERIFIED` (BR-09), with a test; the concurrency and idempotency tests of [06 §5](06-testing.md#5-concurrency-and-idempotency-b02-b03) pass, including the simultaneous burst in two practices; a key replay returns the original 201; the same key with another body → 409 `IDEMPOTENCY_KEY_REUSED`; BR-03 boundaries ± 1 minute including the spring-gap fixture; a raw-SQL second active row is rejected by the index; the auth and cross-practice matrices pass.

As built (`b9b2795`): `appointments` and `idempotency_keys` in the practice schema, `POST /practices/{practiceId}/appointments` with `{ patient: true, confirmed: true }`, and the pure rules in `booking.rules.ts`. A booking names a time, not a slot, as P05 decided: it takes serviceId, startsAt and an optional providerId, who needs a public profile, and picks the slot in its transaction with `FOR UPDATE OF s SKIP LOCKED`, so that with several doctors free it takes another one's slot instead of losing to a booking it waited for. The locks come in one order, key, patient, slot. A failed booking rolls its key back, so a retry is judged anew; a key answers for 24 hours per caller, and its row holds a hash keyed for this practice, because a request can hold a note. `appointment.booked` is left out until realtime has a consumer (RT01), and the confirmation e-mail comes with N01.

From the security review. All of a person's bookings wait for one patient row, each holding one of the practice's three connections, so 240 refused bookings of one person gave others 500 or waits of 3 seconds. So a booking has its own limit of ten a minute per address; `AccountTransactions` keeps one account to the pool minus one at a time, answers more with 429 and `Retry-After`, and ends a wait for a row lock after `DATABASE_LOCK_TIMEOUT_MS`, which the limit on a transaction does not do; and on every practice route a pool or lock that stays busy is 503 with `Retry-After` (`PRACTICE_BUSY`), without closing the client. An answer names a doctor only while the profile is public (BR-24), so `providerId` is null when "any doctor" led to one without, and after a withdrawal, also in a replay. A booking checks the profile against the practice's insurance rules of today (BR-09, `PATIENT_PROFILE_INCOMPLETE`). A note refuses what a screen would not show, and keys that answer no more go with a nightly sweep in every practice. What stays open is RT-93.

### B03 — Cancel, reschedule, status changes and my appointments

**Commit:** `feat(appointments): add cancel, reschedule and my appointments` · **Depends on:** - · **Owner:** backend-engineer

Scope: `POST …/appointments/{id}/cancel` (BR-04 for patients; staff with a reason), `/reschedule` (atomic, `Idempotency-Key`), `/check-in`, `/complete`, `/no-show` (BR-11); `GET /practices/{practiceId}/me/appointments?scope=upcoming|past` (cursor, `limit` at most 100); `GET /me/appointments?scope=upcoming` across practices (ADR 0005 §9.1): the index rows in a stable order (most recently updated first), each branch through `runInPractice` with the caller's patients read from that practice's database, `ME_FANOUT_*` limits, items with `practiceId`, `unavailablePractices` with the reasons `UNAVAILABLE`, `TIMEOUT` and `LIMIT`; `GET …/appointments/{id}`; events after commit for realtime only (N01 adds the messages inside the transactions) and audit; `api-contract` skill rows for both list endpoints; `tenancy/fanout.int-spec.ts`.

From the security review of B02: decide what a replay of a booking answers after it was cancelled. A staff cancel is the first way to free a slot without SQL, so no go-live before it (RT-93). Cancel and reschedule take the same locks as a booking and run through `AccountTransactions`.

As built (`447475e`), the patient half, because no staff role exists before A04: `POST …/appointments/{id}/cancel` and `/reschedule`, `GET …/appointments/{id}`, `GET /practices/{practiceId}/me/appointments`, and `GET /me/appointments`. The staff half moves to M05: a staff cancel with a reason, `/check-in`, `/complete`, `/no-show`, and their acceptance. A reschedule writes a new row with `rescheduled_from_id` and cancels the old one, as the domain says, and seals the note again for the new row, before the transaction, because reading a key should not hold a lock. A second cancel changes nothing and answers the same, because a cancel carries no key and a retry must be safe. A replay of a key answers with the appointment as it is now, so after a cancel its status says so and nothing new is booked. `GET /me/appointments` takes no `scope`, because history stays per practice; `PracticeFanOut` is in the tenancy layer for PR01's export, and the route has its own limit of 30 a minute per address. An answer carries what a page needs without a second question, `serviceName`, `providerName`, `timeZone` and `changeableUntil`, and still never the note. `appointment.cancelled` and the other events wait for a consumer (RT01), and the messages come with N01.

From the security review, which blocked it twice over. A cancel leaves an `OPEN` slot with a cancelled row, and the night's run could not delete such a slot once the rules no longer wanted its time: the run failed for that practice, its absent doctor's times stayed bookable, and it got no new slots. Now such a slot stays without a rule, offered to nobody, and gets a rule again when its time is wanted. And a fan-out took clients and creations from single practices: 3 accounts with 20 practices each, from one address inside its limit, gave others 503 on 15 of 20 requests that needed a new client. So a fan-out has the purpose `fanOut`: a budget of its own, no eviction of what a request for one practice used, at once `UNAVAILABLE` above the creation rate, one at a time per account, and after `ME_FANOUT_CONCURRENCY` timeouts it opens no more. Also from the review: a cancel of a row that was moved answers 409, because a 200 would look as if the new appointment were gone; a moved note stays only on the new row; a cursor names only the id, so that no time of an appointment travels in a query string; a timeout is logged; practices in `PROVISIONING` and `FINALIZED` are not listed.

Acceptance: the BR-04 elapsed-hours fixture passes at ± 1 minute; a forced failure during reschedule keeps the old appointment; `NO_SHOW` before the start → `INVALID_STATUS_TRANSITION` (with M05); the reschedule-versus-booking race test passes; `limit=101` → 400; another patient's appointment → 404. For the fan-out: with B routed to a closed port, `GET /me/appointments` returns A's appointments and lists B as `UNAVAILABLE` at once; with B's reader stubbed to never resolve, B is listed as `TIMEOUT` after `vi.advanceTimersByTimeAsync(ME_FANOUT_TIMEOUT_MS)` under Vitest fake timers; a user with 21 practices gets the 20 most recently updated and the 21st as `LIMIT`; a practice in `DEPROVISIONING` with a still-active index row, or behind `PRACTICE_SCHEMA_REQUIRED`, appears only in `unavailablePractices`; when A and B are fanned out concurrently, each item's `practiceId` matches the `practice_identity` its branch read; at most `ME_FANOUT_CONCURRENCY` practice queries run at once (instrumented test).

### B04 — Portal booking and my appointments

**Commit:** `feat(web): add portal booking flow and my appointments` · **Depends on:** D16 · **Owner:** web-engineer

Scope: PW2–PW9 including the time-taken state, the cancel modal and reschedule; with D16 option A the "Your details for <practice>" step (screens 10–11 as redesigned by the ui-designer), shown the first time a signed-in user books at or joins a practice, with that practice's insurance options, on B01's join endpoint; "my appointments" across practices with the partial-result notice (a retry for `UNAVAILABLE` and `TIMEOUT`, a "more practices" notice for `LIMIT`); an `Idempotency-Key` per attempt; an `.ics` file without the service name.

From the security reviews of A05: names and phone carry autofill tokens, so a shared browser's form history may offer them to the next person; two tabs refreshing at once must not sign the loser out, so after a failed refresh try once more when `mb_csrf` has changed; signing out reaches other tabs too (`BroadcastChannel`); decide how long a patient stays signed in on a shared computer, before health data appears on these pages.

From the security review of B02: a note reaches nobody until the staff path reads it, so the form says that it is not read before the appointment and that urgent matters go by phone, and there is no go-live without a reader (RT-93). `providerId` can be null: the page then names no doctor. `PATIENT_PROFILE_INCOMPLETE` leads to the own details for that practice; 429 and 503 carry `Retry-After`.

From the security review of B03: `GET /me/appointments` runs once at a time per account, so the page waits for `Retry-After` and asks again instead of showing an error; `UNAVAILABLE` for a practice can pass with the next try, so the notice offers one; a cancel from a stale tab of an appointment that was moved answers `INVALID_STATUS_TRANSITION`, and the page then loads the list again.

Acceptance: Playwright in `ar` and `en`: book → listed → cancel; a first booking at a practice asks for the details for that practice, a booking at a practice already joined goes straight to the times; the taken-slot path shows the `SLOT_NOT_AVAILABLE` message and returns to the times; a double submit creates one appointment; with `unavailablePractices` mocked, the list shows the loaded items and the right notice per reason; the `.ics` file contains no service name; axe 0.

As built (`628fd8e`): the pages under `(portal)`, in a frame of their own with navigation, language and signing out: `appointments` (PW7), `appointments/{practiceId}/{appointmentId}` (PW8) with its `reschedule` (screen 17), and `book/{slug}` (PW5, PW6). A sign-in without a way back now lands on the appointments. A chosen time goes through signing in in `sessionStorage`, not in the URL and not in its fragment, because a URL stays in the browser's history, where a service and a doctor say something about someone; it ends with the tab, the booking and signing out. With D16 option B the details step starts from the account's profile, says what goes to the practice before anything does (RT-92), and asks for the privacy notice only when the API says it is missing. `AppointmentDto` gains `changeable`, `started`, `numberingSystem` and `hourCycle`, because the clock belongs to the API and a page must not judge a deadline or a start itself, and until M05 nothing but `started` tells that a `BOOKED` row has begun; `PublicPracticeDto` gains `id`, `insuranceTypes` and `cancellationDeadlineHours`. The autofill tokens on names and phone stay, because WCAG 1.3.5 asks for them; what a shared browser keeps is that browser's setting. How long a patient stays signed in on a shared computer is open for the client (RT-94). The steps and the "Before the visit" card of PW5, the "For" column of PW7, and the sections for preparation and the reason for visit on PW8 wait for what they show: a booking starts on a practice's page, family members come with FA01, and a note has no reader yet.

From the security review, which blocked it: what a join sent was not what the form showed. A cleared phone was left out of the request and the API copied the account's, and the number went under a hint written for the account. So a cleared phone now goes as none, the hint says that the number goes to the practice, and a join copies a provider or a number only when the practice asks for it; `PublicPracticeDto` gains `insuranceProviderTypes` and `insuranceNumberTypes`, so that the form shows exactly that. A chosen time lasts 15 minutes, because it is bound to no account and survives in a tab, and a lint rule now enforces what 03 §13 only claimed about web storage. Older than B04, and found by the same review: a sign-out could miss the session a refresh was making at that moment, and that session lived on for 30 days; a refresh and a sign-out now wait at the person's row. Its second pass approved the fixes and added two small points, both done: a sign-in now reaches the other tabs as a sign-out does, because a tab left open would otherwise send what it shows under the new person's cookies, and the 15 minutes now hold for what is stored, not only for what a page accepts.

From running the pages against the real API: with several doctors free at one time, a person could hold two appointments at that time, for instance by loading the page again after an answer got lost, when the key of the first attempt is gone. BR-25 and `APPOINTMENT_OVERLAP` close that, under the patient's lock.

From a review through four more lenses (flows, language and accessibility, tests and code, wiring), each finding checked by a second reader, then checked again on the final tree. What changed for it:

- **Keyboard:** no component showed a focus ring, because Tailwind 4's `outline-none` sets the variable the focus utilities read. The class is gone from every list with a focus outline, and only elements focused by script keep it. A running request uses `isPending`, so that focus stays on the button; a step that replaces another moves focus to its heading, and a field the API refuses in an earlier step takes it there.
- **Moving:** the chooser starts on the current doctor and the confirm card names the doctor, because "any doctor" could change it silently. An appointment that can no longer change says so at once, and a practice that now asks for more leads to the details and back.
- **Cancelling:** a refused cancel keeps its dialog and message until the person closes it, because the list's answer would have taken them away after milliseconds. A success says so in a status region, and focus lands on the heading.
- **What the API says:** `AppointmentDto.started`, because every past appointment otherwise read "too soon to change", until M05 sets real statuses. `JOIN_LIMIT_REACHED` says tomorrow instead of "a moment". `ApiError.retryAfterSeconds` reaches the fan-out's retry, which waits only for a short answer.
- **Signing in again:** `createQueryClient` takes `onUnauthenticated`, so a session that ends during a press leads to sign-in, with the way back kept, instead of a dead end. One `BroadcastChannel` object per document, because a page heard itself. The skip link keeps a fragment that holds `next` or a token, which it used to wipe.
- **Language:** names inside sentences are isolated, dates carry the year, the deadline uses the practice's digits, and each page has its own title.
- **Tests:** the stub answers as the API does, route by route, and every answer is checked against the generated schemas in `e2e/support/contract.ts`. Axe runs at the named states at 1440 and 390 px, not only where a test ends. "Axe 0" means no serious or critical violation; less than that is noted on the report.

### B06 — Portal home and what B04 left

**Commit:** `feat(web): add the portal home` · **Depends on:** - · **Owner:** web-engineer

Scope: PW2 Home, the next appointment and the practice's contact, which B04's Scope named and did not build: until then `/appointments` is where a sign-in lands. Also from B04's reviews: action buttons wait out a `Retry-After`, which only the fan-out reads today, and a 503 now removes Move; focus on three rare paths, a second "Try again" on the booking page, the chooser's "Try again" and a "Show more" that fails; a past appointment's "Show more" starts over on coming back; a chosen service's name in the public picker is not isolated, because the same text is React Aria's typeahead text; the `theme` cookie of [03 §6](03-web.md), which A05 had moved to B04, for a choice of light or dark in the settings. The titles of `global-not-found`, `global-error` and an unavailable practice belong to X06.

Acceptance: Playwright and axe in `ar` and `en`.

### B05 — Mobile booking, my appointments and offline cache

**Commit:** `feat(mobile): add booking flow, my appointments and offline cache` · **Depends on:** D16 · **Owner:** mobile-engineer

Scope: screens 02–08 and 14–18; with D16 option A the "Your details for <practice>" step (screens 10–11) at the first booking in a practice, on B01's join endpoint; the cross-practice upcoming list with the partial-result banner (reasons as in B04); the offline cache of [04 §10](04-mobile.md#10-offline-data); the `Idempotency-Key` reused on retry; an `expo-calendar` event without the service; the push primer after the first booking (registration in N02); `.maestro/offline.yaml` for X10.

Acceptance: RNTL flow tests, including the details step at the first booking in a practice and none at a practice already joined; the offline banner shows and booking is blocked offline; a retry after a network drop creates no duplicate; a response with `unavailablePractices` renders the loaded items and the banner; the persisted cache value contains no service name and is empty after logout and after a practice switch; the X10 offline flow passes; recorded VoiceOver and TalkBack checks in `ar` and `en`.

## Practice management

### M01 — Listing, practice page and theme settings

**Commit:** `feat(practice): add practice page and theme settings for admins` · **Depends on:** D3 · **Owner:** backend-engineer and web-engineer

Scope: `GET`/`PATCH /practices/{practiceId}/settings/listing` (platform database only, through `platform_app`'s column grant of P01: name per locale, slug change through `practice_slugs` with the old slug retired, `PRACTICE_SLUG_TAKEN`, reserved words, publish and unpublish; platform audit; clears the route cache entry); `GET`/`PATCH …/settings/practice-page` (practice database only: about, directions, sections, legal links; practice audit); `GET`/`PATCH …/settings/theme` (`generateBrandScale` in `@medibooker/design-tokens`, `THEME_COLOR_INVALID`, `adjusted`; practice database); screens W19 (live preview with the same generator) and W20, saving the two parts through their own operations.

From the security review of A01 to A03: `sign-up`, `check-inbox`, `verify-email`, `forgot-password`, `reset-password`, `account`, `privacy`, `appointments` and `book` are reserved slugs, like `sign-in`.

Acceptance: admin-only (another role → 403; another practice → 404); the property test passes for random valid hex values; practice B claiming A's retired slug → 409 `PRACTICE_SLUG_TAKEN`; the old slug redirects with 308 on the web; unpublishing makes the public page 404 on the next request in the same instance and within `PUBLIC_ROUTE_CACHE_MS` in another; a slug change writes a `platform_audit_events` row and a page change an `audit_events` row in the practice database, each in the transaction of its change; Playwright and axe in `ar` and `en`.

From the reviews of P02 and P03: the write paths accept only `https://` for the legal links (the page already guards) and check the format of the practice's e-mail address, because the page links it as `mailto:` and `?bcc=` must not get in; publishing requires the legal links a market asks for (health-data-security §11c; the seeded practices have none); the wording of publish and slug says that a slug goes to search engines through the sitemap and that unpublishing does not recall their copies, which matters for a slug with a person's name; the free times answer 404 for a service or a provider while `showServices` or `showTeam` is off.

### M02 — Services, opening hours and special days

**Commit:** `feat(practice): manage services, opening hours and special days` · **Depends on:** - · **Owner:** backend-engineer and web-engineer

Scope: `POST`/`PATCH …/services`; `GET`/`PUT …/opening-hours` (the `EXCLUDE` violation becomes the field error `OVERLAPS_EXISTING`); `GET`/`POST`/`DELETE …/special-days`; screens W12, W13 and the W20 hours editor.

Acceptance: role-matrix tests; an overlap returns a field-level error from the constraint; an inactive or offline service disappears from the public page on the next request; Playwright and axe.

### M03 — Team members and public-profile consent

**Commit:** `feat(staff): manage team members and public-profile consent` · **Depends on:** - · **Owner:** backend-engineer and web-engineer

Scope: `GET`/`POST`/`PATCH …/staff` (admin); `GET`/`PATCH /practices/{practiceId}/me/public-profile` (consent given and withdrawn only by the person, with the text version, audited, effective at once; a withdrawal also writes its revocation event for `revocation_journal`); admins can hide a profile; the team list shows support memberships with their expiry and lets the admin revoke them (A04); screens W15 and W16; the reception appears as a team card without names (current design, D14); photos wait for R02.

Acceptance: an admin cannot consent for someone else (403); the request right after a withdrawal returns the public page without the member; every give and withdraw writes a `staff_consents` row with `text_version` and an `AuditEvent`, and every withdrawal a `revocation_journal` entry; a revoked support membership answers 404 on its next request.

From the review of P03: the write path checks `languages` as language codes (the page shows an invalid one as written); while D14 stays A, the public list leaves out members who are no providers; the consent text says that the listing is on the public internet and indexed by search engines, that our own withdrawal takes effect at once and that copies at third parties cannot be recalled at once (`noarchive` reduces them); the fields shown (title, name, specialty or position, languages) are aligned with health-data-security §1 and BR-24; the text also says that bookable times can still appear anonymously under "any doctor" after a withdrawal (RT-88).

### M04 — Working hours, exceptions and slot management

**Commit:** `feat(scheduling): manage working hours, exceptions and slots` · **Depends on:** - · **Owner:** backend-engineer and web-engineer

Scope: CRUD `…/availability-rules` (doctors only their own), exceptions, `POST …/slots/generate`, `PATCH …/slots/{id}` block and unblock (BR-07 → `SLOT_HAS_APPOINTMENT`); screen W14.

Acceptance: a doctor editing another doctor's rule → 404; blocking a booked slot → 409; regeneration is idempotent; Playwright in `ar` and `en`.

### M05 — Dashboard: today, calendar, appointments and patients

**Commit:** `feat(web): add dashboard today, calendar and appointment handling` · **Depends on:** - · **Owner:** backend-engineer and web-engineer

Scope: `GET …/appointments` (staff, filters, cursor); `GET …/patients?query` with normalised Arabic and Latin search (reads audited); booking for a patient, including a patient profile without an account; screens W1, W2, W5, W6, W7 and W8 with list virtualisation.

From B03: a staff cancel with a reason, which is the first way to free a slot without SQL and stands before any go-live (RT-93); `/check-in`, `/complete` and `/no-show` (BR-11) with `NO_SHOW` before the start → `INVALID_STATUS_TRANSITION`. These take the patient's row lock too, as everything that changes a person's appointments does. The reader of the patient's note (RT-93) comes with W6.

Acceptance: the status-transition matrix passes; "سارة" is found with and without tashkeel; staff reads write audit events; Playwright and axe at 1280 and 1440 px in `ar` and `en`.

## Notifications

### N01 — Appointment e-mails, reminders and preferences

**Commit:** `feat(notifications): add appointment e-mails and reminders` · **Depends on:** - · **Owner:** backend-engineer, web-engineer and mobile-engineer

Scope:

- E03–E07 queued with `NotificationOutbox.enqueue(tx, …)` inside the transactions of B02 and B03 (booking, cancel, reschedule, status changes); reminders (BR-13) as outbox rows scheduled from the `Clock` in elapsed hours, sent when the poller finds them due.
- Reminder consent per practice (ADR 0005 §1.3, D8): `reminder_consents` in the practice schema (user, text version, given, withdrawn), off by default in every practice; `GET`/`PUT /practices/{practiceId}/me/reminder-consent`.
- `GET`/`PATCH /me/notification-preferences` (platform, BR-21: channel per message type; it never returns `SMS_NOT_ENABLED`); `GET`/`PATCH …/settings/notifications` (practice). At send time the channel resolver combines the practice's `appointmentChannels`, the account preference and the practice's reminder consent, and falls back to e-mail.
- Screens W21, PW12 and 29 (e-mail column, consent per practice); the `api-contract` rows of both preference endpoints and the new consent endpoint. Messages to managers of a managed patient come with FA01.

Acceptance: one message per recipient and event; a committed booking always has its outbox row and a booking rolled back after the enqueue has none; reminders only with that practice's consent: consenting in A does not enable reminders from B, and withdrawing in A cancels A's queued reminders; reminders at `reminderHoursBefore` elapsed hours before the start, also across the DST fixtures; the due reminders of a `SUSPENDED` practice wait and are cancelled if their appointment has passed; a locked preference → `NOTIFICATION_PREFERENCE_LOCKED`; a test proves templates contain no health fields.

From the security review of the real mail server (2026-11-06), for both outboxes: a hard deadline per message, because the timeouts only measure silence and a stall costs 30 seconds per row; a lease per row before sending, because a batch of 20 can outlast the five minutes and another instance would send again; ending a run on a failure of the server (`ETIMEDOUT`, `ESOCKET`, `ECONNECTION`, `EDNS`, `ETLS`, `EAUTH`) and giving the other rows back, so a wrong password costs one login and not all five attempts of every due row; `FAILED` at once on a permanent rejection (`EENVELOPE` with `permanent`); the row id and the attempts in the log line, and one error line when a row goes to `FAILED`; shutdown waits for the current row; at-least-once delivery recorded here: a server that took a message and then stayed silent gets it again. Also a no-reply sender or a footer, because replies land in the real mailbox (RT-91).

### N02 — Push notifications

**Commit:** `feat(notifications): add push notifications for the patient app` · **Depends on:** D10, U8, U9 · **Owner:** backend-engineer and mobile-engineer

Scope: `device_tokens` in the platform database (encrypted); `POST`/`DELETE /me/devices`; the push adapter for the chosen provider; N01–N06 payloads with type and IDs only (`practiceId` included for routing); deep links after sign-in; screen 28; development builds (Expo Go has no remote push).

Acceptance: tokens are deleted on sign-out and after 60 days unused; a payload snapshot contains no health data; a deep link without a session leads to sign-in first and opens the practice named in the payload.

### N03 — SMS channel and phone verification

**Commit:** `feat(notifications): add SMS channel and phone verification` · **Depends on:** D10 · **Owner:** backend-engineer, mobile-engineer and web-engineer

Scope:

- Phone verification (S05) on the account: `users.phone` and `phone_verified_at` in the platform database, one verified number per account (the later sign-in identifier of ADR 0004 #3); patient profiles keep only a contact phone (ADR 0005 §1.3). Hashed codes valid 10 minutes, rate-limited per number and account.
- The `SmsSender` adapter; the channel resolver of N01 gains SMS with e-mail fallback; S01–S04; the sender name in W21.
- Delivery receipts at `/api/v1/public/providers/{provider}/…`: the provider signature is verified before any lookup; the practice is found through `provider_messages` (provider message id, practice id, created at; on the health allowlist, kept 30 days), written when the SMS is handed to the provider; a callback opens at most one practice client through `runInPractice`, has a named throttler and is listed in `PUBLIC_OPERATIONS` with its reason.
- `SMS_NOT_ENABLED` only from practice-scoped operations that request SMS explicitly (the admin's test send with `channel: SMS` in W21); the `api-contract` rows change accordingly.

Acceptance: without a verified phone or a connected provider the message goes by e-mail; English SMS use GSM-7 and fit 160 characters; Arabic SMS fit 134 characters; phone numbers never appear in logs; an unsigned or unknown callback opens no practice client; `PATCH /me/notification-preferences` never answers `SMS_NOT_ENABLED`.

## Records, family, realtime, privacy

### R01 — Clinical notes

**Commit:** `feat(records): add versioned clinical notes` · **Depends on:** D13 · **Owner:** backend-engineer and web-engineer

Scope: `ClinicalNote` in the practice schema with append-only versions (`UPDATE` and `DELETE` revoked through `app_role()`), `ENTERED_IN_ERROR` with its revocation event for `revocation_journal`, encrypted body and visibility (BR-16); endpoints per the `api-contract` skill; `note.created` and `note.amended` to `practice:{practiceId}:doctors` from RT01; screens W6 and W10.

Acceptance: only doctors write notes; the practice app role cannot `UPDATE` or `DELETE` note versions; marking a note entered in error writes a `revocation_journal` entry; receptionist access follows the practice setting; patients see `SHARED` notes only.

### R02 — Attachments, logo and staff photos

**Commit:** `feat(records): add attachments with pre-signed upload and scanning` · **Depends on:** D9, D15 · **Owner:** backend-engineer and devops-engineer; security-reviewer reviews

Scope: on the port of F09 ([ADR 0015](../adr/0015-object-storage.md)), which signs uploads for at most 5 minutes, write once, and keeps a container per practice; the region of the account per market (RT-95); upload and download routes and the table of attachments; size and content type checked after the upload, before the file is visible, because a SAS cannot bind them; downloads as attachments with the checked content type, because a SAS cannot add `nosniff`; CORS on the account and `connect-src` in the CSP for the browser's upload; quarantine and lifecycle rules for uploads that never finish; `STORAGE_PROVIDER` required in production; the magic-byte allowlist; a ClamAV worker; image re-encoding without EXIF; signed downloads, each audited; the same pipeline for the logo (M01) and staff photos (M03); screen W11.

Acceptance: an EICAR file is quarantined; SVG or HTML → `FILE_TYPE_NOT_ALLOWED`; EXIF is stripped; files stay invisible until `CLEAN`; download URLs are short-lived; a download URL requested for another practice's attachment id → 404; audit rows are written. From the security review of F09: an object with `copied` is deleted and refused before any check; keys are built from ids only (`attachments/<uuid>`) and download names are fixed, never the patient's file name; download types only from the BR-17 and logo allowlist; after the checks the blob's headers are rewritten to the checked type and its metadata cleared; measured on the user's Azure account that a copy from the same account without a source signature is refused.

### R03 — Patient record views

**Commit:** `feat(records): add patient record read model and views` · **Depends on:** - · **Owner:** backend-engineer, web-engineer and mobile-engineer

Scope: `GET /practices/{practiceId}/patients/{id}/record` (staff, audited) and `GET /practices/{practiceId}/me/patients/{id}/record` (`SHARED` items only); screens W9–W11, PW10 and 19–21.

Acceptance: every staff read writes an `AuditEvent`; patients see only `SHARED` items; another patient's record → 404; the document viewer is sandboxed.

### FA01 — Family accounts

**Commit:** `feat(family): add family links, guardian declarations and invites` · **Depends on:** D12 · **Owner:** backend-engineer, web-engineer and mobile-engineer

Scope: `FamilyLink` (BR-19) and `family_invitations` in the practice schema; managers get an index row with capacity `PATIENT` through the integration outbox; the family-link branch of `@PracticeScoped('id', { patient: true })`; invitations (hashed, 7 days, link `…#practice=<id>&token=<token>`, `POST /practices/{practiceId}/family-invitations/accept` with the token in the body) through `@PracticeScoped('id', { invitation: 'family' })`; every `patientId` checked against active links; a revoked link writes its revocation event for `revocation_journal`; messages about a managed patient go to every active manager (BR-20, moved here from N01); the age-of-majority job per practice through `forEachPractice` with its `practice_job_runs` claim; screens PW11, 14, 24 and 25.

Acceptance: IDOR tests on every endpoint that takes a `patientId`; adults are linked only after they accept; every invitation failure gives the same 404 without a client; guardian access ends after the configured age plus the notice period (`FixedClock`); a manager's `GET /me/appointments` includes the managed patient's practice, and a link revoked in B while the manager's index row is still active removes B's managed-patient items (`fanout.int-spec.ts`); a notification about a managed patient reaches every active manager and no revoked one; a revocation writes a `revocation_journal` entry.

### RT01 — Realtime dashboard

**Commit:** `feat(realtime): add Socket.IO gateway and live dashboard updates` · **Depends on:** - · **Owner:** backend-engineer and web-engineer; security-reviewer reviews

Scope: the Socket.IO gateway with the access token verified at the handshake; server-assigned rooms `practice:{practiceId}:staff`, `practice:{practiceId}:doctors` (note events) and `user:{userId}`, joined through `runInPractice` after the same membership and status check as `@PracticeScoped` (ADR 0005 §10); every payload carries `practiceId` and IDs only, with event types exported from the api-client; every `REALTIME_RECHECK_SECONDS` (30) and at token expiry the gateway checks each socket's session, membership (expiry included) and practice status again; the web keeps one connection per session, invalidates queries and announces through an `aria-live` toast; a new booking enters the list with GSAP Flip. A single API instance; the multi-instance adapter comes with OPS01.

Acceptance: clients cannot join rooms themselves; under concurrent emits for A and B, a socket in A's room never receives B's event; a contract test proves payloads contain `practiceId` and IDs only; the socket disconnects on token expiry, revocation, a disabled or expired membership, and when its practice leaves `ACTIVE` (`SUSPENDED`, `MOVING`, `DEPROVISIONING`), at the latest one recheck later under fake timers; the toast appears without a reload within Playwright's default expect timeout.

### PR01 — Data export and account deletion

**Commit:** `feat(privacy): add data export and account deletion` · **Depends on:** D8, D11 · **Owner:** backend-engineer; security-reviewer reviews

From the security review of B02: D11 names `appointments`, `idempotency_keys` and the audit rows. `appointments` hold their patient with `ON DELETE RESTRICT`, so erasure (BR-14) anonymises; the note goes with the practice's data key or by clearing its column. From the review of B03: the export and erasure cover `cancelled_at`, `cancelled_by_id` and `rescheduled_from_id`, whose `ON DELETE RESTRICT` means newest first or anonymising.

Scope:

- `POST /me/exports` and `GET /me/exports/{id}` (replacing `GET /me/export` in the `api-contract` and `health-data-security` skills): an asynchronous job (`account_exports`) with one step per practice of the index, each step through `runInPractice` with the caller's own and managed patients read from that practice's database, each step's part encrypted; the export is complete only when every practice has delivered; download through a short-lived signed URL (R02 storage).
- `DELETE /me`: deactivate at once, revoke all sessions and delete the user's device tokens, account tokens and notification preferences (platform); a saga (`account_deletions` with one step per practice, through `runInPractice`) unlinks the account from patient profiles and family links in each practice database and stops its notifications, while the records stay for each practice's retention duty (BR-14); each finished step deletes that practice's `practice_access` rows of the user; the platform account is anonymised after the platform retention period, once every step has finished.
- Retention periods as configuration, including those of `account_exports` and `account_deletions` (ADR 0005 §1.1), and of past slots and provider absences, which nothing deletes yet and whose `ON DELETE RESTRICT` blocks erasing a staff row (review of P05).

From the security review of A01 to A03: purge ended sessions, used tokens and sent outbox rows; `users`, `account_profiles`, `sessions`, `account_tokens`, `account_consents` and `account_notifications` are part of export and deletion; decide what `user:<id>` in `platform_audit_events` means after a deletion.

Acceptance: the export contains only own and managed data from every practice of the index; a family link revoked in a practice while the index row is still active keeps the managed patient out of that practice's part; when two practices are exported concurrently, each part's `practiceId` matches the `practice_identity` its step read; a practice that is not `ACTIVE` or behind the schema keeps its step pending, and the export completes after it returns; each deletion step is idempotent (run twice, same result); after deactivation no device token, account token or notification preference of the user remains, and after each step none of its `practice_access` rows for that practice; a failing step retries with backoff and raises an alert; the user row is anonymised only after every step finished; audit events are written in both databases; `grep -n 'GET /me/export' .claude/skills/health-data-security/SKILL.md .claude/skills/api-contract/SKILL.md` finds nothing.

## Release and operations

### REL01 — Mobile build and release pipeline

**Commit:** `ci(mobile): add EAS build profiles, Maestro flows and releases` · **Depends on:** D6, U9, U10 · **Owner:** devops-engineer and mobile-engineer

Scope: the EAS project with final identifiers; credentials stay in EAS; `eas-build.yml`; `node` and `pnpm` pinned per profile; Maestro flows register → verify → book → cancel; verified App Links and Universal Links for token-free paths (`/.well-known/assetlinks.json` and `apple-app-site-association` served by the web); EAS Update and `runtimeVersion` only after the DPO's approval; the CycloneDX SBOM per release; the documented step for raising `minimumSupportedVersion`.

Acceptance: preview builds install on test devices; the Maestro flow passes in `ar` and `en`; OTA updates (if approved) ship only for JavaScript-only changes; each release carries its SBOM.

### OPS02 — Practice backups, restore and offboarding

**Commit:** `feat(db-migrate): add per-practice backup, restore and offboarding` · **Depends on:** - · **Owner:** devops-engineer and backend-engineer; security-reviewer reviews

Scope (ADR 0005 §4.7, §5 and §8; every command writes the operator audit of ADR 0005 §5.2):

- `medibooker-db backup <practiceId> | --all`: daily for every status that holds data; `pg_dump --format=custom` as the practice owner, a manifest with row counts and per-table checksums, encrypted with AES-256-GCM under the practice's own backup key (`provision` gains the key step, `backup_key_ref`; a rerun adds it to existing practices), the key id in the file header, written through a `BackupTarget` port (a local directory in local and CI; object storage in the practice's region from OPS01); bounded concurrency (`BACKUP_CONCURRENCY`).
- `medibooker-db restore <practiceId> --backup <id> [--inspect]`: decrypts into a temporary file and verifies the authentication tag before `pg_restore` reads it; creates `practice_<id32>_r<timestamp>` through `createPracticeDatabase()`, so only A's app role can connect; restores; runs `migrate deploy` and writes `schema_version`; checks `practice_identity` and the manifest; re-applies the `revocation_journal` entries newer than the restore point, deactivates the memberships the index shows as removed after it and rebuilds A's index rows with a version reset, resets A's saga steps that finished after it, and copies newer `audit_events` from the old database when it is readable; then `route_version` + 1 and `RESTORE_REVIEW`, or with `--inspect` no routing. The runbook in `docs/dev/` produces incident dumps from a temporary PITR cluster.
- `medibooker-db practice suspend|resume <practiceId> --reason <text>` (resume also ends `RESTORE_REVIEW`).
- `medibooker-db move <practiceId> --cluster <id>` (ADR 0005 §5.4).
- `medibooker-db rotate-credentials <practiceId> | --all [--owner]` (ADR 0005 §4.7).
- `medibooker-db deprovision <practiceId>` in resumable steps (ADR 0005 §5.5): status `DEPROVISIONING` and index rows inactive; `CONNECT` revoked and sessions terminated after `PUBLIC_ROUTE_CACHE_MS`; the final export (dump, structured export and the files under the practice's storage prefix, encrypted with a key per export) recorded in `practice_exports`, with `GET /api/v1/me/practice-exports` and `POST /api/v1/me/practice-exports/{id}/download-url` for the recipients (fresh MFA, short-lived signed URL, audited as `PRACTICE_EXPORT_DOWNLOADED`, approval reference); `--finalize` after `drop_after` destroys the keys first, then drops the database, both roles, the secrets, the backups, the export, every object version and delete marker under the prefix, and the practice's `practice_access`, `practice_job_runs` and `revocation_journal` rows, and sets `FINALIZED` and `purged_at`.
- The migrate image gains `postgresql-client-18` from PGDG ([07 §1](07-docker-ci-cd.md#1-images)); `pg_dump` and `pg_restore` run through the `PgTools` port.
- `tenancy/restore.int-spec.ts`, `tenancy/move.int-spec.ts`, `tenancy/rotation.int-spec.ts` and `tenancy/deprovisioning.int-spec.ts`; the runbooks in `docs/dev/` for restore (including the PITR path and dropping finalized practices after a cluster PITR), move, rotation and offboarding.

Acceptance:

- A backup of A restored as a new database matches the manifest and has the same `practice_identity`; B's app role gets `permission denied for database` on it, routed and with `--inspect`; after the routing switch the API serves the restored database to A's admins only (`RESTORE_REVIEW`), and to everyone after `practice resume`; B's data and connections are untouched.
- A membership removed, a family link revoked and a consent withdrawn after the backup point are still removed, revoked and withdrawn after the restore; a membership added after the restore point works on the next request; a deletion saga step that finished after the backup point runs again.
- The backup file does not start with `PGDMP`, and `pg_restore --list` on it fails; decryption with a wrong key fails authentication; decryption with the right key yields an archive that `pg_restore --list` accepts; a backup of a key version older than the current one still restores.
- A write during `move` gets 503 and is not lost; the moved database has the same identity, checksums, ACL and locale provider; the old database refuses A's app role.
- After `rotate-credentials`, the old password is refused, requests keep answering 200 and a request in flight completes.
- After step 1 of `deprovision`, signed-in requests to A answer 404 at once and public ones after `PUBLIC_ROUTE_CACHE_MS`; a client cached before answers 503, never data.
- `--finalize` before `drop_after` is refused; afterwards `psql -lqt` lists no database of A, `SELECT rolname FROM pg_roles WHERE rolname LIKE 'practice_<id32>%'` returns nothing, a versioned listing of A's storage prefix is empty, no `practice_access`, `practice_job_runs` or `revocation_journal` row of A remains, a retained backup file of A can no longer be decrypted, the tombstone shows `purged_at`, and `practice:create` with A's old slug answers `PRACTICE_SLUG_TAKEN`.
- Every command left `platform_audit_events` rows before and after it ran; `--finalize` and the routed restore without an approval reference are refused outside `local` and `ci`.

### OPS01 — Deployment to the chosen hosting

**Commit:** `ci(deploy): deploy API and web to the selected region` · **Depends on:** D4 revisited (option A, public since 2026-11-04; recommendation C before the first real practice data), D8, D9 · **Owner:** devops-engineer; security-reviewer reviews

Scope:

- Infrastructure as code for the chosen provider and region: the platform database (with high availability) and a PostgreSQL 18 cluster for practice databases on a private network, point-in-time recovery and encrypted backups, `hostssl` only with `scram-sha-256` and `ssl_min_protocol_version = 'TLSv1.2'`, the server log settings of ADR 0005 §4.10 with an in-region log sink kept at most 30 days, and `autovacuum_max_workers` and `autovacuum_naptime` sized for the number of databases.
- `medibooker-db cluster bootstrap <id>`: the cluster roles (`platform_owner`, `platform_app` as a group with the login roles `platform_app_a` and `platform_app_b`, `medibooker_provisioner` with `createrole_self_grant = 'set'`), after checking that the managed service lets a non-superuser role create databases and roles, set `createrole_self_grant`, and receive `ADMIN` on the roles it creates (D9); `CONNECT` revoked from `PUBLIC` on the platform and maintenance databases where the provider allows it; the CA stored behind `ca_secret_ref`; the cluster registered in `database_clusters` with `tls_mode: verify-full` and its measured database limit.
- The secret-store adapter for the `SecretStore` port: four secrets per practice; the API identity reads app secrets and field keys, the migration runner identity owner secrets, the backup identity backup keys, and only lifecycle tasks the provisioner reference. Scheduled credential rotation (`rotate-credentials --all`, the platform's a/b switch by redeploy) and rotation as the first runbook step on a suspected leak.
- The connection budget per cluster (ADR 0005 §2.3) with `PRACTICE_APP_CONNECTION_LIMIT` and `PRACTICE_OWNER_CONNECTION_LIMIT` per environment, recorded in ADR 0010 and applied with `roles reconcile`; the migrate task's size from F05's measurement. PgBouncer only if the budget requires it, with the authentication and pool settings of ADR 0005 §2.4, after rerunning `connection-manager.int-spec.ts` through it.
- Deploy order in `deploy.yml` (OIDC, the task identity recorded as operator principal): `migrate platform`, then the practice runner as a one-off task in the region, then API and web by digest, then `verify` and the smoke test; no task log is streamed into Actions. The provisioning job wired to `practice:create`; the daily per-practice backup with OPS02's tooling; a monthly restore of a rotating sample of production backups into an isolated restore cluster in the region, and a quarterly PITR drill per cluster that records the measured RTO (ADR 0005 §8).
- `medibooker-db break-glass open|close` (ADR 0005 §9.4): a `SELECT`-only login role with `VALID UNTIL`, statement logging for that role (where the provider needs `pgaudit` or a parameter grant, a D9 criterion), audit rows in both logs, a scheduled `close --expired` sweep that terminates sessions at expiry; the statement log stored as health data.
- An edge proxy with TLS 1.2+, HSTS (`includeSubDomains`, `preload` decided here), per-IP rate limits and bot rules for the public page; its access log records the route template or drops the path segments after `/practices/`, truncates client addresses, and holds no query strings or cookies; it sets `X-Request-Id` itself, replacing any client value ([02 §4](02-api.md#4-request-pipeline-and-core-abstractions)); API and web reachable only through it.
- The e-mail provider's bounce callback through the `provider_messages` mechanism of N03; the runbooks for `MIGRATION_STATE_UNKNOWN` (decided with `verify`), break-glass and the PITR restore; the Socket.IO adapter if more than one API instance runs, with TLS to its store.
- Monitoring and alerts: runner failures and `verify` drift; practices behind `PRACTICE_SCHEMA_REQUIRED` or outside `MARKETS`; a database ACL other than owner and app role; backup age per practice and restore-drill results; connections against `max_connections` and per role against `CONNECTION LIMIT`; transaction-ID age (`age(datfrozenxid)`) per database; size per practice database and cluster disk; long-running and idle-in-transaction sessions; WAL archiving failures; relay lag and the oldest due outbox row; stuck saga steps; client creations, evictions and `acquire()` waits per instance; 503 rate per practice; 5xx spikes; latency (p95 per route template); uptime checks of the public page, the API and the web; failed logins; refresh-token reuse. The practice id is a label only on per-practice alerts; the others use top-k, so the number of series stays bounded.

From the security review of A01 to A03: shared throttler storage, because the limits multiply with instances; an alert when the nightly deletion of unconfirmed accounts fails, and a command that re-encrypts fields with the newest key, so that an old key can be retired; an alert on a reused refresh token; platform audit rows that allow tracing a wave of attempts; equal work for a known and an unknown address on `register`, `login`, `forgot` and `resend`; the data processing agreement and region of the mail provider (D10).

From the security review of the real mail server: the mail password moves to the secret store with a `_REF` form of `SMTP_URL`, and a rotation step in the runbook; DMARC beyond `p=none` for the sender domain; the menu asks the API which mail server it has, instead of reading the file as compose would. All of RT-91 is settled before real users. From the security review of B01: with several instances only one sweeps the practices for the relay, and job clients get their own cap of creations.

From the security review of B04: the reverse proxy logs no query strings, because moving an appointment asks the public free times with the id of the booked service, under the person's session cookies. From the security review of B02: an alert on bookings per practice and on bursts of refused bookings, whose access lines carry no person (RT-93); the limit of ten bookings a minute per address checked against real traffic, where many people can share an address; with several instances the share of `AccountTransactions` is per instance, like the pool.

Acceptance: a staging deploy from a digest with approval runs both migration steps and `verify`, and its summary shows every practice at the target version; a deliberately failing fixture migration in one staging practice leaves the others migrated, answers 503 only for that practice and raises the alert; a practice created in staging through `practice:create` is provisioned and serves its public page, and its audit row records the authenticated task principal; `pg_stat_ssl` shows `ssl = true` for every API and task connection; the restore sample and the PITR drill pass and are documented; alerts fire in a drill (5xx spike, failed logins, migration failure, an idle-in-transaction session, an archive failure, a practice database whose `CONNECT` is open to `PUBLIC`); a break-glass drill leaves rows in both audit logs and its session is gone at expiry; a forged `X-Forwarded-For` at the edge does not change the rate-limit key, and the edge log holds no practice or patient id; a practice app credential from the secret store cannot connect to another practice database; security-reviewer verdict APPROVE.

From the review of P03: the web stays reachable only through the edge, because on its own port a forged `X-Forwarded-For` opens its own limit (here 8082, on loopback only); `trusted_proxies` and `TRUST_PROXY_HOPS` change together; the edge access log is personal data and needs a retention period; `robots.ts` disallows everything on staging hosts. From the review of P05: no extended TTL or serve-stale on the two free-times routes; edge logs without query strings, because an address with a `serviceId` shows interest in a health service; rate limits per IPv6 /64.
