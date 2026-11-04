# Repository and tooling

The repository root is the v2 monorepo. The F01 scaffold in the working tree is the source of truth for everything marked F01, and [ADR 0006](../adr/0006-toolchain-and-version-policy.md) records its decisions; later items extend it and never redo it ([08-roadmap.md](08-roadmap.md)).

## 1. Repository layout

```text
MediBooker-v1/                         v2 monorepo; v1, removed on 2026-11-02 (L00), is in the git history
├─ .github/                            F02: actions/setup, workflows, pull_request_template.md (07)
├─ apps/
│  ├─ api/                             F03: @medibooker/api, NestJS 12 (02-api.md); F04: Prisma schemas of the platform and practice databases
│  ├─ db-migrate/                      F04: @medibooker/db-migrate, the database lifecycle CLI medibooker-db (02 §6); F05: the migrate image
│  ├─ web/                             F06: @medibooker/web, Next.js 16 (03-web.md)
│  └─ mobile/                          F07: @medibooker/mobile, Expo SDK 58 (04-mobile.md)
├─ packages/
│  ├─ tsconfig/                        F01: TypeScript presets with fixture projects
│  ├─ eslint-config/                   F01: ESLint presets and the local guardrail plugin with rule tests
│  ├─ i18n/                            F06 (locales), X04 (ICU catalogues)
│  ├─ api-client/                      X03: generated client, error mapping, query client
│  └─ design-tokens/                   X05: design and motion tokens for web and React Native
├─ infra/local/                        F04: postgres/init/01-cluster.sh · F06: Caddyfile
├─ scripts/                            F01: git-hook scripts with tests (check-commit-msg.ts, check-hooks.ts, run-gitleaks.ts, lib/) · F04: check-migrations.ts · X02: check-drift.ts
├─ docs/                               adr/, architecture/, dev/ (F01), product/
├─ compose.yaml · docker-bake.hcl      F04 · F05 (07)
├─ package.json · pnpm-workspace.yaml · pnpm-lock.yaml · turbo.json                  F01
├─ eslint.config.js · tsconfig.json · vitest.config.ts                                F01: lint, typecheck and tests of the root scripts
├─ prettier.config.js · .prettierignore · .editorconfig · .gitattributes · .gitignore · .node-version   F01
├─ lefthook.yml · .gitleaks.toml       F01 · .gitleaksignore: F02 (the two accepted v1 findings in the history, U1)
├─ renovate.json                       F02
└─ CLAUDE.md · README.md · .claude/
```

v2 shares no code with v1. The workspace members are `apps/*` and `packages/*` only.

## 2. Root tooling (F01)

### package.json

- `"name": "@medibooker/root"`, `"private": true`, `"type": "module"`, `"packageManager": "pnpm@12.16.1"`, `"engines": { "node": "^26.13.0" }` (Node 26 only; no Node 24 job).
- Scripts from F01:

  | Script | Command |
  |---|---|
  | `lint` · `lint:root` | `turbo run lint lint:root` · `eslint --max-warnings=0 scripts eslint.config.js prettier.config.js vitest.config.ts` |
  | `typecheck` · `typecheck:root` | `turbo run typecheck typecheck:root` · `tsc -p tsconfig.json` |
  | `test` · `test:root` | `turbo run test test:root` · `vitest run` (the tests of `scripts/`) |
  | `format` · `format:check` | `prettier --write .` · `prettier --check .` |
  | `verify` | `node scripts/check-hooks.ts && node scripts/run-gitleaks.ts && prettier --check . && turbo run lint lint:root typecheck typecheck:root test test:root` |

- `verify` starts with `scripts/check-hooks.ts` (`lefthook check-install`): it fails with an install hint when the git hooks are missing or out of date, because a commit would then skip the secret scan and the commit-message check (with `LEFTHOOK=0`, which only CI sets, lefthook skips the check). The staged secret scan follows, so `verify` runs after `git add`.
- Every lint script, in the root and in each package, runs ESLint with `--max-warnings=0`: a warning fails like an error.
- Scripts added by later items: `build` and `dev` (F03); `test:integration`, `db:up`, `db:migrate`, `db:seed`, `db:reset` and `check:migrations` (F04); `test:e2e` (F06); `generate` and `check:drift` (X02). From F04 on, `verify` also runs `check:migrations`, and from X02 on `build` and `check:drift`.
- Root `devDependencies` serve the root scripts and configs: `@medibooker/eslint-config`, `@medibooker/tsconfig` (`workspace:*`), `@types/node`, `eslint`, `lefthook`, `prettier`, `turbo`, `typescript`, `vite`, `vitest` (`catalog:`). Every package declares the tools its own scripts call (`typescript`, `vitest`, `@nestjs/cli`, …), so filtered installs in Docker work (07).

### pnpm-workspace.yaml

As built in F01:

