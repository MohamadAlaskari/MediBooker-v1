# Repository and tooling

The repository root is the v2 monorepo. The F01 scaffold in the working tree is the source of truth for everything marked F01, and [ADR 0006](../adr/0006-toolchain-and-version-policy.md) records its decisions; later items extend it and never redo it ([08-roadmap.md](08-roadmap.md)).

## 1. Repository layout

```text
MediBooker-v1/                         v2 monorepo; v1, removed on 2026-11-02 (L00), is in the git history
├─ .github/                            F02: actions/setup and actions/gitleaks (composite actions), workflows/ci.yml, codeql.yml and scheduled.yml, actionlint.yaml, pull_request_template.md (07 §3)
├─ apps/
│  ├─ api/                             F03: @medibooker/api, NestJS 12 (02-api.md); F04: the data layer and the Prisma schemas of the platform and practice databases
│  ├─ db-migrate/                      F04: @medibooker/db-migrate, the database lifecycle CLI medibooker-db and ./testing (02 §6); F05: the migrate image
│  ├─ web/                             F06: @medibooker/web, Next.js 16 (03-web.md)
│  └─ mobile/                          F07: @medibooker/mobile, Expo SDK 58 (04-mobile.md)
├─ packages/
│  ├─ tsconfig/                        F01: TypeScript presets with fixture projects
│  ├─ eslint-config/                   F01: ESLint presets and the local guardrail plugin with rule tests
│  ├─ i18n/                            F06 (locales), X04 (ICU catalogues)
│  ├─ api-client/                      X03: generated client, error mapping, query client
│  └─ design-tokens/                   X05: design and motion tokens for web and React Native
├─ infra/local/                        F04: postgres/init/01-cluster.sh · F06: Caddyfile
├─ scripts/                            F01: git-hook scripts with tests (check-commit-msg.ts, check-hooks.ts, run-gitleaks.ts, lib/) · F02: scan-secrets.ts, the CI secret scans (pin, range, history, self-test), with lib/scan-range.ts · F04: check-migrations.ts with lib/migration-rules.ts, lib/migration-tree.ts and lib/sql-statements.ts · X02: check-drift.ts
├─ docs/                               adr/, architecture/, dev/ (F01), product/
├─ compose.yaml · docker-bake.hcl      F04 · F05 (07)
├─ package.json · pnpm-workspace.yaml · pnpm-lock.yaml · turbo.json                  F01
├─ eslint.config.js · tsconfig.json · vitest.config.ts                                F01: lint, typecheck and tests of the root scripts
├─ prettier.config.js · .prettierignore · .editorconfig · .gitattributes · .gitignore · .node-version   F01
├─ lefthook.yml · .gitleaks.toml       F01 · .gitleaksignore: F02, committed and pinned to ACCEPTED_FINGERPRINTS (the two accepted v1 findings in the history, U1)
├─ renovate.json                       F02: Renovate configuration with its custom managers (07 §5)
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
  | `test` · `test:root` | `turbo run test test:root` · `vitest run --coverage` (the tests of `scripts/`; the coverage gate of `scripts/lib` since F02) |
  | `format` · `format:check` | `prettier --write .` · `prettier --check .` |
  | `verify` | `node scripts/check-hooks.ts && node scripts/run-gitleaks.ts && prettier --check . && pnpm dedupe --check && node scripts/check-migrations.ts && turbo run lint lint:root typecheck typecheck:root test test:root build` (`build` since F03, `pnpm dedupe --check` since F02, `scripts/check-migrations.ts` since F04) |

- `verify` starts with `scripts/check-hooks.ts` (`lefthook check-install`): it fails with an install hint when the git hooks are missing or out of date, because a commit would then skip the secret scan and the commit-message check. `LEFTHOOK=0` or `false` switches the hooks off; with `CI=true` as well (CI sets both and has no hooks) the script skips the check, because lefthook's own `check-install` ignores that switch and fails on a checkout without hooks. On any other machine the switch fails the check, because commits would skip the secret scan (ADR 0006, decision 9). The staged secret scan follows, so `verify` runs after `git add`. `pnpm dedupe --check` runs before Turbo, as in CI's `quality`, so a lockfile that CI would reject fails before the commit.
- Every lint script, in the root and in each package, runs ESLint with `--max-warnings=0`: a warning fails like an error.
- Scripts added by later items: `build` and `dev` (F03); `test:integration`, `db:up`, `db:migrate`, `db:seed`, `db:reset` and `check:migrations` (F04, below); `test:e2e` (F06); `generate` and `check:drift` (X02). From F03 on, `verify` also runs `build`: the tests compile through `unplugin-swc`, so only the build compiles through `nest-cli.json`, whose `ignore` entry keeps spec files out of `dist`, and catches a broken one before CI. From F04 on it runs `node scripts/check-migrations.ts` after `pnpm dedupe --check`, and from X02 on `check:drift`.
- The F04 scripts as built:

  | Script | Command |
  |---|---|
  | `db:up` | `docker compose up -d --wait db`: the compose database, healthy over TCP ([07 §2](07-docker-ci-cd.md#2-compose-for-local-development)) |
  | `db:migrate` · `db:reset` | `turbo run db:migrate` · `turbo run db:reset`: `@medibooker/db-migrate` runs `node src/cli.ts migrate all` · `node src/cli.ts reset-local` |
  | `db:seed` | `turbo run db:seed`: the API's `tsx prisma/seed.ts`, after `db:generate` |
  | `test:integration` | `turbo run test:integration`: the API's `vitest run --project integration`, after `db:generate`; needs Docker |
  | `check:migrations` | `node scripts/check-migrations.ts` ([02 §9](02-api.md#authoring-migrations)) |
- Root `devDependencies` serve the root scripts and configs: `@medibooker/eslint-config`, `@medibooker/tsconfig` (`workspace:*`), `@types/node`, `@vitest/coverage-v8` (F02), `eslint`, `lefthook`, `prettier`, `turbo`, `typescript`, `vite`, `vitest`, `yaml` (F02, for `scripts/ci-config.test.ts`) (`catalog:`). Every package declares the tools its own scripts call (`typescript`, `vitest`, `@nestjs/cli`, …), so filtered installs in Docker work (07).

### pnpm-workspace.yaml

As built in F01, with the `allowBuilds` entries of F03 and F04 and F04's trust exclusion:

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
  - prisma@7.10.1          # F04, with a dated comment
catalog: { … }             # one exact version per shared dependency
allowBuilds:
  lefthook: true
  '@swc/core': false       # F03, with a dated comment: denied on purpose
  '@prisma/engines': true  # F04: downloads the schema engine that prisma migrate spawns
  prisma: false            # F04: denied, as are the four below, each with a dated comment
  esbuild: false
  protobufjs: false
  ssh2: false
  cpu-features: false
```

