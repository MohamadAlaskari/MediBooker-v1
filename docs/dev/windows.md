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

## gitleaks

gitleaks is required (see [Install gitleaks](getting-started.md#install-gitleaks)). The hooks run in Git's `sh`, which uses the Windows `Path`, so after installing check `gitleaks version` in Git Bash as well as in PowerShell.

## Docker Desktop

Docker Desktop is needed from the database item on, for the local database and the integration tests. CI runs those tests on every push anyway.

## Optional: faster installs

Microsoft Defender scans every file that pnpm and the build tools write, which slows them down. To make this faster, put the repository and its pnpm store on a Dev Drive (Windows 11). There Defender runs in performance mode: it scans files after they are opened instead of before, which is faster and still scans every file.

Do not add Defender exclusions for the repository or the pnpm store. The store holds every third-party package, and a hijacked release can carry malware (for example eslint-config-prettier 10.1.6 and 10.1.7 in July 2025, CVE-2025-54313). `allowBuilds` blocks install scripts, but not code that runs during lint or tests. The virus scanner is one of the last protections on a machine that pushes to the public repository.