```yaml
packages:
  - apps/*
  - packages/*
catalogMode: prefer        # `pnpm add` writes catalog: entries
savePrefix: ''             # exact versions; Renovate moves them
minimumReleaseAge: 1440    # pnpm 12 default, written out on purpose (ADR 0006)
trustPolicy: no-downgrade  # refuse versions that lost provenance (ADR 0006, decision 3)
trustPolicyExclude:
  - lefthook@2.2.2         # with a dated comment
catalog: { … }             # one exact version per shared dependency
allowBuilds:
  lefthook: true
```

Added by later items, each with a reason in the commit body:

| Setting | Item | Content |
|---|---|---|
| `allowBuilds` entries | per item | `@swc/core` (F03), `prisma` and `@prisma/engines` (F04), `argon2` (A01); others only after review of the install report |
| `packageExtensions` | F05 | Marks the `prisma` peer of `@nestjs-cls/transactional-adapter-prisma` as optional, so `pnpm deploy --prod` leaves the Prisma CLI out of the API image |
| `overrides` | F07 | Pins `react`, `react-dom`, `@types/react`, `@types/react-dom` to the catalog version, so no package can install a second React |

`minimumReleaseAgeExclude` is used only for an urgent security fix: an exact `pkg@x.y.z` entry with a dated comment, removed once that version is older than the gate.

### turbo.json

