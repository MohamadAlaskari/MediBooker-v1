# Windows development notes

The repository is developed on Windows 11 with PowerShell and Git Bash; CI runs on Linux. Read [getting-started.md](getting-started.md) first. This page covers what is different on Windows.

## Quote the repository path

A checkout path may contain spaces and dots. Always quote it:

```powershell
Set-Location '<path to your checkout>'
```

```sh
cd "<path to your checkout>"
```

The repo scripts, git hooks and tests are verified from a checkout path with spaces and a dot.

## Long paths

Turn on long-path support in Git once:

```sh
git config --global core.longpaths true
```

Windows still limits many programs to 260 characters per path (MAX_PATH). Native Node add-ons (`.node` files) and executables inside `node_modules` fail to load when their full path is longer. In a checkout whose path is 78 characters long, the deepest native file is 222 characters long (`@unrs/resolver-binding-win32-x64-msvc`) and `lefthook.exe` is 175. Keep the checkout path under about 110 characters, and do not move it to a deeper folder. Node.js itself handles longer paths for ordinary files.

## Line endings

`core.autocrlf=true` is fine. `.gitattributes` stores text files with LF and checks them out with LF (`eol=lf` overrides `autocrlf`). Only `*.cmd`, `*.bat` and `*.ps1` files keep CRLF. `.editorconfig` tells editors to write the same line endings: LF, and CRLF for those three types.

## pnpm

**Symptom:** `pnpm` fails with "Cannot find module ...\corepack\dist\pnpm.js", or the pnpm 11 that npm installed exits with "...\node_modules\pnpm\pnpm is not recognized".

**Cause:** older Node.js versions installed corepack shims named `pnpm`, `pnpx`, `yarn` and `yarnpkg` into `C:\Program Files\nodejs`. Node.js 26 ships no corepack, so the shims are stale, and they come before npm's global folder on `PATH`. In addition, pnpm 11's automatic switch to the `packageManager` version (12.16.1) fails on Windows.

**Fix**, in two steps. Package installs never run with administrator rights: an install script would run with them too.

1. Delete the stale shims in PowerShell started as administrator, then close that window:

   ```powershell
   $nodeDir = 'C:\Program Files\nodejs'
   foreach ($name in 'pnpm', 'pnpx', 'yarn', 'yarnpkg') {
     foreach ($suffix in '', '.CMD', '.ps1') {
       Remove-Item -LiteralPath (Join-Path $nodeDir "$name$suffix") -ErrorAction SilentlyContinue
     }
   }
   ```

2. Install pnpm in a normal PowerShell window, without administrator rights:

   ```powershell
   npm install -g pnpm@12.16.1
   ```

Then open new PowerShell and Git Bash windows and check that `pnpm --version` prints `12.16.1` in both.

**Without administrator rights**, run every pnpm command through npx from the repository root:

```sh
npx --yes pnpm@12.16.1 install
npx --yes pnpm@12.16.1 verify
```

The git hooks call `node` directly, so commits work either way.

**Store location:** pnpm keeps its package store on the same drive as the project so that it can hard-link files into `node_modules` (a `.pnpm-store` folder at the root of that drive when the project is not on the system drive). `pnpm store path` shows the location and `pnpm store prune` removes packages that no project uses any more.

## Stop a dev server started in the background

In a terminal, Ctrl+C stops `pnpm dev` and everything it started. A dev server started in the background (by a script, an agent or a closed terminal) is different: `nest start --watch` runs the API in a child process, and the watcher and the API can outlive the `pnpm` and `cmd.exe` processes above them. Stop it by process id, never by a name pattern, which could hit other Node processes:

1. List the processes, without stopping anything (PowerShell):

   ```powershell
   Get-CimInstance Win32_Process |
     Where-Object { $_.CommandLine -match 'nest(\.js"?)? start|dist\\main|turbo(\.exe"?)? run dev' } |
     Select-Object ProcessId, ParentProcessId, CommandLine
   ```

2. Stop each tree you started by its exact id. Start with the topmost process of your command (for example the `npx` or `pnpm` process), then the watcher (`nest.js start --watch`) and the API (`node --enable-source-maps dist\main`) if they are still listed:

   ```powershell
   taskkill /PID <pid> /T /F
   ```

   In Git Bash, write the options with two slashes (`taskkill //PID <pid> //T //F`), because Git Bash would turn `/PID` into a path.

3. Check that the port is free: `curl.exe -s -o NUL -w '%{http_code}' http://127.0.0.1:3001/health/live` in PowerShell (where `curl` is an alias of `Invoke-WebRequest`), or `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health/live` in Git Bash, prints `000`.

## gitleaks

gitleaks is required (see [Install gitleaks](getting-started.md#install-gitleaks)). The hooks run in Git's `sh`, which uses the Windows `Path`, so after installing check `gitleaks version` in Git Bash as well as in PowerShell.

## Docker Desktop

Docker Desktop is needed since F04, the data layer: for the local database (`pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, [getting-started.md](getting-started.md#databases)) and for the integration tests (`pnpm test:integration`), whose Testcontainers start their own PostgreSQL container through Docker Desktop. Keep it running with Linux containers, its default. CI runs the integration tests on every push anyway; `pnpm test` and `pnpm verify` need no Docker.

- In Git Bash, give `docker compose exec` the option `-T` (no terminal): `docker compose exec -T db psql -U postgres -lqt`. Without it, the command asks for a terminal that Git Bash's console window may not provide, and fails.
- The compose database publishes its port on `127.0.0.1:5432` only. If another PostgreSQL already listens on port 5432 on this machine, stop it before `pnpm db:up`.
- `docker compose down -v` removes the database container with its volume; the next `pnpm db:up` starts a new cluster with the passwords of the current `.env`.

It is also needed to run actionlint and the Renovate validator locally ([getting-started.md](getting-started.md#continuous-integration)). In Git Bash, put `MSYS_NO_PATHCONV=1` in front of `docker run`. Without it, Git Bash rewrites the container paths `/repo` and `/usr/src/app` into Windows paths, and Docker stops with "the working directory 'D:/…/Git/repo' is invalid". Keep the mounted path in quotes, because it contains spaces; `"$PWD"` and its Windows form `"$(pwd -W)"` both work (checked on 2026-11-05):

```sh
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo:ro" -w /repo "$actionlint_image"
```

PowerShell needs no such setting: `docker run --rm -v "${PWD}:/repo:ro" -w /repo <image>`.

## Optional: faster installs

Microsoft Defender scans every file that pnpm and the build tools write, which slows them down. To make this faster, put the repository and its pnpm store on a Dev Drive (Windows 11). There Defender runs in performance mode: it scans files after they are opened instead of before, which is faster and still scans every file.

Do not add Defender exclusions for the repository or the pnpm store. The store holds every third-party package, and a hijacked release can carry malware (for example eslint-config-prettier 10.1.6 and 10.1.7 in July 2025, CVE-2025-54313). `allowBuilds` blocks install scripts, but not code that runs during lint or tests. The virus scanner is one of the last protections on a machine that pushes to the public repository.
