# Getting started

How to set up a development machine for the MediBooker v2 monorepo and how the repository checks work. On Windows, read [windows.md](windows.md) as well.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 26.13.0 | The only supported runtime for development, CI and Docker (`.node-version`, `engines.node` `^26.13.0`). fnm picks it up from `.node-version`. |
| pnpm | 12.16.1 | Install it directly with `npm install -g pnpm@12.16.1`, not through corepack. `packageManager` in `package.json` pins it. |
| Git | recent (tested with 2.55) | On Windows: Git for Windows, which includes Git Bash. |
| gitleaks | 8.30.1 | **Required.** The pre-commit hook and `pnpm verify` fail without it. See [Install gitleaks](#install-gitleaks). |
| Docker Desktop | current | Only from the database item on. |

### Install gitleaks

Install the release binary and check its SHA-256 checksum, or use a package manager. Afterwards, open a new terminal and run `gitleaks version`; it must print `8.30.1` (or later) in every shell you commit from, including Git Bash. If you ran `pnpm test` before, run `pnpm test --force` once: a test run without gitleaks is cached with the rule cases skipped.

**Windows** (PowerShell, as a normal user). Either `scoop install gitleaks` or `choco install gitleaks`, or the release zip. Paste the whole block at once: it stops at the first error, so a file with a wrong checksum is never installed.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $version = '8.30.1'
  $base = "https://github.com/gitleaks/gitleaks/releases/download/v$version"
  $zip = "gitleaks_${version}_windows_x64.zip"
  Invoke-WebRequest "$base/$zip" -OutFile "$env:TEMP\$zip" -UseBasicParsing
  Invoke-WebRequest "$base/gitleaks_${version}_checksums.txt" -OutFile "$env:TEMP\gitleaks_checksums.txt" -UseBasicParsing
  $expected = ((Select-String -Path "$env:TEMP\gitleaks_checksums.txt" -SimpleMatch $zip).Line -split '\s+')[0]
  $actual = (Get-FileHash "$env:TEMP\$zip" -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { throw 'Checksum mismatch: do not use this file.' }
  Expand-Archive "$env:TEMP\$zip" -DestinationPath "$env:TEMP\gitleaks-$version" -Force
  New-Item -ItemType Directory -Force "$env:USERPROFILE\.local\bin" | Out-Null
  Copy-Item "$env:TEMP\gitleaks-$version\gitleaks.exe" "$env:USERPROFILE\.local\bin\"
}
```

Then add `%USERPROFILE%\.local\bin` to your user `Path` (Settings, System, About, Advanced system settings, Environment Variables).

**macOS:** `brew install gitleaks`

**Linux** (x64; use the `linux_arm64` archive on ARM). The last three steps are chained with `&&`, so a failed checksum check stops the install:

```sh
version=8.30.1
base="https://github.com/gitleaks/gitleaks/releases/download/v$version"
curl -sSfLO "$base/gitleaks_${version}_linux_x64.tar.gz"
curl -sSfLO "$base/gitleaks_${version}_checksums.txt"
grep " gitleaks_${version}_linux_x64.tar.gz$" "gitleaks_${version}_checksums.txt" | sha256sum -c - &&
  tar -xzf "gitleaks_${version}_linux_x64.tar.gz" gitleaks &&
  install -D -m 0755 gitleaks ~/.local/bin/gitleaks
```

## Install

From the repository root:

```sh
pnpm install
```

This installs all workspace packages and, through lefthook's install script, the git hooks in `.git/hooks`. If the hooks are missing or out of date (`pnpm verify` tells you), run `pnpm exec lefthook install`.

## Local environment

The workspace has one environment file for local development: `.env` in the repository root. Create it once from the committed template:

```sh
cp .env.example .env
```

- `.env` is gitignored; never commit it. `.env.example` holds placeholders and defaults only, with one comment per variable, and is the list of every variable (rules in [02-api.md §7](../architecture/02-api.md#7-configuration)).
- Outside production the API loads the root `.env` itself (`apps/api/src/config/load-env.ts`). There is no `.env` in `apps/api`.
- With `pnpm dev`, set every value in `.env`. `pnpm dev` runs the API through Turborepo, whose strict environment mode passes only `CI` and `NODE_ENV` from your shell, so `PORT=3002 pnpm dev` or `HOST=127.0.0.1 pnpm dev` changes nothing. A value set in the shell reaches the API, and wins over `.env`, only when you start the API directly: `PORT=3002 pnpm --filter @medibooker/api dev` or `pnpm --filter @medibooker/api start`.
- The API refuses to start with an invalid environment. It prints one line per invalid variable, with the variable name and the reason, never the value, and exits with code 1. `APP_ENV` has no default: without `.env`, the API started by `pnpm dev` exits at once with `APP_ENV (invalid_value)`, and the watcher waits for a change.
- `.env.example` sets `HOST=127.0.0.1`, so the development API is not reachable from the local network.

## Run the API

```sh
pnpm dev
```

`pnpm dev` runs the Turborepo `dev` task, today only `nest start --watch` in `apps/api`: it compiles with SWC, serves on <http://localhost:3001> and restarts after every change. Check it with `curl -s localhost:3001/health/live`, which prints `{"status":"ok"}`. In Windows PowerShell, `curl` is an alias of `Invoke-WebRequest`; call the real curl there: `curl.exe -s http://localhost:3001/health/live`. Versioned routes live under `/api/v1`; every route without `@Public()` answers 401 until authentication exists. Stop it with Ctrl+C; for a server started in the background on Windows, see [windows.md](windows.md#stop-a-dev-server-started-in-the-background).

- Logs are JSON lines. For readable logs set `LOG_PRETTY=true` in `.env` (never in production).
- `pnpm build` compiles every app (`nest build` writes `apps/api/dist`); `pnpm --filter @medibooker/api start` runs the built API.
- `pnpm --filter @medibooker/api test` runs the API's unit and HTTP tests with coverage; it fails below the coverage thresholds ([06 §8](../architecture/06-testing.md#8-coverage-gates)). The HTTP tests need no Docker and no network service.

## Commands

Run every command from the repository root.

| Task | Command |
|---|---|
| Install dependencies and the git hooks | `pnpm install` |
| Install exactly from the lockfile (CI) | `pnpm install --frozen-lockfile` |
| Create the local environment file (once) | `cp .env.example .env` |
| Dev server: the API on <http://localhost:3001>, restarts on change | `pnpm dev` |
| Build | `pnpm build` |
| Lint all packages and the repo scripts | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Unit tests (Vitest) | `pnpm test` |
| API tests with coverage | `pnpm --filter @medibooker/api test` |
| Format all files | `pnpm format` |
| Check formatting only | `pnpm format:check` |
| Everything before a commit, after `git add`: hook check, secret scan of the staged changes, formatting, lint, typecheck, tests, build | `pnpm verify` |
| One package only | `pnpm --filter @medibooker/eslint-config test` |
| Ignore the Turborepo cache | `pnpm lint --force` |

The e2e and database commands arrive with the web and database items.

## Repository layout

| Path | Content |
|---|---|
| `apps/` | The applications: `api` (NestJS 12, `@medibooker/api`); web and mobile follow. |
| `packages/` | Shared packages: `@medibooker/tsconfig`, `@medibooker/eslint-config`. |
| `scripts/` | Repo scripts behind the git hooks, with their tests. Run by Node directly (TypeScript type stripping). |
| `docs/` | Product docs (`docs/product`), architecture (`docs/architecture`), decision records (`docs/adr`) and these developer docs (`docs/dev`). |

v1, the university project that v2 replaces, was removed on 2026-11-02 and is only in the git history. v2 shares no code with it.

## Commit messages

Every commit message starts with a header in the [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
<type>(<scope>)!: <summary>
```

- `type` is one of `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
- `scope` is optional, lowercase kebab-case, for example `api`, `web`, `repo` or `eslint-config`.
- `!` is optional and marks a breaking change.
- The header has at most 72 characters and does not end with a period.
- When a body follows, the second line is empty. Trailers such as `Co-Authored-By:` go at the end.

Examples:

```text
chore(repo): add tooling
feat(api)!: drop the v0 routes
fix(web): keep the practice time zone when rescheduling
docs(adr): record the toolchain and version policy
```

Headers that git writes itself are accepted as they are: `Merge ...`, `Revert "..."`, `fixup! ...`, `squash! ...` and `amend! ...`.

## Git hooks

lefthook installs these hooks (configuration in `lefthook.yml`):

| Hook | Check | What to do when it fails |
|---|---|---|
| pre-commit | Prettier checks the staged files. It never rewrites or re-stages anything. | Run `pnpm format`, review the changes and stage them. |
| pre-commit | gitleaks scans the staged changes for secrets (`scripts/run-gitleaks.ts`). It fails closed: without gitleaks, the commit is blocked. | See [Secret scanning](#secret-scanning). |
| commit-msg | The message follows the [commit convention](#commit-messages) (`scripts/check-commit-msg.ts`). | Fix the message; git keeps it in `.git/COMMIT_EDITMSG`. |

Never bypass the hooks: no `git commit --no-verify` and no `LEFTHOOK=0` on a development machine. Only CI sets `LEFTHOOK=0`, because it runs the same checks itself. The hooks call `node` directly (no pnpm), so they also work in Git's `sh` on Windows.

The hooks fail closed as well:

- When an installed hook cannot find lefthook, for example after `node_modules` was deleted, the commit stops with "Can't find lefthook in PATH" and "Operation is aborted due to lefthook settings". Run `pnpm install`, then commit again. Ignore the hint about `--no-verify` in that message.
- A lefthook older than 2.2.2 that comes first on `PATH` fails instead of running the hooks.
- `pnpm verify` first checks that the hooks are installed and match `lefthook.yml` (`scripts/check-hooks.ts`). If not, run `pnpm exec lefthook install`.
- Local overrides (`lefthook-local.yml`) are gitignored. Never use one to turn off a hook.

## Secret scanning

`.gitleaks.toml` extends the default gitleaks rules with one rule, `medibooker-password-assignment`, because the defaults miss plain password assignments. It looks at keys that end in `password`, `passwd`, `passphrase`, `pwd` or `secret` (any case, so also `DB_PASSWORD`, `JWT_SECRET` or `client_secret`), and at `pass` on its own or after `_`, `.` or `-` (`SMTP_PASS`, `auth.pass`, but not `bypass`). After `=`, `:`, `:=` or `=>`, it reports a value of at least 8 characters:

- quoted, also as the fallback in `process.env.X ?? '...'` or `config.x || '...'`;
- unquoted, running to the end of the line (env, YAML and ini files); the value may contain `,` and `;`, but not end with them;
- as the password of a connection URL, such as `scheme://user:<password>@host`, also with an empty user name (`redis://:<password>@host`).

These placeholders are allowed: `changeme`, any value that contains `example`, `<...>`, `${VAR}` (also `${VAR:-}` and `${VAR:?message}`), `$VAR`, `process.env.*` and empty values. A shell default with a literal value, such as `${VAR:-...}`, is reported. Code such as `password: dto.password,` is not reported.

Known limit: a quoted value that contains spaces, such as a passphrase in quotes, is not reported. That is on purpose, because the translation catalogs hold labels such as `"password": "Enter your password"`. Never put a secret in a file; load it from the environment.

Rules for the team:

- Configuration comes from the environment. Commit only `.env.example` files, with placeholders.
- Test data is synthetic. A synthetic password in a test or fixture contains `example` (for example `example-Passw0rd`), so the scan accepts it.
- When the scan reports a real secret, remove it from the staged changes. A secret that was ever committed or pushed must be rotated; deleting it from the history is not enough.
- Inline `gitleaks:allow` comments are ignored: every scan runs with `--ignore-gitleaks-allow`. A false positive is fixed in `.gitleaks.toml`, together with a new case in `scripts/gitleaks-config.test.ts`, in a reviewed change.

`pnpm verify` runs the same staged scan, so stage your changes first; with nothing staged it says that it checked nothing. `pnpm test` proves the rule on synthetic fixtures; without gitleaks those cases are skipped locally, and in CI they fail. After installing gitleaks, run `pnpm test --force` once, because Turborepo cached the run with the skipped cases.

## Turborepo

`pnpm lint`, `pnpm typecheck` and `pnpm test` run through Turborepo, which caches each task's result in `.turbo/` (gitignored). A second run without changes prints `FULL TURBO`. To run everything again, add `--force` (for example `pnpm test --force`).

Turborepo sends anonymous usage data to Vercel unless you opt out. Set `TURBO_TELEMETRY_DISABLED=1` in your user environment; CI sets it too.