Added by later items, each with a reason in the commit body:

| Setting | Item | Content |
|---|---|---|
| `allowBuilds` entries | per item | `'@swc/core': false` (F03: denied, because the optional platform package carries the native binary and SWC works without the script, which would only check the binding and fall back to downloading `@swc/wasm`; without any entry pnpm 12 fails with `ERR_PNPM_IGNORED_BUILDS`, ADR 0006 decision 3); F04: `'@prisma/engines': true`, and `prisma`, `esbuild` (through tsx), `protobufjs` (through testcontainers), `ssh2` and `cpu-features` (through testcontainers) denied, with the reasons of ADR 0006 decision 3; `argon2` (A01); others only after review of the install report |
| `trustPolicyExclude` | F04 | `prisma@7.10.1` with a dated comment: the CLI's 7.10.x releases were published without the provenance of 7.9.1 (ADR 0006, decision 3) |
| `packageExtensions` | F05 | Marks the `prisma` peer of `@nestjs-cls/transactional-adapter-prisma` as optional, so `pnpm deploy --prod` leaves the Prisma CLI out of the API image |
| `overrides` | F07 | Pins `react`, `react-dom`, `@types/react`, `@types/react-dom` to the catalog version, so no package can install a second React |

`minimumReleaseAgeExclude` is used only for an urgent security fix: an exact `pkg@x.y.z` entry with a dated comment, removed once that version is older than the gate.

### turbo.json

