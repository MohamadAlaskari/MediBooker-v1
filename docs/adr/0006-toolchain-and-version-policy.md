# 0006. Toolchain and version policy
Status: Accepted — 2026-11-01 (stack chosen by the user; the monorepo, database, mobile and data-fetching tools are the Proposed defaults of CLAUDE.md; tool-level choices by the architect)

History: 2026-11-01 accepted with the F01 plan (monorepo skeleton and root tooling) · 2026-11-01 amended after the red-team review of the scaffold: Node 26 only, "latest" defined by pnpm's one-day release-age gate, secret scanning that fails closed with a custom gitleaks rule, focused and disabled tests as lint errors · 2026-11-02 all versions re-checked against the gate; `trustPolicy` probed (decision 3) · 2026-11-04 amended after the F01 reviews (security, architecture, tests, DevOps): `trustPolicy: no-downgrade`, git hooks that fail closed without lefthook, a wider gitleaks rule, inline `gitleaks:allow` comments ignored, lint failing on warnings, focused tests failing every run, the centring exception of the direction guardrail, an accepted audit advisory; Vitest 5.1.0 · 2026-11-04 amended for the v1 removal (L00) and the user's decisions: the guardrail `no-legacy-imports` and the v1 entries of `.gitattributes` and `.prettierignore` removed; U1 declined, so F02 records the two v1 findings as an accepted risk; U3 before F02; U11 resolved, so the Context no longer claims client confirmation for the Proposed toolchain choices · 2026-11-04 amended after the review of the clean-up: `.gitleaksignore` named as the second way to allow a finding, pinned to the two accepted fingerprints from F02; one v1 credential with two findings; the coverage follow-up moved to F03.

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
- **Updates:** by hand until Renovate arrives (F02). Renovate waits 3 days (`minimumReleaseAge`), longer than pnpm's gate, so its pull requests never fail the install.

### 2. Runtime

- **Node.js 26.13.0**, the first 26.x LTS release (2026-10-28), is the only supported runtime for development, CI and Docker: `.node-version` is 26.13.0 and `engines.node` is `^26.13.0`. There is no Node 24 matrix: one runtime everywhere keeps local, CI and production results comparable.
- **pnpm 12.16.1** through `packageManager`, installed directly with `npm install -g pnpm@12.16.1`, not through corepack: Node 26 ships no corepack, and pnpm 11's automatic switch to the `packageManager` version fails on Windows. Without administrator rights, `npx --yes pnpm@12.16.1 <command>` works (docs/dev/windows.md).
- **Repo scripts** are TypeScript that Node runs directly (type stripping): erasable syntax only, `.ts` import extensions, `node:` built-ins, no dependencies.

### 3. Workspace (pnpm 12)

- **Members:** `apps/*` and `packages/*` only. The root package is `@medibooker/root`, because pnpm 12 lists the root in `pnpm -r ls` and every listed name must start with `@medibooker/`.
- **pnpm 12 defaults kept:** the isolated `node_modules` layout (a package can only use what it declares) and `strictDepBuilds`. Install scripts run only for packages listed in `allowBuilds`. The list has one entry, `lefthook: true`: its postinstall installs the git hooks and skips when `CI` is set. A new entry needs a reason, and it is `true` only when the package must download or build a native binary. `dangerouslyAllowAllBuilds` is never used.
- **Also not set:** `engineStrict`, `pmOnFail` and `nodeLinker`. The defaults are enough; CI enforces the runtime (F02).
- **`trustPolicy: no-downgrade`** (RT-21, turned on after the security review): pnpm refuses a version that was published with less trust than an earlier release of the same package, for example without the provenance its predecessors had. That is a typical sign of a package takeover, and F02 to F05 will add hundreds of packages.
  - One exclusion, `trustPolicyExclude: [lefthook@2.2.2]`, with a dated comment. The earlier releases we checked (2.1.4 to 2.2.1) were published by GitHub Actions through npm trusted publishing, with SLSA provenance. 2.2.2 was published from the maintainer's own npm account, without provenance.
  - The security review (2026-11-02) accepted 2.2.2. Its `postinstall.js`, `bin/index.js` and `get-exe.js` are byte-identical to 2.2.1; only the version and the list of platform packages changed. The GitHub release v2.2.2 and the ten existing platform binary packages came from the normal GitHub Actions pipeline, with provenance. Only the new `lefthook-android-arm64`, which installs on Android only, was also published by hand. The integrity hash in the lockfile matches the checked tarball, and the postinstall only runs `lefthook install` and skips in CI.
  - Verified on 2026-11-04 with from-scratch resolutions: without the exclusion pnpm stops with "High-risk trust downgrade for lefthook@2.2.2 (possible package takeover)"; with it, the resolution passes, Vitest 5.1.0 included, and gives the committed lockfile.
  - The exclusion goes when lefthook publishes with provenance again (version table).

