# 0006. Toolchain and version policy
Status: Accepted — 2026-11-01 (stack chosen by the user; the monorepo, database, mobile and data-fetching tools are the Proposed defaults of CLAUDE.md; tool-level choices by the architect)

History: 2026-11-01 accepted with the F01 plan (monorepo skeleton and root tooling) · 2026-11-01 amended after the red-team review of the scaffold: Node 26 only, "latest" defined by pnpm's one-day release-age gate, secret scanning that fails closed with a custom gitleaks rule, focused and disabled tests as lint errors · 2026-11-02 all versions re-checked against the gate; `trustPolicy` probed (decision 3) · 2026-11-04 amended after the F01 reviews (security, architecture, tests, DevOps): `trustPolicy: no-downgrade`, git hooks that fail closed without lefthook, a wider gitleaks rule, inline `gitleaks:allow` comments ignored, lint failing on warnings, focused tests failing every run, the centring exception of the direction guardrail, an accepted audit advisory; Vitest 5.1.0 · 2026-11-04 amended for the v1 removal (L00) and the user's decisions: the guardrail `no-legacy-imports` and the v1 entries of `.gitattributes` and `.prettierignore` removed; U1 declined, so F02 records the two v1 findings as an accepted risk; U3 before F02; U11 resolved, so the Context no longer claims client confirmation for the Proposed toolchain choices · 2026-11-04 amended after the review of the clean-up: `.gitleaksignore` named as the second way to allow a finding, pinned to the two accepted fingerprints from F02; one v1 credential with two findings; the coverage follow-up moved to F03 · 2026-11-04 amended for F03 (the API skeleton): the API's packages in the catalog, `'@swc/core': false` in `allowBuilds`, `coverage/**` as the output of `test` with an override for the eslint-config package, the Turbo `dev` task, the Vitest module cache keyed on the API's `.swcrc`, two build-tool paths of the accepted minimatch advisory · 2026-11-04 amended after the F03 reviews: `pnpm verify` also runs `build`, `apps/api/turbo.json` adds the root `.env.example` to the API's test inputs, chokidar 5.0.0 declared for watch mode (a deviation), and `pnpm dev` documented as reading the root `.env` only · 2026-11-05 amended for F02 (CI, [ADR 0009](0009-ci-branch-model-and-supply-chain.md)): JUnit reports in `reports/` as an output of the test tasks and `packages/eslint-config/turbo.json` removed (decisions 4 and 8), the three logging rules of the `nest()` preset, six plugin rules in all (decision 6), the `.gitleaksignore` pin in place and failing closed in the hook, `pnpm verify` and CI (decision 10), the gitleaks row with the checksum CI verifies, the minimatch advisory below the audit gate, and the F02 follow-ups done, changed or deferred · 2026-11-05 amended after the F02 reviews: coverage gates for `@medibooker/eslint-config` and the repo scripts (decision 8, RT-58), `pnpm dedupe --check` in `pnpm verify` and the hook check honouring `LEFTHOOK=0` only with `CI=true` (decision 9), the staged scan without the repository's `.gitattributes` and staging tests in isolated repositories (decision 10), the lint canary and the supported way to log an error (decision 6), `yaml` 2.9.1 for the CI-configuration test (version table) · 2026-11-05 amended for F04 (the data layer): the Prisma decision with its date (7.10.1, because npm's `latest` is the prerelease 8.0.0-rc.30) and the F04 packages in the version table, six more `allowBuilds` entries and the `prisma@7.10.1` trust exclusion (decision 3), RT-22, RT-46 and RT-68 applied (red-team table).

## Context

- **Stack chosen by the user:** a NestJS 12 API; a Next.js 16 web app (App Router, self-hosted Node container, ADR 0003); a React Native app.
- **Proposed defaults of CLAUDE.md:** pnpm workspaces and Turborepo; PostgreSQL and Prisma; Expo SDK 58 as the mobile toolchain; a generated OpenAPI client with TanStack Query. They are not confirmed. A Proposed choice is the default, so this ADR builds on them, and a decision against one of them amends this ADR (U11, 2026-11-04).
- **The user's rule:** always use the latest released versions. Deviate only when a version is incompatible, and document why.
- **The ecosystem lags behind** (state on 2026-11-04):
  - TypeScript 7.0.2 is npm's `latest`, but typescript-eslint and the NestJS 12 tooling support TypeScript 6 only.
  - Common ESLint plugins (eslint-plugin-react, eslint-plugin-jsx-a11y, eslint-plugin-import) declare no ESLint 10 support, and the Next.js and Expo ESLint configs depend on them.
  - Prisma's `latest` tag points at a release candidate (8.0.0-rc.29).
  - Expo SDK 58 pins React 19.3.0, while React 19.3.1 is out.
- **Supply chain:** malicious package versions are usually found and removed within hours. pnpm 12 therefore installs only versions that are at least one day old (`minimumReleaseAge`, 1440 minutes by default), and it also checks the versions in the lockfile ("Lockfile passes supply-chain policies"). Exact "latest" pins collide with that gate on release day: on 2026-11-01, pnpm could install globals 17.14.0, published that morning, only by writing an exception into `pnpm-workspace.yaml` (RT-67).
- **Secrets:** the history of this public repository contains a real v1 database credential (`MediBooker-ApI/dev.env`, `MediBooker-ApI/config/dbConfig.js`). gitleaks' default rules miss it: a full-history scan reported 0 findings. Agents push straight to `v2-planning`, so a committed secret is public before CI can see it (RT-02).
- **Machines:** development on Windows 11 (a checkout path with spaces and a dot, `core.autocrlf=true`, stale corepack shims that break `pnpm` on `PATH`), CI on Linux.
- **v1 removed:** the user deleted the v1 apps (the Angular client and the Express API) from the working tree on 2026-11-02 (roadmap item L00). v2 shares no code with v1, which remains only in the git history.

## Decision

### 1. Version policy

- **"Latest"** means the newest stable version (no prerelease, not above npm's `latest` dist-tag) that is at least one day old, so it has passed pnpm's release-age gate. Check it with `npm view <pkg> time dist-tags` whenever you add or update a version.
- **The gate is explicit:** `minimumReleaseAge: 1440` in `pnpm-workspace.yaml`. It is pnpm 12's default, written out so nobody mistakes it for an opt-in. It is never set to 0.
- **Exceptions:** `minimumReleaseAgeExclude` is only for urgent security fixes: an exact `pkg@x.y.z` entry with a dated comment, added in the same change as the fix and removed once the version has passed the gate. A version that is merely too new waits a day; it never gets an exception. There is no entry today.
- **Pins:** exact versions in pnpm's default catalog; packages refer to them with `catalog:`. `catalogMode: prefer` and `savePrefix: ''` keep new dependencies exact and in the catalog.
- **Lockfile:** committed. It also pins pnpm itself (`packageManagerDependencies` and the `@pnpm/exe.*` binaries with integrity hashes). It equals a from-scratch resolution under the final policies, so transitive versions are the newest past the gate as well (checked on 2026-11-04).
- **Deviations** appear only in the version table below, each with a reason and an exit condition.
- **Updates:** by hand until Renovate runs: F02 committed `renovate.json`, and the app runs once the user installs it (U4). Renovate waits 3 days (`minimumReleaseAge`), longer than pnpm's gate, so its pull requests never fail the install.

### 2. Runtime

- **Node.js 26.13.0**, the first 26.x LTS release (2026-10-28), is the only supported runtime for development, CI and Docker: `.node-version` is 26.13.0 and `engines.node` is `^26.13.0`. There is no Node 24 matrix: one runtime everywhere keeps local, CI and production results comparable.
- **pnpm 12.16.1** through `packageManager`, installed directly with `npm install -g pnpm@12.16.1`, not through corepack: Node 26 ships no corepack, and pnpm 11's automatic switch to the `packageManager` version fails on Windows. Without administrator rights, `npx --yes pnpm@12.16.1 <command>` works (docs/dev/windows.md).
- **Repo scripts** are TypeScript that Node runs directly (type stripping): erasable syntax only, `.ts` import extensions, `node:` built-ins, no dependencies.

### 3. Workspace (pnpm 12)

- **Members:** `apps/*` and `packages/*` only. The root package is `@medibooker/root`, because pnpm 12 lists the root in `pnpm -r ls` and every listed name must start with `@medibooker/`.
- **pnpm 12 defaults kept:** the isolated `node_modules` layout (a package can only use what it declares) and `strictDepBuilds`. Install scripts run only for packages listed in `allowBuilds`. A new entry needs a reason, and it is `true` only when the package must download or build a native binary. `dangerouslyAllowAllBuilds` is never used. The list has eight entries, each with a dated comment in `pnpm-workspace.yaml`:
  - `lefthook: true`: its postinstall installs the git hooks and skips when `CI` is set.
  - `'@swc/core': false` (F03, 2026-11-04): an explicit denial. Without an entry, `strictDepBuilds` fails the install with `ERR_PNPM_IGNORED_BUILDS`. The script only checks the native binding and would otherwise download `@swc/wasm`; the binding comes from the optional platform package (`@swc/core-win32-x64-msvc`, `@swc/core-linux-x64-gnu`, …), and with the script denied SWC still compiles and emits decorator metadata (the API's smoke spec proves it). `@nestjs/core` 12.3.2 has no install script and is never listed. The F03 install report showed no other unreviewed script.
  - `'@prisma/engines': true` (F04, 2026-11-05): its postinstall downloads the native schema engine that `prisma migrate` spawns (db-migrate, the drift spec, the seed; 07 §1).
  - `prisma: false` (F04): the preinstall only compares the Node version with Prisma's list and prints a warning for Node 26; nothing is built or downloaded.
  - `esbuild: false` (F04, through tsx): the postinstall only validates the binary of the optional `@esbuild/<platform>` package, which pnpm installs, and downloads one only when it is missing; tsx runs without it.
  - `protobufjs: false` (F04, through testcontainers and dockerode): the postinstall only warns about the version scheme of packages that depend on protobufjs; it builds nothing.
  - `ssh2: false` and `cpu-features: false` (F04, through testcontainers): both try node-gyp builds of optional native code (ssh2's crypto binding, cpu-features for it); ssh2 falls back to JavaScript, and testcontainers needs it only for a Docker host reached over SSH. The F04 install report showed no other unreviewed script.
- **Also not set:** `engineStrict`, `pmOnFail` and `nodeLinker`. The defaults are enough; CI enforces the runtime (F02).
- **`trustPolicy: no-downgrade`** (RT-21, turned on after the security review): pnpm refuses a version that was published with less trust than an earlier release of the same package, for example without the provenance its predecessors had. That is a typical sign of a package takeover, and F02 to F05 will add hundreds of packages.
  - The first exclusion, `lefthook@2.2.2` in `trustPolicyExclude`, with a dated comment. The earlier releases we checked (2.1.4 to 2.2.1) were published by GitHub Actions through npm trusted publishing, with SLSA provenance. 2.2.2 was published from the maintainer's own npm account, without provenance.
  - The security review (2026-11-02) accepted 2.2.2. Its `postinstall.js`, `bin/index.js` and `get-exe.js` are byte-identical to 2.2.1; only the version and the list of platform packages changed. The GitHub release v2.2.2 and the ten existing platform binary packages came from the normal GitHub Actions pipeline, with provenance. Only the new `lefthook-android-arm64`, which installs on Android only, was also published by hand. The integrity hash in the lockfile matches the checked tarball, and the postinstall only runs `lefthook install` and skips in CI.
  - Verified on 2026-11-04 with from-scratch resolutions: without the exclusion pnpm stops with "High-risk trust downgrade for lefthook@2.2.2 (possible package takeover)"; with it, the resolution passes, Vitest 5.1.0 included, and gives the committed lockfile.
  - The exclusion goes when lefthook publishes with provenance again (version table).
  - A second exclusion since F04, `prisma@7.10.1`, with a dated comment (2026-11-05). `prisma` 7.9.1 was published with provenance; the CLI's 7.10.x releases fell back to Prisma's bot token. Prisma's own release run 38790713203 (`prisma/orm`, `publish.yml`, branch `v7` at `97ea3592`) built 7.10.1 and logged "Published package prisma@7.10.1" after its OIDC exchange had failed (404); every `@prisma/*` package of 7.10.1 carries that run's provenance, and the tarball's sha512 equals the registry's. It needs the security-reviewer's sign-off with the F04 review, and it goes when the pinned `prisma` version has provenance again.

### 4. Turborepo 2.11.10

- Tasks `build`, `lint`, `typecheck` and `test` depend on `^build`. `build` outputs `dist/**`.
- `test` outputs `coverage/**` since F03, which turned coverage on in the API (RT-58), and `reports/**` since F02, where every Vitest config writes its JUnit report (decision 8), so a cached run restores both reports.
- No package overrides the `test` outputs. F03 had added `packages/eslint-config/turbo.json` (`extends: ["//"]`) with `outputs: []`, because that package's tests write no coverage and Turborepo 2.11.10 then printed "WARNING no output files found for task @medibooker/eslint-config#test" on every run (measured on 2026-11-04). F02 removed it: the package's tests now write `reports/junit.xml`, a declared output, and the warning is gone (2026-11-05).
- `dev` (F03): `persistent: true`, `cache: false`. The root script `pnpm dev` runs it; today only the API has a `dev` script (`nest start --watch`). The API reads the root `.env` itself, so the task needs no environment pass-through. In strict mode, though, only `CI` and `NODE_ENV` reach it from the shell: under `pnpm dev` the root `.env` is the only source of the API's values, and a shell override needs a direct run (`pnpm --filter @medibooker/api dev`). The developer docs say so.
- `apps/api/turbo.json` (F03, `extends: ["//"]`) sets the inputs of the API's `test` task to `$TURBO_DEFAULT$` plus `$TURBO_ROOT$/.env.example`: a test reads that root file, which is outside the package and would otherwise not be hashed.
- Root tasks `//#lint:root`, `//#typecheck:root` and `//#test:root` check the repo scripts and the root config files. They list their inputs explicitly: by default a root task depends on every file outside the packages (docs, agents and skills), so it would never be cached.
  - All three include `pnpm-lock.yaml`. The root's dependency hash does not cover the dependencies of `@medibooker/eslint-config`, which the root lint loads, so a lockfile-only update would otherwise replay a stale result.
  - `//#test:root` also includes `.gitleaks.toml`, `.gitleaksignore` (F02), `lefthook.yml`, `.github/**`, `renovate.json` and `docs/dev/getting-started.md` (F02, for `scripts/ci-config.test.ts`), which its tests read, and outputs `coverage/**` and `reports/**` (F02). It declares `env: ["GITLEAKS_VERSION"]`: CI's gitleaks action exports the version of the gitleaks it installs, so a gitleaks upgrade re-runs the rule test (F02). Locally, a run without gitleaks is cached with the rule cases skipped; after installing gitleaks, run `pnpm test --force` once (docs/dev/getting-started.md).
- `globalDependencies` are `.node-version` and `pnpm-workspace.yaml`; `globalEnv` is `CI` and `NODE_ENV`. Strict env mode, Turborepo 2's default, works on Windows without `globalPassThroughEnv`.
- Local cache only (`.turbo/`, gitignored). No remote cache, TUI, `generate` task or boundaries until something needs them.
- Verified: Turborepo reads the pnpm 12 lockfile (`lockfileVersion: '9.0'`); a second run is `FULL TURBO`; changing a rule message re-runs `//#lint:root` and `@medibooker/eslint-config#lint`.
- Turborepo sends anonymous usage data unless `TURBO_TELEMETRY_DISABLED=1` is set. The developer docs explain the opt-out, and CI sets it (`ci.yml`, F02).

### 5. TypeScript 6.0.3 and the presets (`@medibooker/tsconfig`)

- The presets contain `compilerOptions` only (no `include`, `files`, `baseUrl` or `paths`):

  | Preset | Content |
  |---|---|
  | `strict.json` | Strictness flags only (no `lib`, `target`, `module` or `types`), so platform presets such as Expo's can set them |
  | `node.json` | `strict.json` + `target` and `lib` es2024, `nodenext`, `types: ["node"]`, `noEmit` |
  | `library.json` | `node.json` + declarations and source maps from `${configDir}/src` into `${configDir}/dist`; packages build with plain `tsc` |
  | `nest.json` | `node.json` + `experimentalDecorators` and `emitDecoratorMetadata` |
  | `nextjs.json` | `strict.json` + DOM libs, bundler resolution, `jsx: preserve` and the `next` plugin |

- `exactOptionalPropertyTypes` stays off. The target stays es2024: @swc/core 1.16.21 rejects es2025 (RT-47). The API's `.swcrc` keeps target es2024, and its tsconfig adds `lib: ["es2025", "esnext.temporal"]` (both exist in TypeScript 6.0.3) and `useDefineForClassFields: false` (F03).
- Each preset is proven by a fixture that TypeScript 6.0.3 compiles; the `node` fixture fails when `noUncheckedIndexedAccess` is turned off. Each preset has a `$schema` key for editors.
- `react-library` and `react-native` presets come with their first consumer. Mobile will extend `strict.json` before `expo/tsconfig.base`, so that Expo's DOM lib wins (RT-75).

### 6. Linting (`@medibooker/eslint-config`)

- **ESLint 10 flat config**, with one `eslint.config.js` per package: ESLint 10 looks up the config from each linted file's directory. The package is plain ESM JavaScript with JSDoc types, checked by `tsc` (`checkJs`), without a build step.
- **Presets:**
  - `base({ tsconfigRootDir })`: `@eslint/js` recommended; typescript-eslint `strictTypeChecked` and `stylisticTypeChecked` with the project service; import-x with the TypeScript resolver (`no-duplicates`, `no-self-import`); `eqeqeq`, `no-console`, `consistent-type-imports` and `switch-exhaustiveness-check`; unused `eslint-disable` comments as errors (`reportUnusedDisableDirectives`); eslint-config-prettier last.
  - `nest()`: `import-x/no-cycle` (under ESM with decorators, an import cycle crashes at startup), `no-extraneous-class` with `allowWithDecorator`, the clock guardrail, and since F02 the three logging rules: `no-dynamic-log-message` and `require-logger-class-name` in every TypeScript file of the API, tests included, and `no-log-bindings` everywhere except `src/common/logging`.
  - `react()`: the colour and direction guardrails, except in tests.
  - `vitest()`: Vitest's recommended rules; focused and disabled tests are errors (decision 8); non-null assertions are allowed in tests.
- **Lint fails on any warning:** every lint script runs ESLint with `--max-warnings=0`, and stale `eslint-disable` comments are errors. A warn-level rule, such as `react-hooks/exhaustive-deps` from the later web and mobile presets, cannot slip through CI.
- **The local `medibooker` plugin** carries six rules for the non-negotiables in CLAUDE.md: three guardrails (F01) and, since F02, three logging rules for the API's log redaction ([02 §8](../architecture/02-api.md#8-logging-and-redaction)), from the F03 security reviews:

  | Rule | Reports | Applies to |
  |---|---|---|
  | `no-system-clock` | `new Date()` without arguments, `Date()` (returns the current time as text), `Date.now` and `Temporal.Now`; domain code gets the time from an injected Clock | `src/modules/**` of the API, except tests (`nest`) |
  | `no-dynamic-log-message` (F02) | A logger call (`log`, `info`, `warn`, `error`, `debug`, `verbose`, `fatal`, `trace`) whose message argument is not a string literal or a template literal without expressions, or whose arguments read `.message` or `.stack`. Type information finds the message argument: a Nest `Logger` takes it first, pino and nestjs-pino's `PinoLogger` take an optional object first; a method without a `message` or `msg` parameter is no logger | every TypeScript file of the API, tests included (`nest`) |
  | `require-logger-class-name` (F02) | `new Logger(…)` from `@nestjs/common` without `<Class>.name` of a class the file declares or imports, and Nest's static `Logger.log(…)` methods, which have no context of their own | the same (`nest`) |
  | `no-log-bindings` (F02) | `.child(`, `.setBindings(`, a logger's `.assign(` (nestjs-pino's `PinoLogger.assign`; not `Object.assign`), `runInContext(` and the `msgPrefix` option: bindings skip the log-field allowlist | the API outside `src/common/logging`, tests included (`nest`) |
  | `no-hex-colors` | `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa` in JavaScript and TypeScript strings and template literals; not JSX `href` values, ids such as `#section` or HTML entities. CSS files (`globals.css`, CSS modules, Tailwind `@theme` blocks) are not checked: the web item adds a CSS check (follow-ups) | UI code (`react`) |
  | `no-physical-direction-classes` | Physical Tailwind classes, also with variants, `!` and `-`, and it names the logical replacement (`ml-2` → `ms-2`, `text-left` → `text-start`, `rounded-tl` → `rounded-ss`). `ml`, `mr`, `pl`, `pr`, `left`, `right` and the `scroll-*` forms match only with a value (`left-0`), because a bare `left` can be a variant name. Allowed: the centring idiom, `left-1/2` or `right-1/2` (also `[50%]`) with a horizontal translate in the same class list (`-translate-x-1/2`, or shadcn/ui's `left-[50%] translate-x-[-50%]`). Translate does not mirror, so `start-1/2` would put dialogs off-centre in right-to-left layouts | `className` and `class` values and the arguments of `cn`, `clsx`, `cva`, `twMerge`, `twJoin` and `tv`, also through `?:`, `&&`, `+`, arrays, objects, spreads and `as`, `satisfies` or `!` (`react`) |

  - **Dropped on 2026-11-04: `no-legacy-imports`.** It reported imports, re-exports, `import()`, `require()` and TypeScript import types whose path led into the v1 folders, in every file (`base`). The user removed v1 from the working tree on 2026-11-02 (L00): the rule guarded folders that no longer exist, and v2 shares no code with v1. Its rule test, preset test and fixture went with it, and `base()` no longer registers the plugin.
  - **Why local rules:** flat config replaces the options of a core rule instead of merging them, so a later preset's `no-restricted-syntax` or `no-restricted-imports` would silently drop an earlier guardrail. Regex selectors give false positives (`href="#add"`) and cannot name the logical class. eslint-plugin-better-tailwindcss needs Tailwind installed before the web app exists.
  - **Proven by tests:** rule tests with valid and invalid cases, plus preset tests that lint real fixture files from the checkout path with spaces. They also show that the `nest()` preset keeps a value import that dependency injection needs under `emitDecoratorMetadata`; typescript-eslint reads that option from the project service. The preset tests throw when a fixture is ignored by the presets or cannot be parsed (for example when its tsconfig does not include it), so an empty result always means that the file was linted.
  - **The logging rules (F02):** `no-dynamic-log-message` and `no-log-bindings` read the TypeScript program of `base()`'s project service and throw when a file has none, so a misconfigured rule fails lint instead of passing every file. Their RuleTester cases run with type information against declarations copied from the installed pino 10.4.0, Nest 12.3.2 and nestjs-pino 5.3.1, and reject the probe calls of the F03 security review. `apps/api/test/lint/logging-rules.canary.ts` proves them against the installed declarations: one forbidden call per rule and logger, each under a disable comment, so the API's lint fails through `reportUnusedDisableDirectives` when an upgrade renames a parameter or a method and a rule stops reporting (verified with a rule that no longer knows `msg`). The API's two test files that break the rules on purpose (`test/support/probe.module.ts`, `src/common/logging/pino-options.spec.ts`) carry disable comments with the reason, which `reportUnusedDisableDirectives` keeps honest.
  - **Which logger logs an error (F02 review):** Nest's `Logger` declares its message as the first parameter, so `no-dynamic-log-message` reports `logger.error({ err }, 'booking failed')` on it. Nest's `Logger` therefore logs constant messages only; an error or reviewed fields go through nestjs-pino's `PinoLogger` (its context set to `<Class>.name`, as `UnknownExceptionFilter` does) or `req.log` ([02 §8](../architecture/02-api.md#8-logging-and-redaction)). A RuleTester case accepts that form in a service class and rejects it on Nest's `Logger`.
  - **Known gaps**, accepted by the implementer and open to the F02 security review: calls through `.bind`, `.call`, `.apply`, `Reflect.apply` or a destructured method; `child()` or `assign()` on an `any`-typed receiver; Nest's `Logger` reached through a re-export, a variable or a subclass; error text through `String(err)` in a field, which the allowlist and the message hook still drop at run time; and the context a service passes to `PinoLogger.setContext` or `@InjectPinoLogger`, which `require-logger-class-name` does not check (a review rule in 02 §8; a follow-up).
- **Framework presets come with their apps** (`next`, `reactNative`/`expo`, Testing Library, boundaries). eslint-config-next 16.4 and eslint-config-expo 58 accept ESLint 10 themselves, but they depend on eslint-plugin-react 7.37.5 (ESLint up to 9.7), eslint-plugin-import 2.32.0 (up to 9) and, for Next.js, eslint-plugin-jsx-a11y 6.10.2 (up to 9). The web and mobile items choose ESLint 10-compatible replacements and record them.

### 7. Formatting: Prettier 3.9.10

- `prettier.config.js` (JavaScript, so that a Tailwind plugin can be added later): `printWidth` 100, single quotes, trailing commas, semicolons, LF. No plugins.
- `.prettierignore` excludes `.claude/`, `*.md` and `pnpm-lock.yaml`. Markdown is formatted by hand: Prettier would rewrite README.md, CLAUDE.md, every ADR, the product docs and the skills.
- The pre-commit hook only checks. It never rewrites and re-stages files.

### 8. Tests: Vitest 5.1.0 with Vite 8.3.5

- Vitest runs the tests of the packages and of the repo scripts. Vite is a required peer of Vitest.
- **No silent green (RT-62):**
  - `passWithNoTests: false` in every Vitest config: a run that finds no tests fails.
  - `allowOnly: false` in every Vitest config: a focused test fails every run, including a RuleTester case with `only: true` (it runs through Vitest's `it.only`). Vitest's default fails only when `CI` is set, so a local `pnpm verify` would pass while it silently skipped the other cases.
  - `vitest/no-focused-tests` and `vitest/no-disabled-tests` are errors. A fixture test proves both; with Vitest's recommended config alone, `no-disabled-tests` is only a warning.
  - Allowed: `it.todo()` for a planned test, and conditional skips (`it.skipIf(...)`, `describe.skipIf(...)`, `context.skip(condition, note)`) for tests that depend on the environment.
- Longer timeouts on Windows: 60 seconds where ESLint starts a TypeScript project service, 30 seconds for script tests that start processes and for the API's `beforeAll` hooks that boot an app.
- **Module cache (F03):** Vitest 5 caches compiled modules on disk by default (`fsModuleCache`, in `node_modules/.vitest-cache`). Its key covers plugin names and the config file's own text, but not plugin options or files the config reads. The API's config reads `.swcrc` and therefore adds its text to the key with `defineCacheKeyGenerator` (a small plugin in `apps/api/vitest.config.ts`): without it, a changed `.swcrc` kept serving modules compiled with the old settings, and the smoke spec passed with decorator metadata turned off (verified on 2026-11-04). A config that reads another file does the same.
- **Coverage (F03, RT-58):** `@vitest/coverage-v8` at Vitest's version; the API's thresholds of [06 §8](../architecture/06-testing.md#8-coverage-gates) fail `pnpm --filter @medibooker/api test` locally, and CI enforces them from F02. Since the F02 reviews, `@medibooker/eslint-config` (90 % lines, 85 % branches over `src`; 97.6 % and 91.1 % on 2026-11-05) and the root's `scripts/lib` (90/85, and 100 % of every metric for the pure decisions `scan-range.ts` and `shallow-clone.ts`; 97.4 % and 94.9 %) enforce their gates too: `test` and `test:root` run with `--coverage`, and both are devDependencies of `@vitest/coverage-v8`. The scripts' command-line tools run in child processes, which V8 coverage does not see, so the root gate counts `scripts/lib` only.
- **Test reports (F02, RT-62):** every Vitest config sets `reporters: ['default', 'junit']` with `outputFile: { junit: 'reports/junit.xml' }`, also locally: the report is an output of the Turbo test tasks (decision 4), so a cached run restores it for CI, which uploads it ([ADR 0009](0009-ci-branch-model-and-supply-chain.md)). `reports/` is gitignored, and so is `.vitest/`, where Vitest 5 writes a file reporter that has no `outputFile`. A package with 0 tests still fails through `passWithNoTests: false`.

### 9. Git hooks: lefthook 2.2.2

- lefthook is a root devDependency, because the generated hooks look for it in `<repo>/node_modules/lefthook`. Its postinstall installs the hooks (`allowBuilds`) and skips when `CI` is set. CI sets `LEFTHOOK=0` and runs the checks itself.
- **The hooks fail closed too:**
  - `assert_lefthook_installed: true`. Without it, a generated hook that cannot find lefthook (for example after `node_modules` was deleted) printed "Can't find lefthook in PATH" and let the commit through without any check. Now it aborts with exit code 1, verified with a copy of the generated hook.
  - `min_version: 2.2.2`: an older lefthook that comes first on `PATH` fails instead of running the hooks.
  - `pnpm verify` starts with `scripts/check-hooks.ts` (`lefthook check-install`). It fails with an install hint when the hooks are missing or out of date, for example after lefthook's postinstall failed: that script only warns, so `pnpm install` still succeeds. `LEFTHOOK=0` or `false` switches the hooks off: lefthook 2.2.2 honours that switch in `lefthook run` only, and its `check-install` fails on a checkout without hooks (found by F02's Linux dry run). With `CI=true` as well, which GitHub Actions sets, the script skips the check, because CI has no hooks and runs the checks itself. On any other machine the switch fails the check with "LEFTHOOK=… switches the git hooks off", because commits would skip the secret scan and the commit-message check (F02 security review).
  - Local overrides (`lefthook-local.*`) are gitignored, because they can switch a hook off.
- Every hook command calls `node` directly, without pnpm: on Windows lefthook runs commands through Git's `sh`, where `pnpm` may resolve to a broken shim. Arguments are single-quoted, because lefthook wraps the command in double quotes on Windows.
- **commit-msg** (`scripts/check-commit-msg.ts`) enforces Conventional Commits, `<type>(<scope>)!: <summary>`:
  - the types are `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore` and `revert`;
  - the scope is optional lowercase kebab-case, checked for format only (no fixed list, so a new module needs no config change);
  - the header has at most 72 characters and no final period, and the second line is empty when a body follows;
  - headers that git writes itself (`Merge`, `Revert "`, `fixup!`, `squash!`, `amend!`) pass; comment lines and everything below the scissors line are ignored.
- **pre-commit**, in parallel: Prettier checks the staged files, and gitleaks scans the staged changes (decision 10). Known limit: Prettier reads the working-tree copy of the staged files, so a partly staged file can pass; CI's `pnpm format:check` is the gate.
- No pre-push hook: the pre-commit scan already covers every commit, and CI is the hard gate (F02). Hooks are never bypassed; `--no-verify` is not allowed.
- `pnpm verify` runs the hook check, the staged secret scan, `prettier --check .`, since F02 `pnpm dedupe --check` (as CI's `quality` does, so a lockfile that CI would reject fails before the commit), and then lint, typecheck, tests and, since F03, the build through Turborepo. The API's tests compile through `unplugin-swc`, so only the build compiles through `nest-cli.json`, whose `ignore` entry keeps spec files out of `dist`. Run it after `git add`.
- **Proven by tests:** `scripts/hooks.test.ts` runs lefthook itself. `lefthook validate` passes; `lefthook dump` shows `assert_lefthook_installed` and the unskipped `secrets` command of the pre-commit hook; `lefthook run commit-msg` rejects "update stuff" and accepts "chore(repo): add tooling", with the message file in a path with a space. It also tests `scripts/check-hooks.ts` against a config that no installed hooks match: the check fails with an install hint, is skipped for `LEFTHOOK=0` and `false` with `CI=true`, fails for them without `CI=true` (also with `CI` set to `false` or `1`), and still runs for values that lefthook does not treat as off, such as `1` and `FALSE`, also in CI. Nothing is installed or staged.

### 10. Secret scanning: gitleaks 8.30.1, failing closed

- gitleaks is a **required** developer tool. docs/dev/getting-started.md lists the install routes for Windows, macOS and Linux, with checksum checks that stop the install when they fail.
- The pre-commit hook and `pnpm verify` run `scripts/run-gitleaks.ts`, which since F02 first checks the `.gitleaksignore` pin and then calls `gitleaks git --pre-commit --staged`. It **fails closed**: a pin mismatch, a missing binary, a start error, a signal or, since F02, an error that gitleaks logs (a line at level `ERR` or `FTL`) blocks the commit with an install hint or a reason, and a finding keeps gitleaks' non-zero exit code. When nothing is staged (`git diff --cached --quiet`), it says that the scan checked nothing; a missing gitleaks still fails. Since the F02 reviews, gitleaks runs with `GIT_ATTR_SOURCE` set to the empty tree, so git (2.40 or later) reads no `.gitattributes` of the repository: a staged file that `.gitattributes` marks `-diff` is diffed as text instead of "Binary files differ", which gitleaks' staged mode, taking no git options, would otherwise skip ([ADR 0009](0009-ci-branch-model-and-supply-chain.md) decision 4).
- **One policy for every scan** (`policyArguments()` in `scripts/lib/gitleaks.ts`): the repository's `.gitleaks.toml`, `--redact`, and `--ignore-gitleaks-allow`, plus `--no-banner` and `--no-color` (F02), so the scripts can find the errors gitleaks logs without failing. An inline `gitleaks:allow` comment would otherwise silence a finding in the hook and in CI, which is the obvious way out for an agent whose commit is blocked. Only a reviewed change to `.gitleaks.toml` or `.gitleaksignore` can allow a finding: gitleaks reads `.gitleaksignore` from the scan root whatever `--gitleaks-ignore-path` says, so the file is pinned to the two accepted fingerprints (below). The rule test uses the same options, and so does every CI scan, through `scripts/scan-secrets.ts` (F02, [ADR 0009](0009-ci-branch-model-and-supply-chain.md)).
- **`.gitleaks.toml`** extends the default rules (`[extend] useDefault = true`) with one rule, `medibooker-password-assignment`, because the defaults miss plain password assignments.
  - Keys: ending in `password`, `passwd`, `passphrase`, `pwd` or `secret` (any case, so also `*_PASSWORD` and `*_SECRET`), or `pass` on its own or after `_`, `.` or `-` (`SMTP_PASS`, a mail transport's `pass:`; not `bypass`). SMTP credentials arrive with the e-mail channel (ADR 0001).
  - After `=`, `:`, `:=` or `=>`, it reports a value of at least 8 characters: quoted without whitespace, also as the literal fallback of `x ?? '...'` or `x || '...'`; unquoted to the end of the line (env, YAML and ini files), where the value may contain `,` and `;` but not end with them; or the password of a connection URL (`scheme://user:<value>@host`), also with an empty user name.
  - Placeholders are allowed: `changeme`, any value that contains `example`, `<...>`, a plain variable reference `${VAR}` (also `${VAR:-}` and `${VAR:?message}`), `$VAR` and `process.env.*`; empty values are too short. A shell default with a literal value (`${VAR:-...}` in env and compose files) is reported. Code such as `password: dto.password,` is not reported.
  - Known limit: a quoted value with spaces (a passphrase in quotes) is not reported. Allowing spaces would flag the labels in the translation catalogs.
- **Proof:** `scripts/gitleaks-config.test.ts` runs the real gitleaks binary on synthetic fixtures: 18 cases that must be reported and 18 that must not, including the test file itself. One reported case carries an inline `gitleaks:allow` comment, so it proves that the scans ignore such comments. The test writes the fixtures to a temporary directory at test time. That is the simplest option: no scan of the repository ever sees them, and no allowlisted fixture path can hide a real secret. Without gitleaks, the cases skip locally with a note; with `CI=true` they fail. `scripts/lib/gitleaks.test.ts` pins the options of the staged scan (`--pre-commit`, `--staged`, `--redact`, `--ignore-gitleaks-allow` and the config path) and, since F02, the pin, the arguments of the range and history scans (with their `git log` options), the gitleaks environment and the outcomes (55 tests); `scripts/lib/secret-self-test.test.ts` (17) covers the self-test checks, `scripts/lib/scan-range.test.ts` (19) and `scripts/lib/shallow-clone.test.ts` (10) the range rules and the clone check, and `scripts/scan-secrets.test.ts` (25) and `scripts/run-gitleaks.test.ts` (3) the command lines, also on throw-away repositories (F02 reviews, [ADR 0009](0009-ci-branch-model-and-supply-chain.md) decision 4).
- **Effect:** in the git history, the default rules find nothing, and this config finds the two findings of the one v1 database credential, both in commit `0011060`. The files of the working tree (117 on 2026-11-04, after the v1 removal) give 0 findings.
- **`.gitleaksignore` since F02** (none in F01). The user declined U1 on 2026-11-04: the v1 credential is not rotated and stays valid in the public history, a risk the user accepted. F02 recorded the commit-qualified fingerprints of the two v1 findings in `.gitleaksignore` as that accepted risk, with a comment dated 2026-11-04 (RT-01), and pinned the file: a commit-less entry would silence a finding in every commit. `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts` holds the two fingerprints, and the pre-commit hook, `pnpm verify` and every CI scan (`scripts/scan-secrets.ts`) fail closed when the file's entries differ from them, read as gitleaks reads the file. The hook checks the working-tree file, CI the committed one; `node scripts/scan-secrets.ts pin` checks it on its own (docs/architecture/07-docker-ci-cd.md §4, also for the rule on later entries; ADR 0009).

### 11. Line endings and editor settings

- `.gitattributes`: `* text=auto eol=lf`. `*.cmd`, `*.bat` and `*.ps1` keep CRLF, with one pattern per line, because gitattributes has no brace expansion. Binary types are marked `binary`, and the lockfile is `linguist-generated`. Nothing was renormalized: the index was already LF.
- `.editorconfig`: UTF-8, LF, two spaces and a final newline; Markdown keeps trailing whitespace; `*.cmd`, `*.bat` and `*.ps1` use CRLF, matching `.gitattributes`.
- `.gitignore`: dependencies, caches, build output, `.env`, `.env.*` and `*.env` files (the v1 leak was `dev.env`) except `.env.example`, lefthook's local overrides, logs, OS and editor files, keys, certificates and signing material (`*.p8`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.mobileprovision`; gitleaks cannot scan binary key stores).

## Version table

Checked on 2026-11-04 at 13:42 UTC with `npm view <pkg> time dist-tags`; the gate then accepted versions published before 2026-11-03 13:42 UTC. The rows added by F03 (the API's packages) were checked on 2026-11-04 at 18:44 UTC, when the gate accepted versions published before 2026-11-03 18:44 UTC; one from-scratch resolution under `minimumReleaseAge` and `trustPolicy: no-downgrade` installed exactly these versions without a refusal. The gitleaks row was re-checked for F02 on 2026-11-05; the CI pins (actions, images, the runner) are in [01 §5](../architecture/01-repo-and-tooling.md#ci-pins). The rows marked F04 were checked on 2026-11-05 with `npm view <pkg> time dist-tags` and installed under `minimumReleaseAge` and `trustPolicy: no-downgrade` (with the exclusion of decision 3). A row without a deviation is updated when a newer version passes the gate.

| Tool | Version | Published | Deviation and reason | Revisit when |
|---|---|---|---|---|
| Node.js | 26.13.0 | 2026-10-28 | None. The first 26.x LTS release; set in `.node-version` and `engines` | — |
| pnpm | 12.16.1 | 2026-10-27 | None. 12.17.0 exists only on the `next-12` tag | — |
| `@eslint/js` | 10.0.1 | 2026-02-06 | None | — |
| `@nestjs-cls/transactional`, `@nestjs-cls/transactional-adapter-prisma` | 4.0.2 · 2.0.2 | 2026-10-27 | None (F04). The platform connection uses the Prisma adapter; the practice connection has a custom adapter ([02 §5](../architecture/02-api.md#5-data-layer-and-tenancy)) | — |
| `@nestjs/cli` | 12.0.11 | 2026-10-27 | None | — |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/testing` | 12.3.2 | 2026-10-27 | None. 12.3.3 was published on 2026-11-04 at 09:36 UTC and was still inside the gate; the four always move together | 12.3.3 has passed the gate (2026-11-05 09:36 UTC) |
| `@nestjs/throttler` | 6.7.1 | 2026-09-24 | None. Peer range accepts Nest 12 | — |
| `@peculiar/x509` | 3.1.0 | 2026-10-27 | None (F04). A devDependency of the API: the TLS spec generates its CA and server certificate at run time, and Node has no API for that | — |
| `@prisma/adapter-pg`, `@prisma/client` | 7.10.1 | 2026-10-15 | They move with `prisma` (its row) | With `prisma` |
| `@swc/cli` | 0.8.2 | 2026-10-28 | None | — |
| `@swc/core` | 1.16.21 | 2026-10-31 | None. Install script denied in `allowBuilds` (decision 3) | — |
| `@testcontainers/postgresql`, `testcontainers` | 12.2.1 | 2026-10-13 | None (F04). Integration tests only | — |
| `@types/node` | 26.6.6 | 2026-10-28 | None. Follows the Node major version | The Node major changes |
| `@types/pg` | 8.23.1 | 2026-08-17 | None (F04) | — |
| `@types/supertest` | 7.2.1 | 2026-07-14 | None | — |
| `@vitest/coverage-v8` | 5.1.0 | 2026-11-02 | None. Always Vitest's version | — |
| `@vitest/eslint-plugin` | 1.6.28 | 2026-10-22 | None | — |
| `chokidar` | **5.0.0** | 2025-11-25 | **Yes.** `latest` is 6.0.0 (2026-10-19). `nest start --watch` runs @swc/cli in watch mode, which loads chokidar, an optional peer that @swc/cli 0.8.2 accepts only as `^5.0.0`. Before F03's review it was linked only because @nestjs/cli 12.0.11 pins 5.0.0; a devDependency of the API now declares it, so a @nestjs/cli update cannot silently break `pnpm dev`. Renovate (F02) holds it below 6 | @swc/cli accepts chokidar 6 |
| `eslint` | 10.14.0 | 2026-10-30 | None. Framework plugins lag behind (decision 6) | — |
| `eslint-config-prettier` | 10.1.8 | 2025-07-18 | None | — |
| `eslint-import-resolver-typescript` | 4.4.5 | 2026-06-01 | None | — |
| `eslint-plugin-import-x` | 4.17.1 | 2026-06-28 | None | — |
| `globals` | 17.14.0 | 2026-11-01 | None. Pinned once it had passed the gate, without an exception | — |
| `helmet` | 8.3.0 | 2026-07-12 | None | — |
| `lefthook` | 2.2.2 | 2026-10-13 | None. The npm package was published without provenance; accepted by the security review, with a dated `trustPolicyExclude` entry (decision 3) | The next release: check that it has provenance again, then remove the exclusion |
| `nestjs-cls` | 7.0.2 | 2026-10-27 | None | — |
| `nestjs-pino` | 5.3.1 | 2026-10-02 | None | — |
| `pg` | 8.23.1 | 2026-09-30 | None (F04). In the API (the platform pool's driver) and in db-migrate | — |
| `pino` | 10.4.0 | 2026-10-02 | None | — |
| `pino-http` | 11.0.0 | 2025-10-04 | None | — |
| `pino-pretty` | 13.2.0 | 2026-10-04 | None. A devDependency of the API, used only with `LOG_PRETTY` | — |
| `prettier` | 3.9.10 | 2026-10-10 | None. 4.0 is an alpha | — |
| `prisma` | **7.10.1** | 2026-10-15 | **Yes.** Decided by F04 on 2026-11-05: npm's `latest` tag points at the prerelease 8.0.0-rc.30 (2026-11-03), and "latest" in this policy is never a prerelease (decision 1), so the pin is 7.10.1, the newest stable release (tag `prev`). `prisma`, `@prisma/client` and `@prisma/adapter-pg` move together (Renovate's `prisma` group). Prisma 7.10.1 lists Node 20.19+, 22.12+ and 24.0+ as supported; every F04 command (`generate`, `migrate deploy`, `migrate diff`, `migrate dev`) worked on Node 26.13.0. The CLI was published without provenance (decision 3). `partialIndexes` is still a preview feature | A stable 8.0.0 has passed the gate |
| `reflect-metadata` | 0.2.2 | 2024-03-29 | None | — |
| `rxjs` | 7.8.2 | 2025-02-22 | None. A later major exists only as a prerelease (`next` is 9.0.0-beta.1) | — |
| `supertest` | 7.3.1 | 2026-10-02 | None | — |
| `tsx` | 4.23.15 | 2026-09-20 | None (F04). Runs `apps/api/prisma/seed.ts` | — |
| `turbo` | 2.11.10 | 2026-10-20 | None | — |
| `typescript` | **6.0.3** | 2026-04-16 | **Yes.** `latest` is 7.0.2 (2026-07-08). typescript-eslint 8.72.1 requires `>=4.8.4 <6.1.0`, @nestjs/cli 12.0.11 ships TypeScript `~6.0.2`, and @nestjs/swagger 12.1.0 requires `^5.5.0 \|\| ^6.0.0`. 6.0.3 is the newest 6.x | typescript-eslint, @nestjs/cli and @nestjs/swagger support TypeScript 7 |
| `typescript-eslint` | 8.72.1 | 2026-10-26 | None | — |
| `unplugin-swc` | 2.0.0 | 2026-09-21 | None | — |
| `vite` | 8.3.5 | 2026-10-21 | None. A required peer of Vitest | — |
| `vitest` | 5.1.0 | 2026-11-02 | None. Updated from 5.0.5 once 5.1.0 had passed the gate | — |
| `yaml` | 2.9.1 | 2026-09-11 | None. A root devDependency since the F02 reviews: `scripts/ci-config.test.ts` parses the workflows with it. No dependencies; no version was published with provenance, so `trustPolicy` sees no downgrade (checked on 2026-11-05) | — |
| `zod` | 4.6.7 | 2026-10-12 | None | — |
| PostgreSQL (image) | 18.6: `postgres:18.6-trixie@sha256:bd5dfa494a5a259704365813dbfa5fa6b3e69be7348d43b547f540c730478583` | the multi-arch index pushed on 2026-11-05 at 10:14 UTC | None (F04). The newest 18.x; PostgreSQL 19 is a release candidate. `compose.dev.yaml` and the Testcontainers constant pin the same index; Renovate's `postgres` group moves both, digest updates without a release age (rebuilt images carry security patches) | A PostgreSQL major version, which needs a `pg_upgrade` plan for every cluster |
| gitleaks | 8.30.1 | 2026-03-21 | None. A binary installed on each machine, not an npm package; still the newest release on 2026-11-05. CI installs `gitleaks_8.30.1_linux_x64.tar.gz` only after its SHA-256 matches `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (`.github/actions/gitleaks`, F02) | A new release: Renovate's custom manager moves the CI version and its checksum together, and the developer install lines of docs/dev/getting-started.md in the same pull request (RT-38) |

Recorded for later items (not in the catalog yet):

| Tool | Version | Reason | Revisit when |
|---|---|---|---|
| Expo SDK | 58 (`expo` 58.0.22) | The newest SDK. Expo is the Proposed mobile toolchain of CLAUDE.md, not a client decision (U11) | The next SDK |
| React, React DOM | 19.3.0 | Expo SDK 58 bundles 19.3.0; npm's `latest` is 19.3.1. Recommendation: one React version in the whole workspace, enforced with pnpm `overrides`, because the shared source package `@medibooker/api-client` must not see two React copies (RT-78). The web app may use 19.3.1 only if the isolated linker keeps web and mobile apart; the web and mobile items decide and record it | The next Expo SDK |
| React Native | 0.88.1 | The Expo SDK 58 pin, also npm's `latest` | The next Expo SDK |
| Next.js | 16 | The web item chooses the exact version under this policy (NestJS is in the version table since F03) | — |

## Accepted risks

`pnpm audit` on 2026-11-04 reports one advisory, and it is accepted. It is moderate, so it lies below the `--audit-level=high` gate of CI's `pnpm audit --prod` (every push and weekly, F02) and needs no `auditConfig.ignoreGhsas` entry: on 2026-11-05 `pnpm audit --prod --audit-level=high` exits 0 and lists it as the one moderate advisory. A new high or critical advisory fails CI.

| Advisory | Package | Where | Why accepted | Revisit when |
|---|---|---|---|---|
| GHSA-g3hv-75wg-m249, moderate (CWE-405): denial of service through glob-pattern amplification | `minimatch` 10.2.6 and, since F03, 9.0.9; fixed in 11.0.1 | Lint tooling: `eslint`, `@eslint/config-array`, typescript-eslint and `eslint-plugin-import-x`. Since F03 also the API's build tools, both devDependencies: `@nestjs/cli` 12.0.11 (pins 10.2.6) and `@swc/cli` 0.8.2 (`^9.0.3`). `pnpm audit --prod` lists it too, because `@medibooker/eslint-config` declares its plugins as `dependencies`; `pnpm audit --prod --filter @medibooker/api` finds nothing (2026-11-04) | Only lint-time and build-time glob patterns from the repository's own config reach it, never user input, and none of it is in the API's runtime. All dependents accept only minimatch 9 or 10, so a pnpm override would force an untested major version under ESLint and the build tools | eslint, typescript-eslint, eslint-plugin-import-x, @nestjs/cli and @swc/cli accept minimatch 11.0.1 or later |

## Consequences

**Positive:**
- One runtime and reproducible installs on Windows and Linux; the lockfile pins pnpm as well.
- Versions are as new as possible with a one-day safety margin, and exceptions follow a written rule.
- The guardrails fail lint at the offending line: the system clock in domain code, hex colours, physical directions and, since F02, log calls that could carry personal data into a message or a binding.
- A secret is blocked before the commit exists, also when lefthook is missing, and the custom rule finds the plain password assignments that the default rules miss. Only a reviewed change to `.gitleaks.toml` or to `.gitleaksignore` (pinned since F02) can allow a finding.
- A package release with less trust than its predecessors does not install without a recorded decision.
- Focused, disabled or missing tests and lint warnings cannot make a run green.
- A second run without changes is fully cached.

**Negative:**
- Six local rules and their tests need maintenance; the two typed logging rules also depend on the logger declarations of pino, Nest and nestjs-pino.
- Markdown is not formatted automatically.
- Setting up Windows takes manual steps: the pnpm shims, gitleaks on `PATH`, the path-length limit.
- Every developer must install gitleaks before the first commit.
- New versions arrive one day late (three days with Renovate), and an urgent security fix needs an exception.
- TypeScript 7's faster native compiler is not available yet.
- Without gitleaks, the rule test is skipped locally; only CI enforces it.
- Quoted secrets with spaces are not detected (decision 10).
- The hooks only work on machines that ran `pnpm install`; before F02, nothing checked a push, and since F02 CI does.

**Follow-ups:**
- **Before the F01 commit (main agent):**
  - Stage by explicit paths, never `git add -A`. L00 (the v1 removal) and R00 are committed before F01.
  - A security re-check of the review fixes listed in the history line.
- **F03 (API, before F02 since 2026-11-04): done (2026-11-04).**
  - One SWC configuration, `apps/api/.swcrc` with target es2024, read by `nest build` (SWC builder in object form, spec files left out of `dist`) and by Vitest through `unplugin-swc` (RT-47). Its text is part of Vitest's module-cache key (decision 8). The API's tsconfig sets `lib` es2025 and `esnext.temporal`; the `base`, `nest()` and `vitest()` presets lint it.
  - Coverage (RT-58): `@vitest/coverage-v8` 5.1.0 in the catalog; the thresholds of 06 §8 at the root of the API's Vitest config (80 % lines, 70 % branches, 100 % for `*.rules.ts`, untested files counted through `include`); `pnpm --filter @medibooker/api test` runs `vitest run --project unit --coverage` and fails below them. The `test` task outputs `coverage/**` again, with the eslint-config override (decision 4; removed again in F02). CI enforces the thresholds from F02.
  - `'@swc/core': false` in `allowBuilds` (decision 3); the root scripts `build` and `dev` and the Turbo `dev` task (decision 4).
  - After the F03 reviews: `build` in `pnpm verify` (decision 9), `apps/api/turbo.json` with the root `.env.example` as a test input (decision 4), and chokidar 5.0.0 as a declared devDependency (version table).
- **User action U3, before F02 (the user's order of 2026-11-04): done on 2026-11-04.** GitHub secret scanning with push protection is on for the public repository: the server-side backstop for a machine without hooks, which does not wait for CI (RT-02). Non-provider patterns stay off, a user setting (read on 2026-11-05).
- **F02 (CI and Renovate): built on 2026-11-05** ([ADR 0009](0009-ci-branch-model-and-supply-chain.md), docs/architecture/07-docker-ci-cd.md §3 to §5). Each follow-up:
  - **Done:** CI on Node 26.13.0 only, read from `.node-version`; pnpm from `packageManager`; `LEFTHOOK=0` and `TURBO_TELEMETRY_DISABLED=1`.
  - **Done:** `pnpm install --frozen-lockfile`, then `pnpm format:check`, lint, typecheck, test and build, with `CI=true` (the `quality` job).
  - **Rejected: the checkout into a directory whose name contains a space** (`actions/checkout` `path`). Inside a composite action, GitHub resolves `./` action references against `GITHUB_WORKSPACE`, so with a checkout path the gitleaks action nested in the setup action would break. The development machine's checkout path and the tests' temporary paths with spaces prove the path handling.
  - **Done:** gitleaks 8.30.1 installed with a checksum check before `pnpm test` (`.github/actions/gitleaks`), its version exported as `GITLEAKS_VERSION`. CI's own scans run through `scripts/scan-secrets.ts`: the full history and the pushed range with `fetch-depth: 0` and the options of `policyArguments()`, and only redacted SARIF uploaded (RT-32).
  - **Deferred: the check of every commit message in the pushed range.** It is not in the F02 scope of docs/architecture/08-roadmap.md, and Renovate's commit headers can exceed 72 characters; it is decided with U4, once those headers are known (ADR 0009).
  - **Done:** the `.gitleaksignore` baseline for the two v1 findings, with the comment dated 2026-11-04 that records the risk the user accepted (U1, RT-01), and its pin: `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts`; the hook, `pnpm verify` and every CI scan fail closed when the file differs (decision 10).
  - **Done, one rule stricter:** Renovate with `minimumReleaseAge` of 3 days; TypeScript held below 6.1.0 instead of 7, matching typescript-eslint's peer `<6.1.0` (version table); chokidar held below 6; Expo-managed packages and React behind dashboard approval instead of `enabled: false`, so that security fixes still arrive (RT-06); the gitleaks version and checksum through a custom manager with the `github-release-attachments` datasource, so they move together (RT-38). `packageManager` is a dependency of Renovate's npm manager, whose pull request carries the regenerated lockfile; like the custom managers, that is first proven after U4.
  - **Done:** `pnpm dedupe --check` in `quality`, and since the F02 reviews in `pnpm verify` (decision 9).
  - **Changed: the audit**, as docs/architecture/07-docker-ci-cd.md and the F02 brief define it: `pnpm audit --prod --audit-level=high` on every push and weekly, over the whole workspace and failing closed (no `--ignore-registry-errors`). It is not scoped to the deployable apps and has no `auditConfig.ignoreGhsas` entry: the accepted minimatch advisory is moderate and lies below the gate (Accepted risks), and `pnpm audit --ignore` would write to `pnpm-workspace.yaml`.
  - **Done:** test reports (decision 8), and a package with 0 tests fails through `passWithNoTests: false` (RT-62).
- **F04 (the data layer): built on 2026-11-05.**
  - **Decided:** Prisma 7.10.1, the newest stable release, because npm's `latest` is the prerelease 8.0.0-rc.30 (version table); the PostgreSQL image 18.6 by its index digest.
  - **Done:** the F04 packages in the catalog (version table); six more `allowBuilds` entries and the `prisma@7.10.1` trust exclusion, each with its reason (decision 3); both Prisma configs read plain `process.env`, so `pnpm --filter @medibooker/api db:generate` needs no database variable and runs in CI's `quality` without any (RT-22, RT-46, RT-68).
  - **Deviations from the plan found while building:** `prisma migrate dev` does not create the shadow database that `SHADOW_DATABASE_URL` names (Prisma 7.10.1 fails with P1003), so the developer guide creates it once; `prisma migrate diff` without a config datasource exits 0 with no output, because the schema engine does not start without a datasource, so every diff runs with `--config` ([02 §9](../architecture/02-api.md#authoring-migrations)).
- **Later items:**
  - Web item: ESLint 10-compatible Next.js and accessibility rules; Playwright files named `*.spec.ts` kept out of the `vitest()` preset's file pattern; the React version (RT-78); a hex-colour check for CSS files (for example stylelint's `color-no-hex`) that excludes the generated design-token CSS.
  - Mobile item: the tsconfig order (RT-75); Jest rules against focused and skipped tests and `passWithNoTests: false` (RT-62); React `overrides`, which also pin the React peers that Prisma Studio brings in through `prisma` (found in F04), and an SDK upgrade runbook: bump the catalog and the overrides to the new SDK's versions, run `npx expo install --fix`, and run `npx expo install --check` in CI (RT-78); EAS `credentials.json` and `credentials/` in `apps/mobile/.gitignore`.
  - First app test suite: a quarantine helper as the only allowed skip, linked to an issue (RT-62).
  - i18n item: an allowlist in `.gitleaks.toml` for the translation catalogs, with a test case. Today a key such as `password` or `pass` with a one-word label of 8 or more characters is reported; labels with spaces are not.
  - Revisit TypeScript 7 when the deviation's exit condition is met.

## Alternatives considered

- **npm or Yarn workspaces, Nx:** pnpm workspaces and Turborepo are the Proposed default of CLAUDE.md. pnpm brings catalogs, the install-script allowlist and the release-age gate; Turborepo gives caching and task order with one small file. Nx would add generators and project configuration that this repository does not need.
- **Biome instead of ESLint and Prettier:** one fast tool, but no type-aware rules comparable to typescript-eslint's `strictTypeChecked`.
- **commitlint:** a large dependency tree for a check that a small, tested local script covers.
- **husky:** needs a `prepare` script and a shell script per hook; lefthook has one config file, runs commands in parallel and installs itself through its postinstall.
- **Core `no-restricted-syntax` and `no-restricted-imports`, or eslint-plugin-better-tailwindcss, for the guardrails:** see decision 6.
- **tsdown or another bundler for packages:** plain `tsc` with `library.json` is enough for packages that ship ESM and type declarations.
- **Formatting Markdown with Prettier:** it would rewrite every hand-formatted document, including files that belong to other work.
- **gitleaks only when it is installed (the first plan):** a committed secret would be public before CI sees it.
- **Committed gitleaks fixtures under an allowlisted path:** an allowlisted folder could hide a real secret; fixtures in a temporary directory need no allowlist.
- **CI on Node 24 and 26:** doubles CI time for a runtime that nobody uses.
- **Turning the release-age gate off, or adding exceptions for new versions:** gives up the protection against malicious releases for one day of freshness.
- **A pre-push hook that scans the pushed range:** it would only catch commits made with `--no-verify`, which is not allowed; CI scans the whole history.
- **A test that stages a synthetic secret in a temporary git repository, with the caller's environment** (the F01 plan): rejected then, because a test that runs `git add` inside a git hook would inherit `GIT_INDEX_FILE` and could point at the developer's real index. Since the F02 reviews such tests exist, isolated: `scripts/test-support/scan-fixtures.ts` drops every `GIT_*` variable of the caller and reads no user or system git configuration, so the throw-away repositories of `scripts/run-gitleaks.test.ts` and `scripts/scan-secrets.test.ts` cannot reach another index or repository.
- **A pnpm override to minimatch 11:** forces a major version under ESLint without upstream support; the advisory is accepted instead (Accepted risks).
- **Defender exclusions for the checkout and the pnpm store:** faster installs, but no malware scanning for any third-party package. A Dev Drive keeps scanning (docs/dev/windows.md).

## Red-team issues

The red-team review of 2026-11-01 raised 25 issues that touch the root tooling. Their status in F01, updated by F03, F02 and F04:

| Issue | Severity | Status | Details |
|---|---|---|---|
| RT-01 v1 credential in the public history | Blocker | Risk accepted by the user: U1 declined on 2026-11-04; baseline in F02 | The user declined to rotate the credential or decommission the database, so it stays valid in the public history. F01's rule finds both findings in the history; F02 records their commit-qualified fingerprints in `.gitleaksignore` as the accepted risk, with a dated comment, and pins the file (decision 10). The acceptance covers the credential only. Not verified: whether real people's data ever reached the v1 database (it had a public sign-up and stored contact, insurance and booking data; the seed data came from Faker). If real data is ever confirmed there, its controller assesses a breach under GDPR Art. 33/34 (notification within 72 hours of awareness); this decision does not replace that |
| RT-02 Scanning only after a secret is public | Major | Applied, with two exceptions | The pre-commit scan and `pnpm verify` fail closed, also when lefthook is missing (decision 9), inline `gitleaks:allow` comments are ignored, and gitleaks is a required tool. Rejected: a pre-push hook (see Alternatives). User action U3, done on 2026-11-04: secret scanning and push protection in the GitHub settings. Since F02, CI scans every push |
| RT-05 Secrets and health-related IDs in logged URLs | Major | Applied for the API's logs (F03); the rest deferred: API contract, proxy (F05) | The access log carries the matched route pattern, never the path or the query string; an unmatched request is logged with `route: null`. HTTP tests send `secret-value` and `sara@example.test` in the path, the query, `Authorization` and `Cookie` and find none of them in the captured logs |
| RT-06 Security updates suppressed or blocked | Major | Applied (F01, F02) | F01: "latest" means past the gate, and the gate is never 0; exceptions only for security fixes; there is no exception today. F02: Renovate's dashboard approval instead of `enabled: false`, so vulnerability pull requests still open; `pnpm audit --prod --audit-level=high` on every push and weekly, failing closed. The accepted minimatch advisory is moderate and lies below that gate, so it needs no ignore entry (Accepted risks) |
| RT-07 CI/CD gating | Major | Applied for CI (F02); publishing in F05 | `ci-ok`, the only required check, fails unless every job succeeded; the rulesets on `v2-planning` (U2, ADR 0009); dependency review on push and pull request. F05's `publish` needs every other job |
| RT-21 Lockfile resolved before the policies | Minor | Applied | `trustPolicy: no-downgrade` with a dated exclusion for lefthook@2.2.2 (decision 3). A from-scratch resolution with the final `pnpm-workspace.yaml` gives the committed lockfile, without release-age or trust blocks (2026-11-04). Staging by explicit paths is part of the main agent's commits |
| RT-22 `env()` in `prisma.config.ts` | Blocker | Applied (F04) | `prisma.platform.config.ts` and `prisma.practice.config.ts` read plain `process.env` (outside production after loading the root `.env`), never `env()` from `prisma/config`, which throws for an unset variable: `prisma generate` works without a database, and the migrate commands still fail fast without a URL. The root `db:generate` task declares no `env`, and CI's `quality` runs it without database variables. The same fix closes RT-46, the data-layer copy of this issue |
| RT-25 Prisma engine and OpenSSL in Docker | Blocker | Deferred: F05 | — |
| RT-27 Default branch `main` | Major | Resolved: U2, 2026-11-05 | The default branch is `v2-planning`, with a ruleset against force pushes and deletion; the ruleset that requires `ci-ok` follows after the first green `ci-ok` (ADR 0009) |
| RT-31 Contents of the migrate image | Major | Deferred: F05 | — |
| RT-32 gitleaks in the CI job | Major | Applied (F02) | The checksum-verified binary; every CI scan through `scripts/scan-secrets.ts` on `policyArguments()`, with `fetch-depth: 0` and the pin check first; the pushed range in `security`, the full history in `secrets-history`, both required through `ci-ok`; redacted SARIF only; a self-test with secrets generated at run time; the weekly scan (ADR 0009) |
| RT-36 Diverging scaffold | Major | Applied | The working-tree scaffold is the source of truth, and `engines` is `^26.13.0` |
| RT-38 `renovate.json` | Minor | Applied (F02) | Custom managers for the gitleaks version and checksum, the `*_IMAGE` pins of the workflows and the developer install lines; the Testcontainers manager follows with F04, the PGDG one with OPS02. The rule "an urgent exception goes into the same change as the fix" is part of decision 1 |
| RT-40 CI cache and triggers | Minor | Applied (F02) | A Turbo cache key per job, saved only by `quality` on push to `v2-planning`; the triggers and concurrency of ADR 0009; the gitleaks action exports `GITLEAKS_VERSION`, which `//#test:root` hashes together with `pnpm-lock.yaml` (decision 4) |
| RT-44 CRLF for `*.ps1` | Minor | Applied | `.gitattributes` and `.editorconfig` keep CRLF for `*.cmd`, `*.bat` and `*.ps1` |
| RT-47 SWC and the es2025 target | Blocker | Applied (F01, F03) | The presets keep target es2024. F03: `apps/api/.swcrc` (target es2024) is the single SWC configuration of `nest build` and Vitest, the API's tsconfig adds `lib` es2025 and `esnext.temporal`, and the smoke spec `src/app.module.spec.ts` fails when decorator metadata is missing (verified by turning it off) |
| RT-58 Coverage gates | Major | Applied for the API (F03), `@medibooker/eslint-config` and the repo scripts (F02); enforced in CI from F02 | Root-level coverage in the API's Vitest config with `include`, 80/70 and 100 % for `*.rules.ts`; `test` runs with `--coverage` and outputs `coverage/**` (decision 4). Since the F02 reviews also 90/85 for `packages/eslint-config/src` and for `scripts/lib`, with 100 % for its pure decisions (decision 8) |
| RT-62 Silent green tests | Major | Applied for lint, focused tests, empty runs and test reports; the rest deferred | `allowOnly: false` and `passWithNoTests: false` in every Vitest config (decision 8); JUnit reports in `reports/`, uploaded by CI (F02). Deferred: the quarantine helper (first app test suite), Jest rules (mobile) |
| RT-65 i18n catalogue tests | Minor | Deferred: i18n item | — |
| RT-67 Release-age gate and exact pins | Blocker | Applied | Decision 1 |
| RT-68 Environment handling in the Prisma config | Blocker | Applied (F04) | Same fix as RT-22: plain `process.env` instead of a conditional `datasource` |
| RT-73 Reconcile the scaffold | Major | Applied, except es2025 (rejected) | Reconciled, not recreated. Rejected: target es2025 in `node.json`, because SWC rejects it (RT-47); `esnext.temporal` is decided with the API (F03). README line endings and commit staging: main agent |
| RT-75 Mobile preset order | Major | Deferred: mobile item | `strict.json` already leaves `lib` and `target` to the platform presets |
| RT-78 One React copy | Major | Deferred: web and mobile items | The recommendation and the runbook are recorded above |
| RT-79 Prisma CLI in the runtime image | Major | Deferred: F05 | — |