- As built in F01: `globalDependencies` `.node-version` and `pnpm-workspace.yaml`; `globalEnv` `CI` and `NODE_ENV`; strict environment mode (Turborepo 2's default), so a task sees only the variables it declares.
- Tasks `build` (`^build`, outputs `dist/**`), `lint` and `typecheck` (`^build`), `test` (`^build`, outputs `coverage/**` since F03, which turned coverage on in the API, and `reports/**` since F02: every Vitest config writes its JUnit report to `reports/junit.xml`, so a cached run restores it for CI, [06 §9](06-testing.md#9-flaky-tests-and-silent-green)).
- No package overrides the `test` outputs. F03 had added `packages/eslint-config/turbo.json` with `outputs: []`, because that package's tests write no coverage and Turborepo 2.11.10 prints "no output files found" for a task whose declared outputs are all missing; F02 removed it, since the package's tests now write `reports/junit.xml`, and the warning is gone.
- `apps/api/turbo.json` (`extends: ["//"]`, F03) sets the inputs of the API's `test` task to `["$TURBO_DEFAULT$", "$TURBO_ROOT$/.env.example"]`: `src/config/env-example.spec.ts` reads the root `.env.example`, so a change to that file alone must rerun the test instead of replaying the cache. Since F04 the same file defines the API's `db:generate` task (inputs: both schemas, both migration folders, both Prisma configs and `scripts/write-schema-versions.ts`; outputs `src/generated/**`) and makes `build`, `lint`, `typecheck`, `test`, `dev`, `test:integration` and `db:seed` depend on it.
- The root tasks `//#lint:root`, `//#typecheck:root` and `//#test:root` list their `inputs` explicitly (the scripts, the root configs and `pnpm-lock.yaml`; `//#lint:root` also the eslint-config sources), so they stay cacheable. `//#test:root` also reads `.gitleaks.toml`, `.gitleaksignore` (since F02), `lefthook.yml`, `.github/**`, `renovate.json`, `docs/dev/getting-started.md` (F02) and `apps/api/test/integration/support/postgres-image.ts` (F04; `scripts/ci-config.test.ts` reads them), which its tests use, outputs `coverage/**` and `reports/**` (F02), and declares `env: ["GITLEAKS_VERSION"]`: CI's gitleaks action exports the version of the gitleaks it installs, so a gitleaks upgrade reruns the rule test.
- Added later:

  | Task | Item | Rule |
  |---|---|---|
  | `dev` | F03 (built) | `persistent: true`, `cache: false`; the API reads the root `.env` itself, so no pass-through: under `pnpm dev` only the root `.env`, `CI` and `NODE_ENV` reach the API, and a shell override needs a direct run (`pnpm --filter @medibooker/api dev`); i18n and design-tokens run `tsc -b -w` next to the apps (X04, X05) |
  | `db:generate` | F04 (built) | root: `outputs: ["src/generated/**"]`, no `env`, so `prisma generate` runs without any database variable (CI `quality` proves it); `apps/api/turbo.json` adds its inputs and makes `build`, `lint`, `typecheck`, `test`, `dev`, `test:integration` and `db:seed` depend on it |
  | `test:integration` | F04 (built) | no cache; `passThroughEnv: ["DOCKER_*", "TESTCONTAINERS_*"]` |
  | `db:migrate`, `db:seed`, `db:reset` | F04 (built) | no cache; `passThroughEnv`: `PLATFORM_DATABASE_URL`, `PLATFORM_MIGRATION_URL`, `PRACTICE_MIGRATION_URL`, `SHADOW_DATABASE_URL`, `PROVISIONER_DATABASE_URL`, `DATABASE_ADMIN_URL`, `DATABASE_CLUSTER_ENDPOINTS`, `SECRET_STORE`, `DEV_SECRET_SEED`, `APP_ENV`, `MARKETS`, `MIGRATION_*`, `PRACTICE_APP_CONNECTION_LIMIT` and `PRACTICE_OWNER_CONNECTION_LIMIT`, for values set in the shell; locally the tools read the root `.env` themselves ([07 §2](07-docker-ci-cd.md#2-compose-for-local-development)); `db:seed` depends on `db:generate` |
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

- **api:** extends `nest.json` and sets `lib: ["es2025", "esnext.temporal"]` and `useDefineForClassFields: false`, and since F04 `allowImportingTsExtensions`. The emit target stays `es2024` because `unplugin-swc` copies `target` into SWC and @swc/core 1.16.21 rejects `es2025`; Node 26 runs ES2025 either way. One tsconfig covers `src`, `test`, `prisma`, `scripts`, both Prisma configs and `vitest.config.ts`; it is `noEmit` (`nest build` compiles with SWC).
- **db-migrate:** extends `node.json` with `allowImportingTsExtensions` and `erasableSyntaxOnly`, like the root `tsconfig.json`, because Node runs it by type stripping.
- **Consumers of `@medibooker/db-migrate/testing`:** the API's tsconfig (F04) and the web's e2e tsconfig (P06) set `allowImportingTsExtensions`, which `noEmit` allows; without it TypeScript reports TS5097 for db-migrate's `.ts` imports.
- **mobile:** `extends: ["@medibooker/tsconfig/strict.json", "expo/tsconfig.base"]`, in this order, so Expo's `DOM` and `ESNext` libs win.
- **api-client:** extends `strict.json` with bundler resolution and the DOM lib, and uses only fetch types that React Native also declares (`RequestInit`, `Response`, `AbortSignal`, not `HeadersInit`).

### ESLint presets and guardrails (`@medibooker/eslint-config`)

Flat-config presets exported from `.`: `base({ tsconfigRootDir })`, `nest()`, `react()`, `vitest()`, plus the local `plugin`. Every package has its own `eslint.config.js`, because ESLint 10 looks up the config from each linted file's directory.

The local `medibooker` plugin has six rules: three guardrails (F01) and three logging rules (F02):

| Rule | Guards |
|---|---|
| `medibooker/no-hex-colors` | No hex colour literals in UI code (non-negotiable 7) |
| `medibooker/no-physical-direction-classes` | No `ml-*`, `pr-*`, `left-*`, `text-left`, `border-l`, … in class strings and in `cn`, `clsx`, `cva`, `twMerge`, `twJoin`, `tv` arguments; names the logical replacement (RTL). The centring idiom (`left-1/2` or `right-1/2` with a horizontal translate in the same class list) stays allowed, because translate does not mirror |
| `medibooker/no-system-clock` | No `new Date()`, `Date()`, `Date.now`, `Temporal.Now` in `src/modules/**` of the API; inject the `Clock` |
| `medibooker/no-dynamic-log-message` | The message argument of a logger call (`log`, `info`, `warn`, `error`, `debug`, `verbose`, `fatal`, `trace`) is a string literal or a template literal without expressions, and no argument reads `.message` or `.stack` ([02 §8](02-api.md#8-logging-and-redaction)). Type information finds the message: Nest's `Logger` takes it first, pino and nestjs-pino's `PinoLogger` take an optional object first; a method without a `message` or `msg` parameter, such as `Math.log`, is no logger |
| `medibooker/require-logger-class-name` | `new Logger(…)` from `@nestjs/common` takes `<Class>.name` of a class that the file declares or imports, never no argument or another value, and Nest's static `Logger.log(…)` methods are not used: without a context of its own, a Nest `Logger` logs its last argument as the context (02 §8) |
| `medibooker/no-log-bindings` | No `.child(`, `.setBindings(`, logger `.assign(` (nestjs-pino's `PinoLogger.assign`; `Object.assign` stays allowed), `runInContext(` or the `msgPrefix` option: bindings skip the log-field allowlist (02 §8) |

- `base` adds type-aware typescript-eslint (`strictTypeChecked`, `stylisticTypeChecked`), `consistent-type-imports`, `switch-exhaustiveness-check`, import hygiene (`no-duplicates`, `no-self-import`), `eqeqeq`, `no-console`, `reportUnusedDisableDirectives: 'error'` (an `eslint-disable` comment that suppresses nothing fails lint) and Prettier last.
- `nest` adds `import-x/no-cycle` (an ESM cycle crashes Nest at startup), `no-extraneous-class` with `allowWithDecorator` and the clock rule outside tests, and since F02 the three logging rules: `no-dynamic-log-message` and `require-logger-class-name` in every TypeScript file, tests included, and `no-log-bindings` everywhere except `src/common/logging`, which passes bindings through the allowlist. A test that breaks a rule on purpose (`apps/api/test/support/probe.module.ts`, `src/common/logging/pino-options.spec.ts`) says why in its disable comment. `no-dynamic-log-message` and `no-log-bindings` use the TypeScript program of `base`'s project service and throw when a file has none, so a misconfigured rule fails lint instead of passing every file.
- `react` adds the colour and direction guardrails, except in tests. `vitest` makes `.only` and `.skip` errors.
- Rule tests and preset tests on real fixture files prove every guardrail fires.
- Every Vitest config sets `passWithNoTests: false` and `allowOnly: false`: a run without tests fails, and a focused test (also a RuleTester case with `only: true`) fails every run, not only under `CI`. The root `vitest.config.ts` runs only `scripts/**/*.test.ts`; each package runs its own tests.

Per app:

| App | Composition | App-level additions |
|---|---|---|
| api | `base` + `nest` + `vitest` | F04: `no-system-clock` also in `src/common/tenancy` (outside specs), and `process.env` only in `src/main.ts` (`no-restricted-properties`); `no-restricted-imports` of `@nestjs/event-emitter` outside `src/common/events` (P04) |
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
- `.gitignore`: dependencies, caches and build output (`node_modules/`, `.turbo/`, `dist/`, `coverage/`, `*.tsbuildinfo`, `.eslintcache`); test reports (`reports/`, and `.vitest/`, where Vitest 5 writes a file reporter without an output file; F02), each anchored to the root, `apps/*` and `packages/*`, so a source folder named `reports` is never ignored; environment files (`.env`, `.env.*`, `*.env`) except `.env.example`; lefthook's local overrides (`lefthook-local.*`, `.lefthook-local.*`), because they can switch a hook off; logs, OS and editor files (`.vscode/` except its shared settings and extension list); keys, certificates and signing material (`*.pem`, `*.key`, `*.p8`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.mobileprovision`), which gitleaks cannot scan; Claude Code's local `.claude/data/` and `.claude/settings.local.json`.
- `lefthook.yml` (lefthook 2.2.2; every command calls `node` directly, so the hooks work in Git's `sh` on Windows; arguments are single-quoted):
  - `assert_lefthook_installed: true`: a generated hook that cannot find lefthook, for example after `node_modules` was deleted, blocks the commit instead of letting it through unchecked; `min_version: 2.2.2`: an older lefthook first on `PATH` fails instead of running the hooks;
  - `pre-commit`, in parallel: `prettier --check --ignore-unknown` on the staged files (never rewrites or re-stages) and `node scripts/run-gitleaks.ts`, which first checks the `.gitleaksignore` pin (F02) and then runs `gitleaks git --pre-commit --staged` with the repository policy (`.gitleaks.toml`, `--redact`, `--ignore-gitleaks-allow`) and, since F02, `GIT_ATTR_SOURCE` set to the empty tree, so a `-diff` attribute cannot hide a staged file; it fails closed when the pin check fails, when gitleaks is missing, cannot start or is stopped by a signal, and (F02) when gitleaks logs an error;
  - `commit-msg`: `node scripts/check-commit-msg.ts` enforces Conventional Commits, `<type>(<scope>)!: <summary>` (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`; optional lowercase kebab-case scope; optional `!` for a breaking change), a header of at most 72 characters without a final period, and an empty second line before a body; headers that git writes itself pass.
  - No pre-push hook: the pre-commit scan covers every commit, and CI is the hard gate (ADR 0006, decision 9). CI sets `LEFTHOOK=0`; on a developer machine that switch fails `pnpm verify`.
- `.gitleaks.toml` extends the default rules (`[extend] useDefault = true`) with the rule `medibooker-password-assignment`, because the defaults miss plain password assignments such as `DB_PASSWORD=…` and `password: '…'`:
  - keys ending in `password`, `passwd`, `passphrase`, `pwd` or `secret` (any case, so also `JWT_SECRET`), or `pass` on its own or after `_`, `.` or `-` (`SMTP_PASS`, `auth.pass`; not `bypass`);
  - after `=`, `:`, `:=` or `=>`, a value of at least 8 characters: quoted without whitespace (also the literal fallback in `x ?? '…'` and `x || '…'`), unquoted to the end of the line (env, YAML, ini; it may contain `,` and `;` but not end with them), or the password of a connection URL, also with an empty user name;
  - placeholders are allowed (`changeme`, values containing `example`, `<…>`, `${VAR}`, `${VAR:-}`, `${VAR:?…}`, `$VAR`, `process.env.*`); a shell default with a literal value (`${VAR:-…}`) is reported; a quoted value with spaces is not (translation labels).
- Every gitleaks scan, local and in CI, uses one policy (`policyArguments()` in `scripts/lib/gitleaks.ts`): `.gitleaks.toml`, `--redact` and `--ignore-gitleaks-allow`, so an inline `gitleaks:allow` comment cannot silence a finding, plus `--no-banner` and `--no-color` (F02), so that the scripts can read the errors gitleaks logs without failing. Only a reviewed change to `.gitleaks.toml` or `.gitleaksignore` can silence a finding, and `.gitleaksignore` is pinned to the two accepted fingerprints. CI scans through `scripts/scan-secrets.ts` ([07 §4](07-docker-ci-cd.md#4-secret-scanning)). `scripts/gitleaks-config.test.ts` writes synthetic fixtures (18 that must be reported, one of them with an inline `gitleaks:allow`, and 18 that must not) into a temporary directory at test time and runs the real binary with that policy (skipped locally without gitleaks, failing under `CI=true`), so no scan of the repository sees them and no path allowlist exists.
- `.gitleaksignore` (committed in F02) holds exactly the commit-qualified fingerprints of the two v1 findings in the git history, under a comment dated 2026-11-04: the user declined to rotate that credential and accepted the risk (U1 in [09](09-risks-and-decisions.md)). gitleaks reads the file from the scan root whatever `--gitleaks-ignore-path` says, and a commit-less entry would silence a finding in every commit, so the file is pinned: `scripts/run-gitleaks.ts` (pre-commit hook and `pnpm verify`) and every CI scan (`scripts/scan-secrets.ts`) fail closed when its entries differ from `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts` ([07 §4](07-docker-ci-cd.md#4-secret-scanning)). `node scripts/scan-secrets.ts pin` runs the check on its own.
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
- `@medibooker/db-migrate` is an app, not a shared package: the command-line tool of the migrate image. Its `exports` are `.` (the commands as functions with explicit options, `createPracticeDatabase()`, the `SecretStore` port with the development store, `parseToolEnvironment`, the error codes) and `./testing` (`provisionPractice`, `dropPractice`, `seedPracticeFixture(practice, data)`, `ensurePracticeTemplate`, `PRACTICE_TEMPLATE`, `loadWorkspaceEnv()`), covered by the API's `db-migrate-testing.int-spec.ts`; both point at TypeScript sources. It is a devDependency of the API (seed, integration harness; F04) and of the web (e2e fixtures; P06), which then need no raw SQL and no direct `pg` dependency of their own ([02 §6](02-api.md#6-database-lifecycle-provisioning-migrations-and-operations)).

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

"Latest" means the newest stable release that is older than pnpm's `minimumReleaseAge` of one day at the moment a package is added (ADR 0006). Packages are added with `pnpm add <pkg>` without a version, so pnpm picks that release; Renovate later moves pins after its own three-day age. The table was checked against the npm registry, Docker Hub and GitHub releases on 2026-11-02; every deviation has its reason. The CI rows were re-checked for F02 on 2026-11-05, and the exact pins follow in [CI pins](#ci-pins). The F04 rows (the data layer's packages and the PostgreSQL image) were checked on 2026-11-05, and F04 re-resolved the CI pins the same day. ADR 0006 holds the authoritative table for the catalog.

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
| gitleaks · actionlint | 8.30.1 · 1.7.12 | same (re-checked 2026-11-05) | — (pinned by checksum and digest, [CI pins](#ci-pins)) |
| @nestjs/common · core · platform-express · testing | 12.3.2 | same | — |
| @nestjs/cli · @nestjs/throttler | 12.0.11 · 6.7.1 | same | — |
| chokidar (F03, watch mode of `nest start --watch`) | 5.0.0 | 6.0.0 | @swc/cli 0.8.2 declares it as an optional peer `^5.0.0` (checked 2026-11-04) |
| @nestjs/swagger | 12.0.5 | 12.1.0 | 12.1.0 was published on 2026-11-02, inside the one-day gate; X02 takes the newest version past the gate |
| @nestjs/event-emitter · @nestjs/schedule (P04) | 12.0.1 · 12.0.2 | same | — |
| @nestjs/config | not used | 12.0.1 | The environment is parsed once and passed to `AppModule.forRoot(env)`, so tests can pass their own ([02](02-api.md)) |
| nestjs-pino · pino · pino-http · pino-pretty (dev) | 5.3.1 · 10.4.0 · 11.0.0 · 13.2.0 | same | — |
| nestjs-cls · @nestjs-cls/transactional · …-adapter-prisma | 7.0.2 · 4.0.2 · 2.0.2 | same | — (the adapter's `prisma` peer is made optional, §2; the practice connection uses a custom adapter, 02 §5) |
| class-validator · class-transformer · reflect-metadata · rxjs · helmet · zod | 0.15.1 · 0.5.1 · 0.2.2 · 7.8.2 · 8.3.0 · 4.6.7 | same | — |
| prisma (CLI) | 7.10.1 (2026-10-15) | dist-tag `latest` = 8.0.0-rc.30 (2026-11-03) | The tag points to a release candidate; F04 takes the newest stable release, and the CLI equals @prisma/client (ADR 0006). Node 26 is not on Prisma 7.10.1's list of supported versions (20.19+, 22.12+, 24.0+); every F04 command worked on Node 26.13.0 |
| @prisma/client · @prisma/adapter-pg · pg · @types/pg | 7.10.1 · 7.10.1 · 8.23.1 · 8.23.1 | same (F04: published 2026-10-15, 2026-10-15, 2026-09-30, 2026-08-17) | — (`pg` and `@types/pg` also in db-migrate) |
| tsx (seed only) · @swc/core · @swc/cli · unplugin-swc | 4.23.15 · 1.16.21 · 0.8.2 · 2.0.0 | same | — |
| supertest · testcontainers · @testcontainers/postgresql · @faker-js/faker | 7.3.1 · 12.2.1 · 12.2.1 · 10.6.0 | same (F04: both Testcontainers packages published 2026-10-13) | — |
| @peculiar/x509 (F04, a devDependency of the API) | 3.1.0 | same (published 2026-10-27) | — (the TLS spec generates its CA and server certificate at run time; Node has no API that generates X.509 certificates) |
| argon2 (A01) | 0.45.1 | same | — |
| orval · msw (Vitest only) | 8.46.0 · 3.0.3 | same | — |
| culori (M01) · @formatjs/icu-messageformat-parser | 4.0.2 · 3.5.22 | same | — |
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
| yaml (F02, root devDependency of `scripts/ci-config.test.ts`) | 2.9.1 | same (checked 2026-11-05) | — (published 2026-09-11, no dependencies; no version has provenance, so `trustPolicy` sees no downgrade) |
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
| Docker images | node:26.13.0-trixie-slim · postgres:18.6-trixie · caddy:2.11.7-alpine · axllent/mailpit:v1.33.0 | same (postgres re-checked for F04 on 2026-11-05: 18.6 is the newest 18.x) | Pinned by digest; PostgreSQL 19 is a release candidate. F04 pins `postgres:18.6-trixie@sha256:bd5dfa494a5a259704365813dbfa5fa6b3e69be7348d43b547f540c730478583`, the multi-arch index pushed on 2026-11-05 at 10:14 UTC, in `compose.yaml` and in the Testcontainers constant |
| PostgreSQL client tools (OPS02) | `postgresql-client-18` from the PGDG repository (`trixie-pgdg`) | Debian trixie ships 17 | `pg_dump` 17 refuses a PostgreSQL 18 server; the migrate image checks `pg_dump --version`, and a Renovate custom manager moves the pin ([07 §1](07-docker-ci-cd.md#1-images)) |
| PgBouncer | not used yet | — | Chosen in OPS01 if the connection budget requires it (ADR 0005 §2.4) |
| GitHub runner | `ubuntu-26.04` | generally available since 2026-09-17; `ubuntu-latest` moves from 24.04 to 26.04 until 2026-11-19 | Newest available image; never `ubuntu-latest` while it moves; `ubuntu-24.04` is the documented fallback if a tool breaks. actionlint 1.7.12 needs the label declared in `.github/actionlint.yaml` |
| actions/checkout · setup-node · pnpm/action-setup · cache · upload-artifact | v7.0.1 · v7.1.0 · v6.1.1 · v6.1.0 · v7.0.2 | same (re-checked 2026-11-05 for F02 and again for F04) | Pinned to commit SHAs ([CI pins](#ci-pins)) |
| docker/setup-buildx-action · login-action · metadata-action · bake-action | v4.4.1 · v4.7.0 · v6.2.0 · v7.5.0 | same | — |
| aquasecurity/trivy-action with Trivy | v0.36.0 with `version: v0.76.1` | Trivy v0.76.1 | The action defaults to Trivy v0.70.0, so the version is set explicitly |
| github/codeql-action · dependency-review-action · attest-build-provenance · spdx-dependency-submission-action | v4.39.3 · v5.0.0 · v4.2.2 · v0.4.0 | same (re-checked 2026-11-05 for F04) | codeql-action v4.39.3, published on 2026-11-04 at 16:49:20 UTC, passed the one-day gate on 2026-11-05 at 16:49:20 UTC; F04 moved all four lines from v4.39.2 to it. attest-build-provenance (F05) was not re-checked in F02 or F04 |
| reactivecircus/android-emulator-runner · Maestro CLI (X10) | v2.38.0 · newest past one day | Maestro cli-2.12.1 was published on 2026-11-02 | — |

### CI pins

The pins of F02, checked on 2026-11-05 with `gh api` (release dates) and `git ls-remote` (the commit each tag points to; an annotated tag is peeled to its commit). Each was the newest release past the one-day gate when the workflows were written. F04 re-resolved every pin on 2026-11-05: codeql-action moved to v4.39.3 and the Renovate image to 44.215.0; the rest stayed. The workflow files are the source of truth, and Renovate moves these pins after U4 ([07 §5](07-docker-ci-cd.md#5-supply-chain)).

| Pin | Version | Pinned to | Published |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-07-20 |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | 2026-10-08 |
| `pnpm/action-setup` | v6.1.1 | `73e46992e05b19abd31f2f3c20e0e7370d762115` (the annotated tag `9bbca1e9…`, peeled) | 2026-11-03 |
| `actions/cache/restore`, `actions/cache/save` | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | 2026-06-26 |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | 2026-10-07 |
| `github/codeql-action` (`init`, `analyze`, `upload-sarif`) | v4.39.3 | `33d7b85da1a04171e211befe2c739303b9a4c066` (the annotated tag `f3bbb056…`, peeled) | 2026-11-04T16:49:20Z, past the gate on 2026-11-05 at 16:49:20 UTC; F04 moved the two lines of `ci.yml` and the two of `codeql.yml` from v4.39.2 (`1fc58d04a4d4374f921bdac573c3811c240f9c26`) |
| `advanced-security/spdx-dependency-submission-action` | v0.4.0 | `b009efcf8b9d562a4569d2028c276522232e631f` (not the floating `v0`, which points to v0.3.2) | 2026-09-15 |
| `actions/dependency-review-action` | v5.0.0 | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` | 2026-05-08 |
| gitleaks binary | 8.30.1 | `gitleaks_8.30.1_linux_x64.tar.gz`, SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (the checksums file, a local `sha256sum` and the release's asset digest agree) | 2026-03-21 |
| actionlint image | 1.7.12 | `rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667` | 2026-03-30 |
| Renovate image (`renovate-config-validator`) | 44.215.0 | `ghcr.io/renovatebot/renovate:44.215.0@sha256:10b921ce64cac11667849e7c1c4f0c4996d641f88b949652e69a324622538f7a` (the OCI index) | npm 2026-11-04 15:41 UTC; the newest past the gate when F04 re-resolved the pins (F02: 44.212.0, `sha256:11f3f39f…`; 44.210.2 when `ci.yml` was first written) |
| GitHub runner | `ubuntu-26.04` | GitHub-hosted label | generally available since 2026-09-17 |

- The actionlint and Renovate images are the `ACTIONLINT_IMAGE` and `RENOVATE_IMAGE` lines of `ci.yml`; Renovate's `*_IMAGE` manager moves them, so the developer docs read them from there instead of copying the digests.
- Not used: `docker/login-action` v4.7.0 (`81c6f93d4bc991e510b342a00b419b3bb4efc5c6`, 2026-10-23), because `config-lint` logs in with a `docker login --password-stdin` step; the gitleaks container image, because there are no container steps ([ADR 0009](../adr/0009-ci-branch-model-and-supply-chain.md)).
- pnpm stays 12.16.1 (`packageManager`): 12.17.0 exists only on npm's `next-12` tag, and "latest" is never above npm's `latest` dist-tag (ADR 0006).