### 4. Turborepo 2.11.10

- Tasks `build`, `lint`, `typecheck` and `test` depend on `^build`. `build` outputs `dist/**`. `test` declares no outputs until a package writes coverage: an empty `coverage/**` made Turborepo warn on every run. F03, the item that turns coverage on (RT-58), adds `coverage/**` back.
- Root tasks `//#lint:root`, `//#typecheck:root` and `//#test:root` check the repo scripts and the root config files. They list their inputs explicitly: by default a root task depends on every file outside the packages (docs, agents and skills), so it would never be cached.
  - All three include `pnpm-lock.yaml`. The root's dependency hash does not cover the dependencies of `@medibooker/eslint-config`, which the root lint loads, so a lockfile-only update would otherwise replay a stale result.
  - `//#test:root` also includes `.gitleaks.toml` and `lefthook.yml`, which its tests read. It declares `env: ["GITLEAKS_VERSION"]`: CI exports the version of the gitleaks it installs, so a gitleaks upgrade re-runs the rule test (F02). Locally, a run without gitleaks is cached with the rule cases skipped; after installing gitleaks, run `pnpm test --force` once (docs/dev/getting-started.md).
- `globalDependencies` are `.node-version` and `pnpm-workspace.yaml`; `globalEnv` is `CI` and `NODE_ENV`. Strict env mode, Turborepo 2's default, works on Windows without `globalPassThroughEnv`.
- Local cache only (`.turbo/`, gitignored). No remote cache, TUI, `dev` or `generate` task, or boundaries until something needs them.
- Verified: Turborepo reads the pnpm 12 lockfile (`lockfileVersion: '9.0'`); a second run is `FULL TURBO`; changing a rule message re-runs `//#lint:root` and `@medibooker/eslint-config#lint`.
- Turborepo sends anonymous usage data unless `TURBO_TELEMETRY_DISABLED=1` is set. The developer docs explain the opt-out, and CI sets it (F02).

### 5. TypeScript 6.0.3 and the presets (`@medibooker/tsconfig`)

- The presets contain `compilerOptions` only (no `include`, `files`, `baseUrl` or `paths`):

  | Preset | Content |
  |---|---|
  | `strict.json` | Strictness flags only (no `lib`, `target`, `module` or `types`), so platform presets such as Expo's can set them |
  | `node.json` | `strict.json` + `target` and `lib` es2024, `nodenext`, `types: ["node"]`, `noEmit` |
  | `library.json` | `node.json` + declarations and source maps from `${configDir}/src` into `${configDir}/dist`; packages build with plain `tsc` |
  | `nest.json` | `node.json` + `experimentalDecorators` and `emitDecoratorMetadata` |
  | `nextjs.json` | `strict.json` + DOM libs, bundler resolution, `jsx: preserve` and the `next` plugin |

- `exactOptionalPropertyTypes` stays off. The target stays es2024: SWC, which the API's tests will use, rejects es2025 (RT-47).
- Each preset is proven by a fixture that TypeScript 6.0.3 compiles; the `node` fixture fails when `noUncheckedIndexedAccess` is turned off. Each preset has a `$schema` key for editors.
- `react-library` and `react-native` presets come with their first consumer. Mobile will extend `strict.json` before `expo/tsconfig.base`, so that Expo's DOM lib wins (RT-75).

### 6. Linting (`@medibooker/eslint-config`)

- **ESLint 10 flat config**, with one `eslint.config.js` per package: ESLint 10 looks up the config from each linted file's directory. The package is plain ESM JavaScript with JSDoc types, checked by `tsc` (`checkJs`), without a build step.
- **Presets:**
  - `base({ tsconfigRootDir })`: `@eslint/js` recommended; typescript-eslint `strictTypeChecked` and `stylisticTypeChecked` with the project service; import-x with the TypeScript resolver (`no-duplicates`, `no-self-import`); `eqeqeq`, `no-console`, `consistent-type-imports` and `switch-exhaustiveness-check`; unused `eslint-disable` comments as errors (`reportUnusedDisableDirectives`); eslint-config-prettier last.
  - `nest()`: `import-x/no-cycle` (under ESM with decorators, an import cycle crashes at startup), `no-extraneous-class` with `allowWithDecorator`, and the clock guardrail.
  - `react()`: the colour and direction guardrails, except in tests.
  - `vitest()`: Vitest's recommended rules; focused and disabled tests are errors (decision 8); non-null assertions are allowed in tests.