- As built in F01: `globalDependencies` `.node-version` and `pnpm-workspace.yaml`; `globalEnv` `CI` and `NODE_ENV`; strict environment mode (Turborepo 2's default), so a task sees only the variables it declares.
- Tasks `build` (`^build`, outputs `dist/**`), `lint` and `typecheck` (`^build`), `test` (`^build`, no outputs: an empty `coverage/**` made Turborepo warn on every run, so F03 adds `coverage/**` back when it turns coverage on).
- The root tasks `//#lint:root`, `//#typecheck:root` and `//#test:root` list their `inputs` explicitly (the scripts, the root configs and `pnpm-lock.yaml`; `//#lint:root` also the eslint-config sources), so they stay cacheable. `//#test:root` also reads `.gitleaks.toml` and `lefthook.yml`, which its tests use, and declares `env: ["GITLEAKS_VERSION"]`: CI exports the version of the gitleaks it installs, so a gitleaks upgrade reruns the rule test.
- Added later:

  | Task | Item | Rule |
  |---|---|---|
  | `dev` | F03 | persistent, no cache; i18n and design-tokens run `tsc -b -w` next to the apps (X04, X05) |
  | `db:generate` | F04 | `apps/api/turbo.json` makes `build`, `lint`, `typecheck`, `test` and `dev` depend on it; declares no environment variables |
  | `test:integration` | F04 | no cache; passes through `DOCKER_HOST` and `TESTCONTAINERS_*` |
  | `db:migrate`, `db:seed`, `db:reset` | F04 | no cache; `passThroughEnv: ["PLATFORM_DATABASE_URL", "PLATFORM_MIGRATION_URL", "PRACTICE_MIGRATION_URL", "SHADOW_DATABASE_URL", "PROVISIONER_DATABASE_URL", "DATABASE_CLUSTER_ENDPOINTS", "SECRET_STORE", "DEV_SECRET_SEED", "APP_ENV"]` for values set in the shell; locally the tools read the root `.env` themselves ([07 §2](07-docker-ci-cd.md#2-compose-for-local-development)); `db:seed` depends on `db:generate` |
  | `test:e2e` | F06 | `dependsOn: ["build"]`, from P03 also `@medibooker/api#build`; `passThroughEnv: ["E2E_*"]`; no cache; the fixtures read the root `.env` through `loadWorkspaceEnv()` (P06) |
  | `generate` | X02 | api: after `build`; api-client: after `@medibooker/api#generate`; i18n, design-tokens: none. Outputs are committed |

`build` does not depend on `generate`: generated files are committed and CI fails on drift.

### TypeScript presets (`@medibooker/tsconfig`)

| Preset | Content | Used by |
|---|---|---|
| `strict.json` | Strictness only: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `forceConsistentCasingInFileNames`, `skipLibCheck`, `resolveJsonModule` | every preset; mobile directly |
| `node.json` | `target`/`lib` `es2024`, `module`/`moduleResolution` `nodenext`, `types: ["node"]`, `noEmit` | root scripts, eslint-config, db-migrate |
| `library.json` | `node.json` plus declarations, declaration maps and source maps from `${configDir}/src` to `${configDir}/dist` | i18n, design-tokens |
| `nest.json` | `node.json` plus `experimentalDecorators`, `emitDecoratorMetadata` | api |
| `nextjs.json` | `es2024` with `dom` and `dom.iterable`, `moduleResolution: bundler`, `jsx: preserve`, `allowJs`, the `next` plugin | web |

Each preset is proven by a fixture project in `packages/tsconfig/fixtures`. App specifics:

- **api:** extends `nest.json` and sets `lib: ["es2025", "esnext.temporal"]` and `useDefineForClassFields: false`. The emit target stays `es2024` because `unplugin-swc` copies `target` into SWC and @swc/core 1.16.21 rejects `es2025`; Node 26 runs ES2025 either way.
- **db-migrate:** extends `node.json` with `allowImportingTsExtensions` and `erasableSyntaxOnly`, like the root `tsconfig.json`, because Node runs it by type stripping.
- **Consumers of `@medibooker/db-migrate/testing`:** the API's test tsconfig (F04) and the web's e2e tsconfig (P06) set `allowImportingTsExtensions`, which `noEmit` allows; without it TypeScript reports TS5097 for db-migrate's `.ts` imports.
- **mobile:** `extends: ["@medibooker/tsconfig/strict.json", "expo/tsconfig.base"]`, in this order, so Expo's `DOM` and `ESNext` libs win.
- **api-client:** extends `strict.json` with bundler resolution and the DOM lib, and uses only fetch types that React Native also declares (`RequestInit`, `Response`, `AbortSignal`, not `HeadersInit`).

### ESLint presets and guardrails (`@medibooker/eslint-config`)

Flat-config presets exported from `.`: `base({ tsconfigRootDir })`, `nest()`, `react()`, `vitest()`, plus the local `plugin`. Every package has its own `eslint.config.js`, because ESLint 10 looks up the config from each linted file's directory.

The local `medibooker` plugin has three guardrail rules:

| Rule | Guards |
|---|---|
| `medibooker/no-hex-colors` | No hex colour literals in UI code (non-negotiable 7) |
| `medibooker/no-physical-direction-classes` | No `ml-*`, `pr-*`, `left-*`, `text-left`, `border-l`, … in class strings and in `cn`, `clsx`, `cva`, `twMerge`, `twJoin`, `tv` arguments; names the logical replacement (RTL). The centring idiom (`left-1/2` or `right-1/2` with a horizontal translate in the same class list) stays allowed, because translate does not mirror |
| `medibooker/no-system-clock` | No `new Date()`, `Date()`, `Date.now`, `Temporal.Now` in `src/modules/**` of the API; inject the `Clock` |

- `base` adds type-aware typescript-eslint (`strictTypeChecked`, `stylisticTypeChecked`), `consistent-type-imports`, `switch-exhaustiveness-check`, import hygiene (`no-duplicates`, `no-self-import`), `eqeqeq`, `no-console`, `reportUnusedDisableDirectives: 'error'` (an `eslint-disable` comment that suppresses nothing fails lint) and Prettier last.
- `nest` adds `import-x/no-cycle` (an ESM cycle crashes Nest at startup), `no-extraneous-class` with `allowWithDecorator` and the clock rule outside tests.
- `react` adds the colour and direction guardrails, except in tests. `vitest` makes `.only` and `.skip` errors.
- Rule tests and preset tests on real fixture files prove every guardrail fires.
- Every Vitest config sets `passWithNoTests: false` and `allowOnly: false`: a run without tests fails, and a focused test (also a RuleTester case with `only: true`) fails every run, not only under `CI`. The root `vitest.config.ts` runs only `scripts/**/*.test.ts`; each package runs its own tests.

Per app:

| App | Composition | App-level additions |
|---|---|---|
| api | `base` + `nest` + `vitest` | `no-restricted-imports` of `@nestjs/event-emitter` outside `src/common/events` (P04) |
| db-migrate | `base` + `vitest` | `no-console` off for the CLI entry |
| web | `base` + `react` + `vitest` + ESLint 10-compatible Next.js and accessibility rules chosen in F06 | `no-system-clock` also on `src/app/**` (X06); no `localStorage`/`sessionStorage`; `react/no-danger` except the JSON-LD component |
| mobile | `base` + `react` + Expo rules chosen in F07 + a `jest` preset (`eslint-plugin-jest`, `no-focused-tests` and `no-disabled-tests` as errors) | no `left`/`right`/`marginLeft`/`paddingRight` style keys |

eslint-config-next and eslint-config-expo depend on plugins that declare ESLint 9 at most (ADR 0006, decision 6); F06 and F07 choose ESLint 10-compatible replacements and record them in ADR 0006.

### Prettier and Markdown

- `prettier.config.js`: `printWidth: 100`, `singleQuote`, `trailingComma: 'all'`, `semi`, `endOfLine: 'lf'`. X07 adds `prettier-plugin-tailwindcss` with `tailwindStylesheet` and `tailwindFunctions: ['cn', 'cva']`.
- `.prettierignore`: `.claude/`, `*.md`, `pnpm-lock.yaml`; Prettier also honours `.gitignore`. Markdown is formatted by hand: ATX headings, one blank line between blocks, fenced code with a language.

### Git, editor and hooks

- `.gitattributes`: `* text=auto eol=lf`; `*.cmd`, `*.bat` and `*.ps1` keep CRLF, one pattern per line (gitattributes has no brace expansion); images, PDFs and fonts are `binary`; `pnpm-lock.yaml linguist-generated`. Generated folders get `linguist-generated` with the item that creates them (X02, X03, X05).
- `.editorconfig`: UTF-8, LF, two spaces, final newline; Markdown keeps trailing whitespace; `*.cmd`, `*.bat` and `*.ps1` CRLF, matching `.gitattributes`. `.node-version`: `26.13.0`.
- `.gitignore`: dependencies, caches and build output (`node_modules/`, `.turbo/`, `dist/`, `coverage/`, `*.tsbuildinfo`, `.eslintcache`); environment files (`.env`, `.env.*`, `*.env`) except `.env.example`; lefthook's local overrides (`lefthook-local.*`, `.lefthook-local.*`), because they can switch a hook off; logs, OS and editor files (`.vscode/` except its shared settings and extension list); keys, certificates and signing material (`*.pem`, `*.key`, `*.p8`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.mobileprovision`), which gitleaks cannot scan; Claude Code's local `.claude/data/` and `.claude/settings.local.json`.
- `lefthook.yml` (lefthook 2.2.2; every command calls `node` directly, so the hooks work in Git's `sh` on Windows; arguments are single-quoted):
  - `assert_lefthook_installed: true`: a generated hook that cannot find lefthook, for example after `node_modules` was deleted, blocks the commit instead of letting it through unchecked; `min_version: 2.2.2`: an older lefthook first on `PATH` fails instead of running the hooks;
  - `pre-commit`, in parallel: `prettier --check --ignore-unknown` on the staged files (never rewrites or re-stages) and `node scripts/run-gitleaks.ts`, which runs `gitleaks git --pre-commit --staged` with the repository policy (`.gitleaks.toml`, `--redact`, `--ignore-gitleaks-allow`) and fails closed when gitleaks is missing, cannot start or is stopped by a signal;
  - `commit-msg`: `node scripts/check-commit-msg.ts` enforces Conventional Commits, `<type>(<scope>)!: <summary>` (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`; optional lowercase kebab-case scope; optional `!` for a breaking change), a header of at most 72 characters without a final period, and an empty second line before a body; headers that git writes itself pass.
  - No pre-push hook: the pre-commit scan covers every commit, and CI is the hard gate (ADR 0006, decision 9). CI sets `LEFTHOOK=0`.
- `.gitleaks.toml` extends the default rules (`[extend] useDefault = true`) with the rule `medibooker-password-assignment`, because the defaults miss plain password assignments such as `DB_PASSWORD=…` and `password: '…'`:
  - keys ending in `password`, `passwd`, `passphrase`, `pwd` or `secret` (any case, so also `JWT_SECRET`), or `pass` on its own or after `_`, `.` or `-` (`SMTP_PASS`, `auth.pass`; not `bypass`);
  - after `=`, `:`, `:=` or `=>`, a value of at least 8 characters: quoted without whitespace (also the literal fallback in `x ?? '…'` and `x || '…'`), unquoted to the end of the line (env, YAML, ini; it may contain `,` and `;` but not end with them), or the password of a connection URL, also with an empty user name;
  - placeholders are allowed (`changeme`, values containing `example`, `<…>`, `${VAR}`, `${VAR:-}`, `${VAR:?…}`, `$VAR`, `process.env.*`); a shell default with a literal value (`${VAR:-…}`) is reported; a quoted value with spaces is not (translation labels).
- Every gitleaks scan, local and in CI, uses one policy (`policyArguments()` in `scripts/lib/gitleaks.ts`): `.gitleaks.toml`, `--redact` and `--ignore-gitleaks-allow`, so an inline `gitleaks:allow` comment cannot silence a finding; only a reviewed change to `.gitleaks.toml` or `.gitleaksignore` can, and F02 pins `.gitleaksignore` to the two accepted fingerprints. `scripts/gitleaks-config.test.ts` writes synthetic fixtures (18 that must be reported, one of them with an inline `gitleaks:allow`, and 18 that must not) into a temporary directory at test time and runs the real binary with that policy (skipped locally without gitleaks, failing under `CI=true`), so no scan of the repository sees them and no path allowlist exists.
- `.gitleaksignore` arrives with F02 and holds exactly the commit-qualified fingerprints of the two v1 findings in the git history, under a comment dated 2026-11-04: the user declined to rotate that credential and accepted the risk (U1 in [09](09-risks-and-decisions.md)). gitleaks reads the file from the scan root whatever `--gitleaks-ignore-path` says, and a commit-less entry would silence a finding in every commit, so F02 pins it: `scripts/run-gitleaks.ts` and the CI `security` job fail closed when it differs from `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts` ([07 §4](07-docker-ci-cd.md#4-secret-scanning)).
- A live secret is never added to `.gitleaksignore`; the U1 credential is the only accepted exception. Any other finding is rotated first; if it already reached the pushed history, its commit-qualified fingerprint is then added with a dated comment that names the rotation, in a commit the security-reviewer approves, which also updates the pinned list. A new finding in the v1 history (commits before L00), for example after a gitleaks upgrade or a rule change, goes to the user as a follow-up of U1 and needs a new dated user decision; so does re-recording the two U1 findings after a rule rename.

### Windows development machine

- Node 26.13.0. Docker Desktop is required for database work from F04 (`pnpm test` stays Docker-free).
- `pnpm` on `PATH` is broken on this machine; `docs/dev/windows.md` gives `npx --yes pnpm@12.16.1 <command>` as the fallback. The permanent fix is optional user action U7.
- The repository path contains spaces and a dot. Everything works from it except local native Android builds (CMake); before the first development build (N02) the repository moves to a short path without spaces (U8). `git config --global core.longpaths true` is part of the setup.
- Node refuses to spawn `.cmd` shims without a shell, and a shell breaks on the spaces: scripts spawn CLIs as `process.execPath` with the resolved JS entry (`createRequire(import.meta.url).resolve('prisma/build/index.js')`).

## 3. Shared packages

| Package | Kind | Consumers | Content |
|---|---|---|---|
| `@medibooker/tsconfig` | JSON presets | all | §2 |
| `@medibooker/eslint-config` | plain ESM, no build | all | §2 |
| `@medibooker/i18n` | built with `tsc` (`library.json`), plus `./locales.json` | web, mobile, api (from A02) | ICU catalogues `src/messages/<locale>.json`, generated `src/generated/catalog.ts`, `locales.json`, `getDirection`, `negotiateLocale`, `toFormattingLocale`, `isolateLtr`, named formats ([05](05-errors-i18n-tokens.md)) |
| `@medibooker/design-tokens` | built with `tsc`, plus `./tokens.css` | web, mobile, api (e-mails, from A02) | DTCG token files, generated `css/tokens.css` and `src/generated/tokens.ts`, `createColorTheme`, `contrastRatio`, motion tokens, later `generateBrandScale` (M01) ([05](05-errors-i18n-tokens.md)) |
| `@medibooker/api-client` | source package (`exports` point at `.ts`), no build | web, mobile | Orval output (hooks, models, zod, MSW mocks), `apiFetch`, `ApiError`, `createQueryClient`, `createTestQueryClient` ([05](05-errors-i18n-tokens.md)) |

- The API needs plain JavaScript at run time, so packages it imports are built with `tsc`. The api-client is consumed only by bundlers (Next `transpilePackages`, Metro, Vitest, Jest), so it ships source.
- Config files (`app.config.ts`, `metro.config.js`, `next.config.ts`, `jest.config.js`) never import workspace build output: a fresh clone and an EAS worker have no `dist/`. They import committed JSON such as `@medibooker/i18n/locales.json`.
- `@medibooker/db-migrate` is an app, not a shared package: the command-line tool of the migrate image. Its `exports` add `./testing` (`provisionPractice`, `dropPractice`, `seedPracticeFixture(practice, data)`, `loadWorkspaceEnv()`), covered by an API integration test. It is a devDependency of the API (seed, integration harness; F04) and of the web (e2e fixtures; P06), which then need no raw SQL and no direct `pg` dependency of their own ([02 §6](02-api.md#6-database-lifecycle-provisioning-migrations-and-operations)).

Deliberately not packages:

- `validation`: request schemas come from OpenAPI (`@medibooker/api-client/zod`). Create it only for a rule OpenAPI cannot express, for example per-market insurance validators.
- `ui`: components stay per platform (CLAUDE.md; shadcn/ui on the web, ADR 0007).
- `config`: each app validates its own environment.
- `database`: the Prisma schemas, migrations and generated clients stay in `apps/api`, the only runtime consumer.

## 4. Conventions

### Clean code

- **Domain language:** the glossary terms of `medibooker-domain` (Practice, Slot, Appointment, StaffMember, Membership). Never the v1 names.
- **Structure:** business rules are pure functions in `*.rules.ts` with BR ids in comments and exhaustive unit tests; services orchestrate rules, transactions, events and audit; controllers only route, guard and document.
- **Explicit over clever:** explicit request and response DTOs, explicit mappers built with `satisfies`, explicit practice scope (`@PracticeScoped`), `@Public()` only with a reason comment. Never return a Prisma row or spread a request body.
- **Types:** no `any` (use `unknown` and narrow); non-null `!` only for DTO fields; exhaustive `switch`; `satisfies` for configuration; booleans named `is…`, `has…`, `can…`.
- **Time:** no system clock in domain code (lint); instants are UTC on the wire; wall-clock values only together with the practice's IANA zone (ADR 0014).
- **Database:** if PostgreSQL can enforce a rule, it must, and an integration test proves it. Every new column carries its data class (`/// class: public|personal|health|secret`). The practice schema has no `practice_id`; a value that must be unique across practices (slugs) lives in the platform schema (ADR 0005).
- **Comments:** explain why. No commented-out code; no TODO without an issue link.

### Naming

| Kind | Rule |
|---|---|
| Files | kebab-case, except framework files (`page.tsx`, `_layout.tsx`, `[slug]`) |
| Nest classes | `*Module`, `*Controller`, `*Service`, `*Reader`, `*Dto`, `*ResponseDto`, `*Guard`, `*Interceptor`, `*Filter` |
| React | components PascalCase with Figma names; hooks `useX` in `use-x.ts`; shadcn components keep the CLI's file names in `components/ui` |
| Constants, error codes, enum values | UPPER_SNAKE |
| Events | `entity.past_tense` (`appointment.booked`) |
| operationId | the controller method name, verb + noun: `getPublicPractice` → `useGetPublicPractice` |
| i18n keys | `feature.screen.element`; `errors.<CODE>`, `validation.<CODE>` |
| Database objects | tables snake_case plural, columns snake_case (`@@map`/`@map`); Prisma models PascalCase singular |
| Databases and roles | `medibooker_platform`; `practice_<id32>` with the roles `practice_<id32>_app` and `practice_<id32>_owner` (`<id32>` = the practice UUID without hyphens); cluster roles `platform_owner`, `platform_app`, `medibooker_provisioner`; no group role for practices (ADR 0005 §4.1) |
| HTTP | `/api/v1`, plural kebab-case paths, action sub-resources (`/appointments/{id}/cancel`); practice-scoped paths under `/practices/{practiceId}`, public ones under `/public/practices/{slug}` (ADR 0005) |
| Environment variables | UPPER_SNAKE; mobile exposes only `EXPO_PUBLIC_*`; the web uses no `NEXT_PUBLIC_*` |

### Folders

| App | Features | Shared code |
|---|---|---|
| api | `src/modules/<feature>/` | `src/common/<concern>/`; tests next to the code plus `test/{e2e,integration,support}` |
| db-migrate | `src/commands/<command>.ts` | `src/lib/`; tests next to the code, integration tests in `apps/api/test/integration/tenancy` |
| web | `src/features/<feature>/{components,hooks,schemas.ts,index.ts}` | `src/components/ui` (shadcn), `src/lib`; route files stay thin |
| mobile | `src/features/<feature>/` | `src/components/ui`, `src/lib`, `src/theme`; `app/` routes stay thin |

Features import each other only through their `index.ts`.

### Imports (lint-enforced where possible)

- Packages only by name and `exports`: no `../../packages/…`, no `@medibooker/x/src/…`.
- API: relative imports with `.js`. db-migrate and the root scripts: relative imports with `.ts` (type stripping). Web and mobile: the `@/` alias.
- `import type` for types; classes injected by Nest stay value imports (decorator metadata).
- No import cycles. No default exports except framework and config files. No barrels inside apps except a feature's `index.ts`.
- Web modules that read server environment or call the internal API start with `import 'server-only'`.

### Commits

- One roadmap item is one commit; the main agent commits and pushes to `v2-planning`.
- Header: Conventional Commits, `type(scope): imperative subject`, at most 72 characters, no final period (enforced by the `commit-msg` hook).
- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`. The hook accepts any lowercase kebab-case scope; the conventional scopes are `repo`, `ci`, `docker`, `api`, `db-migrate`, `web`, `mobile`, `contract`, `api-client`, `i18n`, `design-tokens`, `adr`, `auth`, `practice`, `staff`, `scheduling`, `appointments`, `notifications`, `records`, `family`, `realtime`, `privacy`, `deploy`.
- Body: why, BR ids, ADR references, `Refs: <roadmap id>` and the verification commands that ran.
- Author: the user only. No co-author or tool attribution trailers (no `Co-Authored-By` for an AI assistant, no "Generated with" line), in commits and in pull requests.
- Never commit `.env`, `dist`, `.next`, the generated Prisma clients or real data.

### What not to abstract (yet)

- No generic layers: no BaseRepository, BaseService or BaseController, no CRUD generators, CQRS, mediator, event sourcing, message broker or microservices.
- No repository class for simple Prisma calls (use the transaction host in the service) and no interface for a single implementation. Exceptions: `Clock`, `SecretStore` and adapters at real external boundaries (mailer, SMS, push, object storage, virus scanner).
- No custom infrastructure beyond the tenancy layer that ADR 0005 requires: `@nestjs/event-emitter` behind one `DomainEvents` service, nestjs-pino configuration instead of a logger wrapper, the Orval mutator as the only HTTP client, TanStack Query plus React state and URL parameters as the only client state.
- No speculative packages (`ui`, `validation`, `config`, `database`, `utils`) and no speculative tooling (feature-flag framework, Storybook, typed routes, boundaries plugin, tsdown, job queue service). The shadcn component overview page replaces Storybook (X07).

## 5. Versions

"Latest" means the newest stable release that is older than pnpm's `minimumReleaseAge` of one day at the moment a package is added (ADR 0006). Packages are added with `pnpm add <pkg>` without a version, so pnpm picks that release; Renovate later moves pins after its own three-day age. The table was checked against the npm registry, Docker Hub and GitHub releases on 2026-11-02; every deviation has its reason. ADR 0006 holds the authoritative table for the F01 catalog.

| Package or tool | Chosen | Newest on 2026-11-02 | Deviation and reason |
|---|---|---|---|
| Node.js | 26.13.0 (`.node-version`, CI, Docker); engines `^26.13.0` | 26.13.0 | — |
| pnpm · turbo | 12.16.1 · 2.11.10 | same | — |
| typescript | 6.0.3 | 7.0.2 | typescript-eslint 8.72.1 peer `>=4.8.4 <6.1.0`; @nestjs/cli 12.0.11 bundles `~6.0.2`; @nestjs/swagger 12.1.0 peer `^5.5.0 \|\| ^6.0.0`. Moves when all three allow 7 |
| @types/node | 26.6.6 | same | — (grouped with Node in Renovate, `<27`) |
| eslint · @eslint/js · typescript-eslint · eslint-config-prettier | 10.14.0 · 10.0.1 · 8.72.1 · 10.1.8 | same | — |
| eslint-plugin-import-x · eslint-import-resolver-typescript · @vitest/eslint-plugin · globals | 4.17.1 · 4.4.5 · 1.6.28 · 17.14.0 | same | — |
| eslint-plugin-jest (F07) | 29.17.0 | same | — |
| prettier · prettier-plugin-tailwindcss (X07) · lefthook | 3.9.10 · 0.8.1 · 2.2.2 | same | lefthook 2.2.2 was published without provenance; checked in ADR 0006 (decision 3) |
| gitleaks · actionlint | 8.30.1 · 1.7.12 | same | — |
| @nestjs/common · core · platform-express · testing | 12.3.2 | same | — |
| @nestjs/cli · @nestjs/throttler | 12.0.11 · 6.7.1 | same | — |
| @nestjs/swagger | 12.0.5 | 12.1.0 | 12.1.0 was published on 2026-11-02, inside the one-day gate; X02 takes the newest version past the gate |
| @nestjs/event-emitter · @nestjs/schedule (P04) | 12.0.1 · 12.0.2 | same | — |
| @nestjs/config | not used | 12.0.1 | The environment is parsed once and passed to `AppModule.forRoot(env)`, so tests can pass their own ([02](02-api.md)) |
| nestjs-pino · pino · pino-http · pino-pretty (dev) | 5.3.1 · 10.4.0 · 11.0.0 · 13.2.0 | same | — |
| nestjs-cls · @nestjs-cls/transactional · …-adapter-prisma | 7.0.2 · 4.0.2 · 2.0.2 | same | — (the adapter's `prisma` peer is made optional, §2; the practice connection uses a custom adapter, 02 §5) |
| class-validator · class-transformer · reflect-metadata · rxjs · helmet · zod | 0.15.1 · 0.5.1 · 0.2.2 · 7.8.2 · 8.3.0 · 4.6.7 | same | — |
| prisma (CLI) | 7.10.1 | dist-tag `latest` = 8.0.0-rc.29 | The tag points to a release candidate; the CLI must equal @prisma/client |
| @prisma/client · @prisma/adapter-pg · pg · @types/pg | 7.10.1 · 7.10.1 · 8.23.1 · 8.23.1 | same | — (`pg` and `@types/pg` also in db-migrate) |
| tsx (seed only) · @swc/core · @swc/cli · unplugin-swc | 4.23.15 · 1.16.21 · 0.8.2 · 2.0.0 | same | — |
| supertest · testcontainers · @testcontainers/postgresql · @faker-js/faker | 7.3.1 · 12.2.1 · 12.2.1 · 10.6.0 | same | — |
| argon2 (A01) | 0.45.1 | same | — |
| orval · msw (Vitest only) | 8.46.0 · 3.0.3 | same | — |
| style-dictionary · culori (M01) · @formatjs/icu-messageformat-parser | 5.7.1 · 4.0.2 · 3.5.22 | same | — |
| next | 16.4.3 | 16.4.4 | 16.4.4 was published on 2026-11-02; F06 takes the newest version past the gate |
| react · react-dom | 19.3.0 | 19.3.1 | Expo SDK 58.0.22 pins 19.3.0; one React copy across web, mobile and the shared hook package (pnpm `overrides`, F07) |
| @types/react · @types/react-dom · babel-plugin-react-compiler · server-only | 19.3.0 · 19.3.0 · 1.0.0 · 0.0.1 | same | — |
| tailwindcss · @tailwindcss/postcss | 4.3.3 | same | — |
| shadcn (CLI, an exact-pinned devDependency of `apps/web` from X07) | 4.23.0 | same | — (ADR 0007; run through `pnpm --filter @medibooker/web exec shadcn`, so the release-age gate and the lockfile apply) |
| react-aria-components · @internationalized/date | 1.22.1 · 3.12.4 | same | — |
| class-variance-authority · clsx · tailwind-merge · tw-animate-css | 0.7.1 · 2.1.1 · 3.7.0 · 1.4.0 | same | — (added by the shadcn CLI) |
| sonner · lucide-react | 2.0.8 · 1.66.0 | same | — (sonner's runtime stylesheet needs a CSP hash, [03](03-web.md)) |
| gsap · @gsap/react | 3.15.0 · 2.1.2 | same | — (ADR 0008) |
| react-hook-form · @hookform/resolvers | 7.91.0 · 7.0.1 | same | — |
| @tanstack/react-query | 5.105.1 | 5.105.2 | 5.105.2 was published on 2026-11-02; X03 takes the newest version past the gate |
| next-intl · use-intl | 4.14.9 | same | — (option B of decision D1) |
| i18next · react-i18next · i18next-icu | 26.6.0 · 17.1.10 · 2.6.1 | 26.7.1 · 17.1.11 · 2.6.1 | Option A of D1; the two newer versions were published within the last day |
| @fontsource-variable/inter · /noto-sans-arabic | 5.3.0 | same | — |
| vitest · @vitest/coverage-v8 · vite | 5.1.0 · 5.1.0 · 8.3.5 | same | — (5.1.0 since the F01 re-check of 2026-11-04, ADR 0006) |
| @vitejs/plugin-react | 6.1.2 | 6.2.1 | 6.2.1 was published on 2026-11-02 |
| @rolldown/plugin-babel · @babel/core (web tests) | 0.2.4 · 7.29.7 | 0.3.0 · 8.1.0 | plugin-react 6.1.2 accepts plugin-babel `^0.1.7 \|\| ^0.2.0`; babel-plugin-react-compiler 1.0.0 is built on Babel 7. Used only so Vitest runs the same Babel React Compiler as `next build` |
| @testing-library/react · jest-dom · user-event · jsdom | 16.3.3 · 7.0.1 · 14.6.8 · 30.1.3 | same | — |
| @playwright/test · @axe-core/playwright | 1.64.1 · 4.14.0 | same | — |
| expo · react-native · expo-router | ~58.0.22 · 0.88.1 · ~58.0.29 | SDK pins | — (`npx expo install`; Renovate needs dashboard approval) |
| expo-localization · expo-font · expo-secure-store · expo-build-properties | ~58.0.5 · ~58.0.11 · ~58.0.2 · ~58.0.12 | SDK pins | — |
| react-native-reanimated · react-native-worklets | 4.7.1 · 0.13.0 | SDK pins | — (ADR 0008) |
| react-native-screens · safe-area-context · svg · @react-native-community/netinfo | ~4.30.1 · ~5.10.1 · 15.16.0 · 12.0.1 | SDK pins | — |
| @react-native-async-storage/async-storage | 2.2.0 | 3.1.1 | Expo SDK 58 pins 2.2.0; the SDK's version wins |
| expo-updates | not installed | ~58.0.20 (SDK pin) | Not added until the DPO approves EAS Update or an in-region update server exists; the RTL reload uses `reloadAppAsync()` from `expo` ([04](04-mobile.md)) |
| lucide-react-native · @expo-google-fonts/inter · /noto-sans-arabic | 1.66.0 · 0.4.2 · 0.4.3 | same | — |
| jest · jest-expo · @testing-library/react-native | 30.5.2 · ~58.0.13 · 14.1.0 | same | — |
| test-renderer | 1.3.0 | 1.3.1 | jest-expo 58.0.13 depends on exactly 1.3.0; one renderer copy |
| Docker images | node:26.13.0-trixie-slim · postgres:18.6-trixie · caddy:2.11.7-alpine · axllent/mailpit:v1.33.0 | same | Pinned by digest; PostgreSQL 19 is a release candidate |
| PostgreSQL client tools (OPS02) | `postgresql-client-18` from the PGDG repository (`trixie-pgdg`) | Debian trixie ships 17 | `pg_dump` 17 refuses a PostgreSQL 18 server; the migrate image checks `pg_dump --version`, and a Renovate custom manager moves the pin ([07 §1](07-docker-ci-cd.md#1-images)) |
| PgBouncer | not used yet | — | Chosen in OPS01 if the connection budget requires it (ADR 0005 §2.4) |
| GitHub runner | `ubuntu-26.04` | `ubuntu-latest` is still 24.04 | Newest available image; `ubuntu-24.04` is the documented fallback if a tool breaks |
| actions/checkout · setup-node · pnpm/action-setup · cache · upload-artifact | v7.0.1 · v7.1.0 · v6.1.0 · v6.1.0 · v7.0.2 | same | Pinned to commit SHAs |
| docker/setup-buildx-action · login-action · metadata-action · bake-action | v4.4.1 · v4.7.0 · v6.2.0 · v7.5.0 | same | — |
| aquasecurity/trivy-action with Trivy | v0.36.0 with `version: v0.76.1` | Trivy v0.76.1 | The action defaults to Trivy v0.70.0, so the version is set explicitly |
| github/codeql-action · dependency-review-action · attest-build-provenance · spdx-dependency-submission-action | v4.39.1 · v5.0.0 · v4.2.2 · v0.4.0 | same | — |
| reactivecircus/android-emulator-runner · Maestro CLI (X10) | v2.38.0 · newest past one day | Maestro cli-2.12.1 was published on 2026-11-02 | — |