- **Lint fails on any warning:** every lint script runs ESLint with `--max-warnings=0`, and stale `eslint-disable` comments are errors. A warn-level rule, such as `react-hooks/exhaustive-deps` from the later web and mobile presets, cannot slip through CI.
- **The local `medibooker` plugin** carries three guardrails for the non-negotiables in CLAUDE.md:

  | Rule | Reports | Applies to |
  |---|---|---|
  | `no-system-clock` | `new Date()` without arguments, `Date()` (returns the current time as text), `Date.now` and `Temporal.Now`; domain code gets the time from an injected Clock | `src/modules/**` of the API, except tests (`nest`) |
  | `no-hex-colors` | `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa` in JavaScript and TypeScript strings and template literals; not JSX `href` values, ids such as `#section` or HTML entities. CSS files (`globals.css`, CSS modules, Tailwind `@theme` blocks) are not checked: the web item adds a CSS check (follow-ups) | UI code (`react`) |
  | `no-physical-direction-classes` | Physical Tailwind classes, also with variants, `!` and `-`, and it names the logical replacement (`ml-2` → `ms-2`, `text-left` → `text-start`, `rounded-tl` → `rounded-ss`). `ml`, `mr`, `pl`, `pr`, `left`, `right` and the `scroll-*` forms match only with a value (`left-0`), because a bare `left` can be a variant name. Allowed: the centring idiom, `left-1/2` or `right-1/2` (also `[50%]`) with a horizontal translate in the same class list (`-translate-x-1/2`, or shadcn/ui's `left-[50%] translate-x-[-50%]`). Translate does not mirror, so `start-1/2` would put dialogs off-centre in right-to-left layouts | `className` and `class` values and the arguments of `cn`, `clsx`, `cva`, `twMerge`, `twJoin` and `tv`, also through `?:`, `&&`, `+`, arrays, objects, spreads and `as`, `satisfies` or `!` (`react`) |

  - **Dropped on 2026-11-04: `no-legacy-imports`.** It reported imports, re-exports, `import()`, `require()` and TypeScript import types whose path led into the v1 folders, in every file (`base`). The user removed v1 from the working tree on 2026-11-02 (L00): the rule guarded folders that no longer exist, and v2 shares no code with v1. Its rule test, preset test and fixture went with it, and `base()` no longer registers the plugin.
  - **Why local rules:** flat config replaces the options of a core rule instead of merging them, so a later preset's `no-restricted-syntax` or `no-restricted-imports` would silently drop an earlier guardrail. Regex selectors give false positives (`href="#add"`) and cannot name the logical class. eslint-plugin-better-tailwindcss needs Tailwind installed before the web app exists.
  - **Proven by tests:** rule tests with valid and invalid cases, plus preset tests that lint real fixture files from the checkout path with spaces. They also show that the `nest()` preset keeps a value import that dependency injection needs under `emitDecoratorMetadata`; typescript-eslint reads that option from the project service. The preset tests throw when a fixture is ignored by the presets or cannot be parsed (for example when its tsconfig does not include it), so an empty result always means that the file was linted.
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
- Longer timeouts on Windows: 60 seconds where ESLint starts a TypeScript project service, 30 seconds for script tests that start processes.

### 9. Git hooks: lefthook 2.2.2

- lefthook is a root devDependency, because the generated hooks look for it in `<repo>/node_modules/lefthook`. Its postinstall installs the hooks (`allowBuilds`) and skips when `CI` is set. CI sets `LEFTHOOK=0` and runs the checks itself.
- **The hooks fail closed too:**
  - `assert_lefthook_installed: true`. Without it, a generated hook that cannot find lefthook (for example after `node_modules` was deleted) printed "Can't find lefthook in PATH" and let the commit through without any check. Now it aborts with exit code 1, verified with a copy of the generated hook.
  - `min_version: 2.2.2`: an older lefthook that comes first on `PATH` fails instead of running the hooks.
  - `pnpm verify` starts with `scripts/check-hooks.ts` (`lefthook check-install`). It fails with an install hint when the hooks are missing or out of date, for example after lefthook's postinstall failed: that script only warns, so `pnpm install` still succeeds. With `LEFTHOOK=0` (CI) lefthook skips the check.
  - Local overrides (`lefthook-local.*`) are gitignored, because they can switch a hook off.
- Every hook command calls `node` directly, without pnpm: on Windows lefthook runs commands through Git's `sh`, where `pnpm` may resolve to a broken shim. Arguments are single-quoted, because lefthook wraps the command in double quotes on Windows.
- **commit-msg** (`scripts/check-commit-msg.ts`) enforces Conventional Commits, `<type>(<scope>)!: <summary>`:
  - the types are `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore` and `revert`;
  - the scope is optional lowercase kebab-case, checked for format only (no fixed list, so a new module needs no config change);
  - the header has at most 72 characters and no final period, and the second line is empty when a body follows;
  - headers that git writes itself (`Merge`, `Revert "`, `fixup!`, `squash!`, `amend!`) pass; comment lines and everything below the scissors line are ignored.
- **pre-commit**, in parallel: Prettier checks the staged files, and gitleaks scans the staged changes (decision 10). Known limit: Prettier reads the working-tree copy of the staged files, so a partly staged file can pass; CI's `pnpm format:check` is the gate.
- No pre-push hook: the pre-commit scan already covers every commit, and CI is the hard gate (F02). Hooks are never bypassed; `--no-verify` is not allowed.
- `pnpm verify` runs the hook check, the staged secret scan, `prettier --check .`, and then lint, typecheck and tests through Turborepo. Run it after `git add`.
- **Proven by tests:** `scripts/hooks.test.ts` runs lefthook itself. `lefthook validate` passes; `lefthook dump` shows `assert_lefthook_installed` and the unskipped `secrets` command of the pre-commit hook; `lefthook run commit-msg` rejects "update stuff" and accepts "chore(repo): add tooling", with the message file in a path with a space. It also tests `scripts/check-hooks.ts` both ways. Nothing is installed or staged.

### 10. Secret scanning: gitleaks 8.30.1, failing closed

- gitleaks is a **required** developer tool. docs/dev/getting-started.md lists the install routes for Windows, macOS and Linux, with checksum checks that stop the install when they fail.
- The pre-commit hook and `pnpm verify` run `scripts/run-gitleaks.ts`, which calls `gitleaks git --pre-commit --staged`. It **fails closed**: a missing binary, a start error or a signal blocks the commit with an install hint or a reason, and a finding keeps gitleaks' non-zero exit code. When nothing is staged (`git diff --cached --quiet`), it says that the scan checked nothing; a missing gitleaks still fails.
- **One policy for every scan** (`policyArguments()` in `scripts/lib/gitleaks.ts`): the repository's `.gitleaks.toml`, `--redact`, and `--ignore-gitleaks-allow`. An inline `gitleaks:allow` comment would otherwise silence a finding in the hook and in CI, which is the obvious way out for an agent whose commit is blocked. Only a reviewed change to `.gitleaks.toml` or `.gitleaksignore` can allow a finding: gitleaks reads `.gitleaksignore` from the scan root whatever `--gitleaks-ignore-path` says, so F02 pins it to the two accepted fingerprints. The rule test uses the same options, and CI's scans will too (F02).
- **`.gitleaks.toml`** extends the default rules (`[extend] useDefault = true`) with one rule, `medibooker-password-assignment`, because the defaults miss plain password assignments.
  - Keys: ending in `password`, `passwd`, `passphrase`, `pwd` or `secret` (any case, so also `*_PASSWORD` and `*_SECRET`), or `pass` on its own or after `_`, `.` or `-` (`SMTP_PASS`, a mail transport's `pass:`; not `bypass`). SMTP credentials arrive with the e-mail channel (ADR 0001).
  - After `=`, `:`, `:=` or `=>`, it reports a value of at least 8 characters: quoted without whitespace, also as the literal fallback of `x ?? '...'` or `x || '...'`; unquoted to the end of the line (env, YAML and ini files), where the value may contain `,` and `;` but not end with them; or the password of a connection URL (`scheme://user:<value>@host`), also with an empty user name.
  - Placeholders are allowed: `changeme`, any value that contains `example`, `<...>`, a plain variable reference `${VAR}` (also `${VAR:-}` and `${VAR:?message}`), `$VAR` and `process.env.*`; empty values are too short. A shell default with a literal value (`${VAR:-...}` in env and compose files) is reported. Code such as `password: dto.password,` is not reported.
  - Known limit: a quoted value with spaces (a passphrase in quotes) is not reported. Allowing spaces would flag the labels in the translation catalogs.
- **Proof:** `scripts/gitleaks-config.test.ts` runs the real gitleaks binary on synthetic fixtures: 18 cases that must be reported and 18 that must not, including the test file itself. One reported case carries an inline `gitleaks:allow` comment, so it proves that the scans ignore such comments. The test writes the fixtures to a temporary directory at test time. That is the simplest option: no scan of the repository ever sees them, and no allowlisted fixture path can hide a real secret. Without gitleaks, the cases skip locally with a note; with `CI=true` they fail. `scripts/lib/gitleaks.test.ts` pins the options of the staged scan (`--pre-commit`, `--staged`, `--redact`, `--ignore-gitleaks-allow` and the config path).
- **Effect:** in the git history, the default rules find nothing, and this config finds the two findings of the one v1 database credential, both in commit `0011060`. The files of the working tree (117 on 2026-11-04, after the v1 removal) give 0 findings.
- **No `.gitleaksignore` in F01.** The user declined U1 on 2026-11-04: the v1 credential is not rotated and stays valid in the public history, a risk the user accepted. F02 records the commit-qualified fingerprints of the two v1 findings in `.gitleaksignore` as that accepted risk, with a dated comment (RT-01), and pins the file: a commit-less entry would silence a finding in every commit, so the scans fail closed when `.gitleaksignore` differs from the pinned list, which starts with these two fingerprints (docs/architecture/07-docker-ci-cd.md §4, also for the rule on later entries).

### 11. Line endings and editor settings

- `.gitattributes`: `* text=auto eol=lf`. `*.cmd`, `*.bat` and `*.ps1` keep CRLF, with one pattern per line, because gitattributes has no brace expansion. Binary types are marked `binary`, and the lockfile is `linguist-generated`. Nothing was renormalized: the index was already LF.
- `.editorconfig`: UTF-8, LF, two spaces and a final newline; Markdown keeps trailing whitespace; `*.cmd`, `*.bat` and `*.ps1` use CRLF, matching `.gitattributes`.
- `.gitignore`: dependencies, caches, build output, `.env`, `.env.*` and `*.env` files (the v1 leak was `dev.env`) except `.env.example`, lefthook's local overrides, logs, OS and editor files, keys, certificates and signing material (`*.p8`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.mobileprovision`; gitleaks cannot scan binary key stores).

## Version table

Checked on 2026-11-04 at 13:42 UTC with `npm view <pkg> time dist-tags`; the gate then accepted versions published before 2026-11-03 13:42 UTC. A row without a deviation is updated when a newer version passes the gate.

| Tool | Version | Published | Deviation and reason | Revisit when |
|---|---|---|---|---|
| Node.js | 26.13.0 | 2026-10-28 | None. The first 26.x LTS release; set in `.node-version` and `engines` | — |
| pnpm | 12.16.1 | 2026-10-27 | None. 12.17.0 exists only on the `next-12` tag | — |
| `@eslint/js` | 10.0.1 | 2026-02-06 | None | — |
| `@types/node` | 26.6.6 | 2026-10-28 | None. Follows the Node major version | The Node major changes |
| `@vitest/eslint-plugin` | 1.6.28 | 2026-10-22 | None | — |
| `eslint` | 10.14.0 | 2026-10-30 | None. Framework plugins lag behind (decision 6) | — |
| `eslint-config-prettier` | 10.1.8 | 2025-07-18 | None | — |
| `eslint-import-resolver-typescript` | 4.4.5 | 2026-06-01 | None | — |
| `eslint-plugin-import-x` | 4.17.1 | 2026-06-28 | None | — |
| `globals` | 17.14.0 | 2026-11-01 | None. Pinned once it had passed the gate, without an exception | — |
| `lefthook` | 2.2.2 | 2026-10-13 | None. The npm package was published without provenance; accepted by the security review, with a dated `trustPolicyExclude` entry (decision 3) | The next release: check that it has provenance again, then remove the exclusion |
| `prettier` | 3.9.10 | 2026-10-10 | None. 4.0 is an alpha | — |
| `turbo` | 2.11.10 | 2026-10-20 | None | — |
| `typescript` | **6.0.3** | 2026-04-16 | **Yes.** `latest` is 7.0.2 (2026-07-08). typescript-eslint 8.72.1 requires `>=4.8.4 <6.1.0`, @nestjs/cli 12.0.11 ships TypeScript `~6.0.2`, and @nestjs/swagger 12.1.0 requires `^5.5.0 \|\| ^6.0.0`. 6.0.3 is the newest 6.x | typescript-eslint, @nestjs/cli and @nestjs/swagger support TypeScript 7 |
| `typescript-eslint` | 8.72.1 | 2026-10-26 | None | — |
| `vite` | 8.3.5 | 2026-10-21 | None. A required peer of Vitest | — |
| `vitest` | 5.1.0 | 2026-11-02 | None. Updated from 5.0.5 once 5.1.0 had passed the gate | — |
| gitleaks | 8.30.1 | 2026-03-21 | None. A binary installed on each machine, not an npm package | A new release (Renovate custom manager, RT-38) |

Recorded for later items (not in the catalog yet):

| Tool | Version | Reason | Revisit when |
|---|---|---|---|
| Prisma | 7.10.1 (2026-10-15) | npm's `latest` tag points at the prerelease 8.0.0-rc.29; 7.10.1 is the newest stable version (tag `prev`) | Prisma 8.0.0 stable has passed the gate (F04 decides) |
| Expo SDK | 58 (`expo` 58.0.22) | The newest SDK. Expo is the Proposed mobile toolchain of CLAUDE.md, not a client decision (U11) | The next SDK |
| React, React DOM | 19.3.0 | Expo SDK 58 bundles 19.3.0; npm's `latest` is 19.3.1. Recommendation: one React version in the whole workspace, enforced with pnpm `overrides`, because the shared source package `@medibooker/api-client` must not see two React copies (RT-78). The web app may use 19.3.1 only if the isolated linker keeps web and mobile apart; the web and mobile items decide and record it | The next Expo SDK |
| React Native | 0.88.1 | The Expo SDK 58 pin, also npm's `latest` | The next Expo SDK |
| NestJS, Next.js | 12, 16 | The API and web items choose the exact versions under this policy | — |

## Accepted risks

`pnpm audit` on 2026-11-04 reports one advisory. It is accepted, so that the weekly audit in F02 can ignore exactly this advisory instead of lowering its audit level.

| Advisory | Package | Where | Why accepted | Revisit when |
|---|---|---|---|---|
| GHSA-g3hv-75wg-m249, moderate (CWE-405): denial of service through glob-pattern amplification | `minimatch` 10.2.6; fixed in 11.0.1 | Lint tooling only: `eslint`, `@eslint/config-array`, typescript-eslint and `eslint-plugin-import-x`. `pnpm audit --prod` lists it too, because `@medibooker/eslint-config` declares its plugins as `dependencies` | Only lint-time glob patterns from the repository's own config reach it, never user input. All dependents accept only minimatch 9 or 10, so a pnpm override would force an untested major version under ESLint | eslint, typescript-eslint and eslint-plugin-import-x accept minimatch 11.0.1 or later |

## Consequences

**Positive:**
- One runtime and reproducible installs on Windows and Linux; the lockfile pins pnpm as well.
- Versions are as new as possible with a one-day safety margin, and exceptions follow a written rule.
- The guardrails fail lint at the offending line: the system clock in domain code, hex colours and physical directions.
- A secret is blocked before the commit exists, also when lefthook is missing, and the custom rule finds the plain password assignments that the default rules miss. Only a reviewed change to `.gitleaks.toml` or to `.gitleaksignore` (pinned from F02) can allow a finding.
- A package release with less trust than its predecessors does not install without a recorded decision.
- Focused, disabled or missing tests and lint warnings cannot make a run green.
- A second run without changes is fully cached.

**Negative:**
- Three local rules and their tests need maintenance.
- Markdown is not formatted automatically.
- Setting up Windows takes manual steps: the pnpm shims, gitleaks on `PATH`, the path-length limit.
- Every developer must install gitleaks before the first commit.
- New versions arrive one day late (three days with Renovate), and an urgent security fix needs an exception.
- TypeScript 7's faster native compiler is not available yet.
- Without gitleaks, the rule test is skipped locally; only CI enforces it.
- Quoted secrets with spaces are not detected (decision 10).
- The hooks only work on machines that ran `pnpm install`; until CI exists, nothing checks a push.

**Follow-ups:**
- **Before the F01 commit (main agent):**
  - Stage by explicit paths, never `git add -A`. L00 (the v1 removal) and R00 are committed before F01.
  - A security re-check of the review fixes listed in the history line.
- **F03 (API, before F02 since 2026-11-04):**
  - One SWC configuration for `nest build` and Vitest, with target es2024 (RT-47); `lib` es2025 and Temporal types if the API uses them; the `nest()` preset in use.
  - Coverage (RT-58): `@vitest/coverage-v8` in the catalog at Vitest's version and coverage thresholds in the API's Vitest config; the `test` task gets `coverage/**` as its output again (decision 4). CI enforces the thresholds from F02.
- **User action U3, before F02 (the user's order of 2026-11-04):** turn on GitHub secret scanning with push protection for the public repository. It is the server-side backstop for a machine without hooks, and it does not wait for CI (RT-02).
- **F02 (CI and Renovate):**
  - CI on Node 26.13.0 only, read from `.node-version`; pnpm from `packageManager`; `LEFTHOOK=0` and `TURBO_TELEMETRY_DISABLED=1`.
  - `pnpm install --frozen-lockfile`, then `pnpm format:check`, lint, typecheck and test with `CI=true`. Check out into a directory whose name contains a space (`actions/checkout` `path`), so that every push proves the path handling.
  - Install gitleaks 8.30.1 with a checksum check before `pnpm test`, which fails under `CI=true` without it, and export its version as `GITLEAKS_VERSION` (part of the `//#test:root` hash). CI's own scans: the full history, `fetch-depth: 0`, the options of `policyArguments()` (`--redact`, `--ignore-gitleaks-allow`), and only redacted SARIF uploaded (RT-32).
  - Validate every commit message of the pushed range: write `git log -1 --format=%B <sha>` to a temporary file and run `node scripts/check-commit-msg.ts <file>`. The hooks are local only, and agents push directly.
  - The `.gitleaksignore` baseline for the two v1 findings, with a dated comment that records the risk the user accepted (U1 declined on 2026-11-04, RT-01), and its pin: the two commit-qualified fingerprints as `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts`; `scripts/run-gitleaks.ts` and the CI `security` job fail closed when `.gitleaksignore` differs from them.
  - Renovate: `minimumReleaseAge` of 3 days; TypeScript held below 7; Expo-managed packages behind dashboard approval instead of `enabled: false`, so that security fixes still arrive (RT-06); `packageManager` and the lockfile updated together; the gitleaks version and checksum through a custom manager (RT-38).
  - `pnpm dedupe --check`, and a weekly `pnpm audit --prod` (RT-06): scoped to the deployable apps (for example `--filter @medibooker/api...`) instead of a lower `--audit-level`, and ignoring exactly the accepted minimatch advisory through `auditConfig.ignoreGhsas`, with a dated comment.
  - Test reports, and a failing check when a package reports 0 tests (RT-62).
- **Later items:**
  - Web item: ESLint 10-compatible Next.js and accessibility rules; Playwright files named `*.spec.ts` kept out of the `vitest()` preset's file pattern; the React version (RT-78); a hex-colour check for CSS files (for example stylelint's `color-no-hex`) that excludes the generated design-token CSS.
  - Mobile item: the tsconfig order (RT-75); Jest rules against focused and skipped tests and `passWithNoTests: false` (RT-62); React `overrides` and an SDK upgrade runbook: bump the catalog and the overrides to the new SDK's versions, run `npx expo install --fix`, and run `npx expo install --check` in CI (RT-78); EAS `credentials.json` and `credentials/` in `apps/mobile/.gitignore`.
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
- **A test that stages a synthetic secret in a temporary git repository:** a test that runs `git add` would also run inside git hooks, where an inherited `GIT_INDEX_FILE` can point it at the developer's real index. The staged scan is proven instead by its pinned options, the rule test on the same policy, and the git-mode scan of the history, which finds both v1 findings.
- **A pnpm override to minimatch 11:** forces a major version under ESLint without upstream support; the advisory is accepted instead (Accepted risks).
- **Defender exclusions for the checkout and the pnpm store:** faster installs, but no malware scanning for any third-party package. A Dev Drive keeps scanning (docs/dev/windows.md).

## Red-team issues

The red-team review of 2026-11-01 raised 25 issues that touch the root tooling. Their status in F01:

| Issue | Severity | Status | Details |
|---|---|---|---|
| RT-01 v1 credential in the public history | Blocker | Risk accepted by the user: U1 declined on 2026-11-04; baseline in F02 | The user declined to rotate the credential or decommission the database, so it stays valid in the public history. F01's rule finds both findings in the history; F02 records their commit-qualified fingerprints in `.gitleaksignore` as the accepted risk, with a dated comment, and pins the file (decision 10). The acceptance covers the credential only. Not verified: whether real people's data ever reached the v1 database (it had a public sign-up and stored contact, insurance and booking data; the seed data came from Faker). If real data is ever confirmed there, its controller assesses a breach under GDPR Art. 33/34 (notification within 72 hours of awareness); this decision does not replace that |
| RT-02 Scanning only after a secret is public | Major | Applied, with two exceptions | The pre-commit scan and `pnpm verify` fail closed, also when lefthook is missing (decision 9), inline `gitleaks:allow` comments are ignored, and gitleaks is a required tool. Rejected: a pre-push hook (see Alternatives). User action U3, before F02: secret scanning and push protection in the GitHub settings |
| RT-05 Secrets and health-related IDs in logged URLs | Major | Deferred: API (F03), API contract, proxy (F05) | — |
| RT-06 Security updates suppressed or blocked | Major | Partly applied | Applied: "latest" means past the gate, and the gate is never 0; exceptions only for security fixes; there is no exception today. Deferred to F02: Renovate approval rules, the weekly `pnpm audit --prod` with the accepted minimatch advisory ignored by its ID (Accepted risks) |
| RT-07 CI/CD gating | Major | Deferred: F02, F05 | — |
| RT-21 Lockfile resolved before the policies | Minor | Applied | `trustPolicy: no-downgrade` with a dated exclusion for lefthook@2.2.2 (decision 3). A from-scratch resolution with the final `pnpm-workspace.yaml` gives the committed lockfile, without release-age or trust blocks (2026-11-04). Staging by explicit paths is part of the main agent's commits |
| RT-22 `env()` in `prisma.config.ts` | Blocker | Deferred: F04 | — |
| RT-25 Prisma engine and OpenSSL in Docker | Blocker | Deferred: F05 | — |
| RT-27 Default branch `main` | Major | Deferred: user action before F02 | — |
| RT-31 Contents of the migrate image | Major | Deferred: F05 | — |
| RT-32 gitleaks in the CI job | Major | Deferred: F02 | — |
| RT-36 Diverging scaffold | Major | Applied | The working-tree scaffold is the source of truth, and `engines` is `^26.13.0` |
| RT-38 `renovate.json` | Minor | Deferred: F02 | The rule "an urgent exception goes into the same change as the fix" is part of decision 1 |
| RT-40 CI cache and triggers | Minor | Deferred: F02 | `//#test:root` already hashes `GITLEAKS_VERSION` and `pnpm-lock.yaml`; CI exports the variable (decision 4) |
| RT-44 CRLF for `*.ps1` | Minor | Applied | `.gitattributes` and `.editorconfig` keep CRLF for `*.cmd`, `*.bat` and `*.ps1` |
| RT-47 SWC and the es2025 target | Blocker | Applied for F01; the rest in F03 | The presets keep target es2024; the SWC alignment comes with the API |
| RT-58 Coverage gates | Major | Deferred: F03, enforced in CI from F02 | The `test` task declares no outputs until coverage is turned on (decision 4) |
| RT-62 Silent green tests | Major | Applied for lint, focused tests and empty runs; the rest deferred | `allowOnly: false` and `passWithNoTests: false` in every Vitest config (decision 8). Deferred: the quarantine helper (first app test suite), Jest rules (mobile), test reports and the 0-test check (F02) |
| RT-65 i18n catalogue tests | Minor | Deferred: i18n item | — |
| RT-67 Release-age gate and exact pins | Blocker | Applied | Decision 1 |
| RT-68 Environment handling in the Prisma config | Blocker | Deferred: F04 | — |
| RT-73 Reconcile the scaffold | Major | Applied, except es2025 (rejected) | Reconciled, not recreated. Rejected: target es2025 in `node.json`, because SWC rejects it (RT-47); `esnext.temporal` is decided with the API (F03). README line endings and commit staging: main agent |
| RT-75 Mobile preset order | Major | Deferred: mobile item | `strict.json` already leaves `lib` and `target` to the platform presets |
| RT-78 One React copy | Major | Deferred: web and mobile items | The recommendation and the runbook are recorded above |
| RT-79 Prisma CLI in the runtime image | Major | Deferred: F05 | — |
