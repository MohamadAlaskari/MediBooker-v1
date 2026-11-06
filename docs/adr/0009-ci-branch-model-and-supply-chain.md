# 0009. Branch model, CI gates and supply chain
Status: Accepted — 2026-11-05

History: 2026-11-05 accepted with F02 (CI quality and security baseline), written from the built workflows, actions and scripts. U2 was applied the same day, before F02 was pushed. Amended the same day after the F02 reviews: the job `config-lint` holds the only secret (decision 9); the range and history scans see merge commits and `-diff` files and refuse a shallow clone, and the staged scan reads no `.gitattributes` (decision 4); the pin's limit (decision 5); Renovate's digest rules and the CodeQL triage after each push (decision 6); the coverage uploads (decision 7); and `scripts/ci-config.test.ts`, which checks the rules of decision 3 on every push. Amended the same day for F04 (the data layer): the F02 post-push results (decision 1 and the follow-ups), the job `integration` and its anonymous image pull (decisions 3 and 9), Renovate's Testcontainers manager, the `postgres` group and the re-resolved pins with codeql-action v4.39.3 (decision 6), and CodeQL in `ci.yml` deferred to F05 (follow-ups).

## Context

- **A public repository.** The client's v2 code lives in the public repository `MohamadAlaskari/MediBooker-v1`. The user chose to keep it public for now (D4, option A, 2026-11-04), so its code and its GitHub Actions logs are public, and it holds only synthetic data (CLAUDE.md, non-negotiable 9).
- **Direct pushes.** The main agent pushes one commit per roadmap item straight to `v2-planning` ([08](../architecture/08-roadmap.md)). The local hooks of F01 are the only check before a push, so CI is the hard gate.
- **The v1 credential.** The git history holds the v1 database credential in two findings of commit `0011060` (2024-07-13). The user declined to rotate it (U1, 2026-11-04) and accepted the risk ([09](../architecture/09-risks-and-decisions.md), risk 14). A full-history secret scan must therefore accept exactly these two findings and nothing else.
- **Repository settings, read on 2026-11-04:** the default branch was `main` (v1); there was no ruleset; secret scanning and push protection were on (U3); non-provider patterns, Dependabot alerts and the code-scanning default setup were off. Read again on 2026-11-05 after U2: default branch `v2-planning`, the ruleset of decision 1, everything else unchanged (Dependabot security updates off, code-scanning default setup `not-configured`).
- **GitHub follows the default branch:** it runs `schedule` and `workflow_dispatch` workflows only from there; Renovate reads its configuration there and opens its onboarding pull request against it; the dependency graph shows it.
- **pnpm 12's lockfile** consists of two YAML documents, which GitHub's dependency graph cannot read. Without a submitted snapshot, GitHub sees no npm dependency.
- **Pull requests from forks** get a read-only `GITHUB_TOKEN`, so SARIF uploads, the dependency submission and the dependency review fail there.
- **Verified tool facts** (2026-11-04 and 2026-11-05) behind the corrections of decision 11:
  - actionlint 1.7.12 reports `label "ubuntu-26.04" is unknown`, although the label is a GitHub-hosted runner, generally available since 2026-09-17.
  - The runner pulls the image of a `docker://` step in "Set up job", before the first step, so no login step can apply to it. The gitleaks image sets `safe.directory` only in `/root/.gitconfig`, while container actions run with `HOME=/github/home`, so `gitleaks git` there would likely stop at git's "dubious ownership" check.
  - A pinned gitleaks binary scans with the rules of its own release.
  - dependency-review-action 5.0.0 reads base and head from a `pull_request` event. For other events it needs both `base-ref` and `head-ref`; one alone fails.
  - `pnpm sbom --sbom-format spdx --lockfile-only` works without `node_modules`: SPDX 2.3 with 584 packages, each with an npm purl (2026-11-05).
  - An advanced CodeQL workflow can upload results only while the repository's default setup is off.
  - `pnpm audit --prod --audit-level=high` works in pnpm 12. `--ignore-registry-errors` would let the audit pass when the registry fails, and `pnpm audit --ignore` writes to `pnpm-workspace.yaml`.
- **Found while building F02:**
  - gitleaks 8.30.1 logs a failed `git log`, such as an invalid revision range, at level `ERR` and still exits 0 with "no leaks found", although it scanned nothing.
  - gitleaks reads `.gitleaksignore` from the scan root whatever `--gitleaks-ignore-path` says, and its lookup of the remote for links in findings logs an error for a remote URL it cannot parse.
  - A random, high-entropy test password also triggers gitleaks' built-in `generic-api-key` rule, and its global allowlist skips a value made of one repeated letter.
  - Inside a composite action, GitHub resolves `./` action references against `GITHUB_WORKSPACE`.
  - `pnpm/action-setup` 6.1.1 reads the pnpm version from `packageManager` and fails when `version` is set as well; `actions/setup-node` 7.1.0 can cache the pnpm store only once pnpm is on `PATH`.
  - Vitest 5 writes a file reporter without an `outputFile` into `<package>/.vitest/<reporter>/`.
- **Found by the F02 reviews** (each verified in throw-away repositories with values generated at run time):
  - gitleaks' repository scans read `git log -p`, which prints no diff for a merge commit and only "Binary files differ" for a path that `.gitattributes` marks `-diff` or `binary`. A secret that only a merge adds (a conflict resolution, a merge made in GitHub's web editor) or that sits in such a file passed the range and history scans. gitleaks' staged mode runs `git diff --staged` with options of its own and takes none.
  - In a shallow clone, `git log` sees only the fetched commits: with a checkout without `fetch-depth: 0`, both scans passed a secret in an earlier commit.
  - GitHub sends every secret that a job references to the runner when the job starts, and it stays in the runner's memory until the job ends. Code of any later step can read it there (the technique of the tj-actions/changed-files compromise, CVE-2025-30066), whatever `docker logout` does to docker's credential file.

## Decision

### 1. Default branch `v2-planning` (RT-27)

- `v2-planning` is the default branch. `main` keeps v1 until v2 is merged; then `main` becomes the default again. With `main` as the default, the weekly scans, the dispatch-only workflows (the deploy placeholder of F05), Renovate and the dependency-graph view would all follow v1.
- **U2, done on 2026-11-05.** The user approved it that day, and the main agent applied it before F02 was pushed: the default branch is `v2-planning`, and the ruleset `v2-planning: no force push or deletion` (id 26587882) is active on `refs/heads/v2-planning`, with the rules `deletion` and `non_fast_forward` and no bypass actors. Direct pushes stay allowed.
- What the default branch enables, from the first push of F02:
  - the `schedule` triggers of `scheduled.yml` and `codeql.yml`, and the `workflow_dispatch` trigger of `scheduled.yml` and `ci.yml`;
  - Renovate's configuration: `renovate.json` on the default branch, used once U4 installs the app;
  - the `sbom` job's snapshot under Insights → Dependency graph.
- **The `ci-ok` ruleset, a post-push step of F02, done on 2026-11-05.** After the first green `ci-ok` of the pushed F02 commit (`11a2113`, CI run 42025771881, `ci-ok` at 12:19:40Z), so that the check's context was known, the main agent added a second ruleset at about 12:21Z: `v2-planning: ci-ok required` (id 26612252). Its rule `required_status_checks` requires `ci-ok` from the GitHub Actions integration (id 15368), with `strict_required_status_checks_policy: false`; its bypass actor is `RepositoryRole` 5 (the repository admin role) with `bypass_mode: always`, and `current_user_can_bypass` reads `always`. The effective rules on `v2-planning` are now `required_status_checks`, `deletion` and `non_fast_forward`.
  - A pushed commit has no check yet, so a ruleset that requires `ci-ok` blocks direct pushes unless the pusher is a bypass actor. With the bypass, the main agent still pushes one commit per roadmap item directly, and Renovate's pull requests need a green `ci-ok`.
  - It is a separate ruleset because a bypass covers its whole ruleset: in the first one, the admin bypass would also allow force pushes and deletion.
  - Only the main agent performs such steps. Other agents never change repository settings, secrets, rulesets or apps.

### 2. Triggers and concurrency

| Workflow | Triggers | Concurrency |
|---|---|---|
| `ci.yml` | push to `v2-planning` and `main`, tags `v*`, `pull_request`, `workflow_dispatch` | group `ci-<workflow>-<ref>`; a newer run cancels an older one only for pull requests |
| `codeql.yml` | push to `v2-planning` and `main`, `pull_request`, weekly (Mondays 03:23 UTC) | none |
| `scheduled.yml` | weekly (Mondays 03:41 UTC), `workflow_dispatch` | none |

No workflow uses `pull_request_target`: it runs with a write token and the repository's secrets, while a pull request controls the code it checks.

### 3. Jobs and the one required check

- `ci.yml` runs the jobs `config-lint`, `quality`, `security`, `secrets-history`, `sbom` and, since F04, `integration` ([07 §3](../architecture/07-docker-ci-cd.md#3-github-actions) lists their steps) and `ci-ok`.
- **`integration` (F04)** runs the API's integration project (`pnpm test:integration`) after the setup action: Testcontainers starts the PostgreSQL image that `apps/api/test/integration/support/postgres-image.ts` pins by digest, with `contents: read` and `timeout-minutes: 30`. It runs repository code, so it references no secret (decision 9).
- **`ci-ok` is the only required status check.** It runs with `if: always()`, needs every other job, and fails unless every needed job's result is `success`: a failed, cancelled or skipped job fails it, and so would an empty `needs`. It has no permissions. Its job id and name stay `ci-ok`, and every new job joins its `needs` (`integration` since F04, `images` and `publish` in F05, `e2e-web` in F06).
- **Common rules** (07 §3):
  - top-level `permissions: contents: read`; a job elevates only what it needs: `security-events: write` for the SARIF uploads, `contents: write` only in `sbom`, which installs nothing;
  - `persist-credentials: false` on every checkout;
  - `runs-on: ubuntu-26.04`, never `ubuntu-latest`, which moves from 24.04 to 26.04 until 2026-11-19; `.github/actionlint.yaml` declares the label for actionlint;
  - `timeout-minutes` on every job;
  - no `${{ }}` expression inside a `run:` script: event values reach a script as environment variables. Secrets cannot appear in `if:`, so a step maps a secret to an environment variable and decides in its script;
  - a job that references a secret runs no repository or package code (decision 9).
- **Checked on every push.** `scripts/ci-config.test.ts` (part of `test:root`) parses every workflow and composite action and fails when `ci-ok` does not need every other job of `ci.yml`, when an action is not pinned to a full SHA with its `# vX.Y.Z` comment or an `*_IMAGE` not by tag and digest, on a `docker://` step, a `pull_request_target` trigger or another runner than `ubuntu-26.04`, on a job without `timeout-minutes`, on top-level permissions other than `contents: read`, on a checkout that persists credentials, on a scanning job without `fetch-depth: 0`, and when a job other than `config-lint` references a secret. It also checks that Renovate's custom managers still match the lines they move, since F04 the Testcontainers image constant too (decision 6).
- **Pull requests from forks** skip the SARIF uploads, the SBOM submission, the dependency review and CodeQL. Every scan still runs and still fails its job on a finding, so `ci-ok` keeps its meaning. The fork condition (`github.event.pull_request.head.repo.full_name == github.repository`) is written out in each `if:`, because a value in an environment variable could be overwritten through `GITHUB_ENV` by code that ran earlier.

### 4. Secret scanning

The layers are listed in [07 §4](../architecture/07-docker-ci-cd.md#4-secret-scanning): the pre-commit hook and `pnpm verify` (F01), GitHub push protection (U3), the CI jobs `security` (the pin check, the scan of the pushed commits, the self-test) and `secrets-history` (the full history), the gitleaks rule test in `quality`, the weekly scan in `scheduled.yml`, and from F05 Trivy's secret scanner in the images.

- **One binary.** CI runs gitleaks as the release binary of `.github/actions/gitleaks`, never as a container step. The action checks the archive's SHA-256 (`sha256sum --check --strict`) before it uses anything from it, checks `gitleaks version`, and exports `GITLEAKS_VERSION`, which is part of the hash of the `//#test:root` Turbo task.
- **One tool and one policy.** Every CI scan goes through `scripts/scan-secrets.ts` (`pin`, `range`, `history`, `self-test`; `--sarif <file>` for `range` and `history`). It is built on `policyArguments()` of `scripts/lib/gitleaks.ts`, the policy of the pre-commit scan as well: `--config .gitleaks.toml`, `--redact`, `--ignore-gitleaks-allow`, `--no-banner` and `--no-color`. The repository scans add `--platform none` and name the repository as the scan root and the only place of `.gitleaksignore`. No environment variable or option can move the repository root, the config or the ignore file.
- **What the repository scans see.** `range` and `history` pass two `git log` options after their revisions: `--diff-merges=first-parent`, which shows a merge commit's changes against its first parent, and `--text`, which diffs a `-diff` or `binary` file as text. Any `--log-opts` replaces gitleaks' default revisions, so `history` names them itself (`--full-history --all --diff-filter=tuxdb`). On 2026-11-05 a mirror of the GitHub repository gave exactly the two accepted findings with these options (2.59 MB scanned instead of 2.26 MB; the history has no merge commit). `first-parent` shows everything a merge adds to its first parent, so its findings include those of any narrower merge diff.
- **What the staged scan sees.** Every gitleaks run sets `GIT_ATTR_SOURCE` to the empty tree, so git reads no `.gitattributes` of the repository: the staged scan, whose `git diff` options gitleaks fixes, then diffs a `-diff` file as text too. git before 2.40 ignores the variable; on such a machine the range scan in CI is the first to catch that case.
- **Failing closed.** Every mode that reads `.gitleaksignore` checks the pin first (decision 5). `range` and `history` then refuse a shallow clone: they exit 1 unless `git rev-parse --is-shallow-repository` prints `false`, so a checkout without `fetch-depth: 0` cannot pass as a clean scan. A missing gitleaks, a start error, a signal, or a line at level `ERR` or `FTL` in gitleaks' log fails the scan with exit code 1, because gitleaks 8.30.1 logs a failed `git log` at `ERR` and still exits 0.
- **The commits of the range scan** (`scripts/lib/scan-range.ts`):
  - a pull request: from its base to its head;
  - a push: from `before` to the pushed commit;
  - a new branch or tag, whose `before` is all zeros: from `origin/v2-planning` to the pushed commit, because the commits of `v2-planning` were scanned when they were pushed there;
  - a force push (`before` is not in the clone), a manual run, a scheduled run, any other event, or any missing input: the full history of the commit under test. A missing input never skips the scan, and an empty `before` counts as missing: comparing with `origin/v2-planning` would scan nothing on a push to that branch itself.
  - Only full object names from the event reach git, so no input can become a git option.
- **Redacted SARIF only.** `security` and `secrets-history` upload the redacted SARIF of their scans to code scanning, with the categories `gitleaks-range` and `gitleaks-history`, and never from a fork's pull request. The weekly scan uploads nothing.
- **The self-test.** Two secrets are generated at run time with `node:crypto` and never written to a file or printed: an AWS access key id, and a `password = "…"` line whose low-entropy value only the custom rule `medibooker-password-assignment` can report. gitleaks must exit 1, report each case with its rule id alone, and show the value nowhere, neither in its output nor in its JSON report, which proves `--redact`. The key's characters never include `L`, so it cannot contain `FALSE`, which gitleaks' global allowlist skips.
- **Proven in throw-away repositories.** `scripts/scan-secrets.test.ts` builds git repositories whose commits hold secrets generated at run time and runs the real CLI on them: a push that adds and removes a secret (exit 1) and one that only removes it (exit 0); a `before` that the clone lacks (the full history, exit 1); the full history with a SARIF report that names the rule and never the value; a secret that only a merge commit adds; a secret in a `-diff` file; a shallow clone (exit 1 before any scan); an empty repository, where gitleaks logs the failed `git log` and exits 0 (exit 1); and the fingerprint probe of 08: a re-created `MediBooker-ApI/config/dbConfig.js` with a password on line 8 fails the pinned scan, and passes only with a commit-less entry. `scripts/run-gitleaks.test.ts` stages a secret in a `-diff` file and expects the hook to block it. The repositories get no `GIT_*` variable of the caller and no user or system git configuration, so no hook, signing or `GIT_INDEX_FILE` reaches them.

### 5. The accepted v1 fingerprints and the pin

- `.gitleaksignore` holds exactly the commit-qualified fingerprints of the two findings of the v1 credential, under a comment dated 2026-11-04 that names U1 (declined on 2026-11-04) and the rule below. A redacted full-history scan confirmed both on 2026-11-05:

  ```text
  001106047c044bbb4a21394a90a66023ce013c1a:MediBooker-ApI/config/dbConfig.js:medibooker-password-assignment:8
  001106047c044bbb4a21394a90a66023ce013c1a:MediBooker-ApI/dev.env:medibooker-password-assignment:5
  ```

- A commit-qualified fingerprint names its commit, file, rule and line, so the same secret in any other commit is reported. A commit-less entry (`file:rule:line`) would silence it in every commit, also in the staged scan.
- **The pin.** gitleaks reads the file from the scan root whatever `--gitleaks-ignore-path` says, so the file is pinned. `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts` holds the two fingerprints. The pre-commit hook, `pnpm verify` and every CI scan fail unless the file's entries are exactly these two, each once, read the way gitleaks reads them (07 §4).
- **What the pin cannot do.** It compares two files of the same commit, and a pull request runs its own scripts. A change that adds the same fingerprint to `.gitleaksignore` and to `ACCEPTED_FINGERPRINTS` passes the hook, `pnpm verify` and every CI job. The pin turns a widening into a reviewed code change, which the security-reviewer approves (pull request template, 07 §4); it cannot stop one.
- **The rule for later entries.** A live secret is never added to `.gitleaksignore`; the U1 credential is the only accepted exception. Any other finding is rotated first. If it already reached the pushed history, its commit-qualified fingerprint is then added with a dated comment that names the rotation, in a commit the security-reviewer approves, which also updates `ACCEPTED_FINGERPRINTS`. A new finding in the v1 history (the commits before L00), for example after a gitleaks upgrade or a rule change, goes to the user as a follow-up of U1 and needs a new dated user decision; so does re-recording the two U1 findings after a rule rename.

### 6. Supply chain

- **Pins.** Every action is pinned to the full commit SHA its tag points to (for an annotated tag, the commit it peels to), with a `# vX.Y.Z` comment; every image runs by tag and digest; the gitleaks binary is checked against its SHA-256. No floating tag is used. The pins of 2026-11-05 are in [01 §5](../architecture/01-repo-and-tooling.md#5-versions). F04 re-resolved every pin of `.github/` on 2026-11-05: `github/codeql-action` moved to v4.39.3 (`33d7b85da1a04171e211befe2c739303b9a4c066`, the peeled tag that `git ls-remote` shows, published 2026-11-04T16:49:20Z and past the gate at 16:49:20Z the next day) on its four lines, two in `ci.yml` and two in `codeql.yml`; the Renovate image moved to 44.215.0; the other actions, the actionlint image and gitleaks 8.30.1 were still the newest releases past the gate.
- **Renovate** (`renovate.json`, summarised in [07 §5](../architecture/07-docker-ci-cd.md#5-supply-chain); the file is the source of truth):
  - `config:best-practices`, a release age of 3 days (longer than pnpm's one-day gate, so its pull requests never fail the install), a weekly schedule, lock-file maintenance and OSV vulnerability alerts;
  - dashboard approval instead of `enabled: false` for the Expo-managed packages and for React, so that vulnerability pull requests still open; groups for related packages, where the `eslint` group leaves out `eslint-config-next` and `eslint-config-expo`, which move with `next` and the Expo SDK; automerge off;
  - digest updates of Docker images without a release age, because rebuilt images carry security patches. A new digest for an unchanged version of an action or of a release asset means a moved tag or a replaced archive, the pattern of the tj-actions/changed-files compromise, so such an update keeps the release age and needs dashboard approval (datasources `github-tags` and `github-release-attachments`);
  - regex custom managers only where something matches today: the gitleaks version and checksum of the gitleaks action (datasource `github-release-attachments`, so the two move together), the `*_IMAGE` lines of the workflows (`docker`), the two gitleaks install lines of `docs/dev/getting-started.md` (`github-releases`), and since F04 the PostgreSQL image of the integration tests: the `POSTGRES_IMAGE` constant of `apps/api/test/integration/support/postgres-image.ts` under its `// renovate: datasource=docker depName=postgres` comment, by tag and digest (`docker`). The PGDG manager comes with OPS02. `scripts/ci-config.test.ts` fails when a manager stops matching its lines (the Testcontainers constant exactly once, by tag and digest), or when the install lines name another version than the gitleaks action.
  - the group `postgres` (F04): the image of `compose.dev.yaml`, which Renovate's own docker-compose manager finds, and the Testcontainers constant move in one pull request. A local Renovate dry run (`dryRun: lookup`) found both and proposed the same tag and digest for each.
  - `ignorePaths` (F04) replaces the list of `config:best-practices`, which ignores `**/test/**` and would hide the Testcontainers constant from every manager; the other patterns of that list stay. `scripts/ci-config.test.ts` fails when an `ignorePaths` pattern matches the constant's file.
  - `config-lint` validates the file with the pinned `renovate-config-validator --strict --no-global`.
  - U4, installing the Renovate app, comes only after U2: before U2, Renovate would have onboarded against `main`.
- **Audit.** `pnpm audit --prod --audit-level=high` runs over the whole workspace in `security` (every push and pull request) and weekly in `scheduled.yml`. It reads only the lockfile and fails closed: no `--ignore-registry-errors`, and `pnpm audit --ignore` never runs in CI. The one accepted advisory, the moderate minimatch one of ADR 0006, lies below this gate.
- **Dependency graph and review.** The `sbom` job writes an SPDX SBOM from the lockfile without an install (`pnpm sbom --sbom-format spdx --lockfile-only`), so the only job with `contents: write` runs no package code, and submits it with `advanced-security/spdx-dependency-submission-action`. `dependency-review-action` then fails on a new high or critical advisory (`fail-on-severity: high`, `retry-on-snapshot-warnings: true`): on a pull request with the base and head from the event; on a push with `base-ref` set to `before` and `head-ref` to the pushed commit, skipped for a new branch or tag.
- **CodeQL.** An advanced workflow: `javascript-typescript` with `build-mode: none`, the `security-extended` queries and `paths-ignore: ['**/generated/**']`, skipped for pull requests from forks. The repository's default setup must stay off: enabling it later would block these uploads.
- **CodeQL alerts are triaged after each push.** `codeql.yml` is not needed by `ci-ok`, and its `analyze` step succeeds whatever it finds. Until it moves into `ci.yml` (F05, follow-ups), the main agent checks after every push, next to the green `ci-ok`, that no open alert of `v2-planning` is untriaged: `gh api "repos/MohamadAlaskari/MediBooker-v1/code-scanning/alerts?state=open&tool_name=CodeQL&ref=refs/heads/v2-planning"`. An alert on the deliberate logging probes in `apps/api/test/support` is dismissed as "used in tests" with a reason; any other alert is fixed or recorded before the next item starts.

### 7. Test reports

Every Vitest config writes a JUnit report to `reports/junit.xml` (the root, `packages/eslint-config` and `apps/api`), also locally: the report is an output of the Turbo test tasks, so a cache hit restores it. The `reports/` and `.vitest/` folders of the root and of each package are gitignored, anchored, so a source folder named `reports` is never ignored. Every Vitest config also enforces a coverage gate ([06 §8](../architecture/06-testing.md#8-coverage-gates)). `quality` uploads the reports and the coverage of the root, the packages and the apps with `if: always()` and keeps them 7 days; they hold synthetic test data only.

### 8. The scheduled scan

`scheduled.yml` scans the full history with the rules of the pinned gitleaks release (Renovate moves the pin) and runs the production audit. It reports by failing: GitHub notifies the repository owner of a failed scheduled run. It uploads no SARIF and needs no write permission; the push-time jobs upload the redacted results.

### 9. Docker Hub login (U6)

- Optional. When the repository secret `DOCKERHUB_TOKEN` (a read-only token) exists, the job `config-lint` logs in to Docker Hub with the account name from the repository variable `DOCKERHUB_USERNAME`. Without the secret it pulls anonymously; a token without the variable fails the step.
- **A job that references a secret runs no repository or package code.** GitHub sends the token to the runner when the job starts, and it stays in the runner's memory until the job ends, where code of any later step could read it, whatever `docker logout` does to docker's credential file. `config-lint` therefore runs only the checkout, the login, actionlint and the Renovate validator, each in a container that sees the read-only checkout and no token, and `docker logout` (`if: always()`). It has no setup action, no install and no repository script, and `quality` references no secret. `scripts/ci-config.test.ts` fails when another job references a secret, or when `config-lint` uses a local action or runs Node, npm, pnpm or Turbo.
- The login is a `docker login --password-stdin` step, not `docker/login-action`, which keeps the token until its post step at the end of the job.
- **Later jobs:** a job that needs a Docker Hub image pulls it anonymously or in a job like `config-lint`. F05 decides for the image builds and records its choice here.
- **F04's choice for `integration`: an anonymous pull.** Testcontainers pulls `postgres:18.6-trixie` by its digest inside test code, so `integration` references no secret, and `config-lint` stays the only job with one: `scripts/ci-config.test.ts` needed no new rule. Testcontainers' cleanup container (ryuk) is a Docker Hub image too and unpinned, so the job sets `TESTCONTAINERS_RYUK_DISABLED: 'true'`: the global teardown of the integration tests stops their container, and GitHub discards the runner after the job. Locally ryuk stays on.
- **The fallback**, should anonymous pulls hit Docker Hub's limit: a separate job that may hold `DOCKERHUB_TOKEN` and runs no repository code pulls the image by digest, saves it (`docker save`) as an artifact, and `integration` loads it (`docker load`) before the tests. `scripts/ci-config.test.ts` then gets a rule for a second job with a secret.

### 10. Visibility and processors (D4)

- The repository stays public for now (D4, option A, decided by the user on 2026-11-04). It is revisited before the first real practice data, at the latest before OPS01; the recommendation is option C ([09 D4](../architecture/09-risks-and-decisions.md#d4-repository-home-and-visibility)).
- GitHub processes the code, the CI logs, the test-report artifacts, the redacted SARIF results and the SBOM snapshot. Renovate, a hosted GitHub App, reads the repository and dependency metadata to update dependencies. Neither receives patient data: the repository and its CI hold synthetic data only, CI logs are public while D4 stays at option A, and production logs never reach GitHub ([07 §6](../architecture/07-docker-ci-cd.md#6-image-publishing-and-the-deploy-placeholder)). Both are in the DPO's register of processors ([09 D10](../architecture/09-risks-and-decisions.md#d10-providers-and-processors)).

### 11. Corrections to 07

F02 corrected 07 §3 to §5 where the plan of R00 did not match the tools:

| # | Correction | Fact |
|---|---|---|
| 1 | `.github/actionlint.yaml` declares `ubuntu-26.04` under `self-hosted-runner.labels`; the file goes when actionlint knows the label | actionlint 1.7.12 reports `label "ubuntu-26.04" is unknown` |
| 2 | No `docker://` steps. gitleaks runs as the checksum-verified binary of `.github/actions/gitleaks` (in the setup action, `security`, `secrets-history` and `scheduled.yml`); actionlint and the Renovate validator run with `docker run` after the optional login; Renovate's gitleaks manager uses `github-release-attachments` | The runner pulls a `docker://` image before any step, so no login applies; the gitleaks image sets `safe.directory` in `/root/.gitconfig`, while container actions run with `HOME=/github/home` |
| 3 | The weekly scan uses the rules of the pinned release, not "the newest rules" | A pinned binary carries the rules of its release; Renovate moves the pin |
| 4 | Dependency review: no refs on a pull request; on a push `base-ref` (`before`) and `head-ref` (the pushed commit), skipped when `before` is empty or all zeros; not on a manual run | Version 5.0.0 reads the refs from a `pull_request` event and needs both inputs otherwise |
| 5 | Pull requests from forks skip the SPDX submission, the dependency review and the SARIF uploads; their scans still run and fail | A fork's `GITHUB_TOKEN` is read-only |
| 6 | `sbom` runs checkout, pnpm and Node only, without an install or install scripts; the submission takes `filePath: .` and `filePattern: sbom.spdx.json`, with `contents: write` and no `id-token` | `pnpm sbom --lockfile-only` needs no `node_modules` |
| 7 | CodeQL `init` with `javascript-typescript`, `security-extended` and `paths-ignore: ['**/generated/**']`; the default setup stays off | An advanced workflow cannot upload while the default setup is on; it was not configured |
| 8 | `pnpm audit --prod --audit-level=high` without `--ignore-registry-errors`; never `pnpm audit --ignore` in CI | It works in pnpm 12; the flag would pass on a registry error; `--ignore` writes to `pnpm-workspace.yaml` |
| 9 | The range and history scans pass `--diff-merges=first-parent --text` to `git log`, and every gitleaks run sets `GIT_ATTR_SOURCE` to the empty tree (F02 reviews) | `git log -p` shows no diff for a merge commit and none for a `-diff` or `binary` file; gitleaks' staged mode takes no git options |
| 10 | The range and history scans refuse a shallow clone (F02 reviews) | In a shallow clone, `git log` sees only the fetched commits, so both scans would pass |
| 11 | The Docker Hub login, actionlint and the Renovate validator run in the job `config-lint`, not in `quality` (F02 reviews) | A secret that a job references stays in the runner's memory for the whole job |

## Consequences

**Positive:**
- Every push and pull request runs on Linux the checks of `pnpm verify` without the hooks, plus a secret scan of the pushed commits and of the full history. `ci-ok` stays one stable required check, whatever jobs later items add.
- A secret in a new commit fails CI although the v1 credential stays accepted, also when only a merge commit adds it or it sits in a `-diff` file. Widening `.gitleaksignore` needs the same change to `ACCEPTED_FINGERPRINTS` in `scripts/lib/gitleaks.ts`, a code change that the security-reviewer approves under the rule in 07 §4; CI cannot stop a commit that changes both.
- A new job that `ci-ok` does not need, a floating action tag, a persisted checkout credential or a secret in a job that runs repository code fails `quality` before anyone has to notice it.
- CI and the developer machine scan with one policy and the same scripts; a gitleaks update reruns the rule test.
- Updates arrive as reviewed pull requests with pinned, checksum-verified artifacts, and the only job with a write token runs no package code.
- Pull requests from forks cannot write to the repository, and their scans still gate.

**Negative:**
- Renovate opens many small pull requests, and moving a pin means reviewing a SHA, a digest or a checksum.
- A pull request runs its own version of the scan scripts and workflows, so a change to `scripts/`, `.gitleaks*` or `.github/` needs a careful review (pull request template).
- The weekly scan reports only through a failed run and its notification, not in code scanning.
- CodeQL alerts fail no check until CodeQL moves into `ci.yml`; until then the main agent triages them after each push (decision 6).
- The repository scans read more, because they diff binary files as text (2.59 MB instead of 2.26 MB for the full history on 2026-11-05).
- On a developer machine with git before 2.40, the staged scan still misses a secret in a `-diff` file; the range scan in CI catches it, but only after the push.
- Some behaviour only GitHub can confirm: the green `ci-ok`, the SARIF uploads, the snapshot, the cache save and restore, the optional login, CodeQL's first run (which may raise alerts on the deliberate logging probes in `apps/api/test/support`) and the first scheduled runs. The first push's dependency review compares with `f2b699e`, which has no snapshot, so expect snapshot warnings and a retry of up to 120 seconds. After the F02 push the green `ci-ok`, the SARIF uploads, the snapshot, CodeQL's first run and the first dispatched scheduled run were confirmed (follow-ups); after the F04 push the first run of `integration`, with its anonymous pull, is checked the same way.
- `integration` depends on Docker Hub's limit for anonymous pulls (decision 9 names the fallback), and without ryuk in CI a test run that crashes leaves its container until GitHub discards the runner.

**Follow-ups:**
- **U2:** done on 2026-11-05, and so is its follow-up, the `ci-ok` ruleset with the admin bypass (decision 1).
- **Post-push steps of F02 (main agent): done on 2026-11-05.**
  - `ci-ok` green on `11a2113`: CI run 42025771881, all six jobs green, `ci-ok` at 12:19:40Z.
  - The ruleset `v2-planning: ci-ok required` (id 26612252), created at about 12:21Z (decision 1).
  - The first CodeQL triage (decision 6): CodeQL on `11a2113` gave 0 results and 0 open alerts, so nothing was dismissed. Code scanning holds the analyses `CodeQL`, `gitleaks-range` and `gitleaks-history`, each with 0 results.
  - `gh workflow run scheduled.yml --ref v2-planning` (run 42026574852): `secrets` and `audit` green at 12:22Z, before the first scheduled run on Monday at 03:41 UTC.
  - The SPDX snapshot was submitted (step "Submit the SBOM to the dependency graph"), and the dependency graph's SBOM lists 1220 packages.
- **CodeQL in `ci.yml`, deferred from F04 to F05:** a job that `ci-ok` needs, with an `output:` directory on `analyze` and a step that fails when the SARIF holds any result (`jq -e '[.runs[].results[]] | length == 0'`); reviewed exceptions only as dated `query-filters` in the CodeQL config; the weekly schedule stays. 08 did not list it in F04's scope, and a job that fails on any result could turn `ci-ok` red in a way no local check reproduces; F05's scope now names it. Until then the main agent triages the alerts after each push (decision 6).
- **U4:** install the Renovate app; U2 is done, so it can follow the F02 push. Only Renovate itself proves that its custom managers move a version and its checksum or digest together; the validator checks the schema only. Its first pull request also shows which commit a pull request's snapshot names.
- **U6, optional:** the secret `DOCKERHUB_TOKEN` and the variable `DOCKERHUB_USERNAME`.
- **U12, optional:** Dependabot alerts, which read the submitted snapshot. Dependabot's version and security updates stay off; Renovate opens the update pull requests.
- **The dependency-graph acceptance item:** done on 2026-11-05: the `sbom` snapshot is under Insights → Dependency graph, with 1220 packages.
- **The commit-message check of the pushed range:** deferred (Alternatives), decided with U4 once Renovate's commit headers are known.
- **Later jobs:** F04 added `integration` to `ci-ok`'s `needs` and pulls its image anonymously (decision 9). F05 adds its jobs to the `needs` (`scripts/ci-config.test.ts` fails otherwise); a job that references a secret runs no repository or package code, so F05 pulls its images anonymously or in such a job and records the choice.
- **Optional user setting:** allowing only squash or rebase merges would keep merge commits out of `v2-planning`; the scans no longer depend on it.
- **Pins: done for F04 on 2026-11-05.** Re-checked at 11:45 UTC that day, the Renovate image had moved to 44.212.0. F04 re-resolved every pin of `.github/`: codeql-action v4.39.3 (`33d7b85da1a04171e211befe2c739303b9a4c066`, past the one-day gate at 16:49:20 UTC that day) on all four lines (two in `ci.yml`, two in `codeql.yml`), the Renovate image 44.215.0, both rows of 01 §5 updated; every other pin was still the newest release past the gate (decision 6). `.github/actionlint.yaml` goes when an actionlint release knows `ubuntu-26.04`.
- **Upstream:** consider reporting that gitleaks 8.30.1 exits 0 after a failed `git log`.

## Alternatives considered

- **`docker://` steps for gitleaks and actionlint** (the R00 plan in 07): rejected. The image is pulled before any step, so a Docker Hub login cannot apply, and `gitleaks git` in the gitleaks image would likely stop at git's ownership check (correction 2).
- **`gitleaks/gitleaks-action`:** rejected. It chooses the scanned commits and its options itself, so CI would not scan with exactly `policyArguments()` and the pin check, and it adds a third-party JavaScript action that runs with the job's token.
- **A checkout into a directory whose name contains a space** (an ADR 0006 follow-up): rejected. Inside a composite action, GitHub resolves `./` action references against `GITHUB_WORKSPACE`, so the gitleaks action nested in the setup action would break. The development machine's checkout path and the tests' temporary paths with spaces prove the path handling.
- **A CI check of every commit message in the pushed range** (an ADR 0006 follow-up): deferred. It is not in 08's F02 scope, and Renovate's commit headers can exceed 72 characters; it is decided with U4.
- **An unpinned `.gitleaksignore`:** rejected. One commit-less entry would silence a finding in every commit, and `--gitleaks-ignore-path` cannot stop gitleaks from reading the file.
- **`pull_request_target`:** rejected. It runs with a write token and the repository's secrets, while the pull request controls the code it checks.
- **A pre-pull job with the Docker Hub token for the integration image** (F04): not now. It would add a second job with a secret, an image artifact on every run and a new rule in `scripts/ci-config.test.ts`, while `integration` pulls one image per run; it stays the fallback of decision 9 if the first runs show anonymous pulls failing.
- **Ryuk in CI, pinned by digest** (F04): not chosen. The integration tests' global teardown stops their container and GitHub discards the runner, so CI needs no cleanup container; switching it off removes an unpinned image from the job instead of pinning one more.
- **`pnpm audit --ignore-registry-errors`:** rejected. An unreachable registry would pass the audit.
- **A broader audit, a lower `--audit-level` with the accepted advisory in `auditConfig.ignoreGhsas`** (the ADR 0006 plan): not needed. The moderate advisory lies below the high gate; an ignore list needs reviews of its own, and `pnpm audit --ignore` writes to `pnpm-workspace.yaml`. Moderate advisories still reach the team through Renovate's OSV alerts and, after U12, Dependabot alerts.
- **Dependabot version or security updates:** rejected. Renovate opens the update pull requests with the release-age, approval and grouping rules of 07 §5; Dependabot would open a second, ungated set. Dependabot alerts are a separate, optional setting (U12).
- **Floating tags** (`@v7`, images by tag only): rejected. A moved tag would run new code with the job's token, unreviewed.
- **CodeQL's default setup:** rejected. The advanced workflow sets the query suite, the ignored paths and the fork rule, and the two cannot run together.
- **`docker/login-action`:** not used. It keeps the token until its post step at the end of the job, after repository code has run.
- **The Docker Hub login in `quality`, before any repository code, with `docker logout` before the toolchain** (the first F02 build): rejected after the F02 security review. `docker logout` clears docker's credential file only; the token stays in the runner's memory for the whole job, and `quality` then runs package code (decision 9).
- **`--diff-merges=remerge` for merge commits:** rejected. It shows only what a merge changed beyond an automatic merge of its parents, and in the F02 security review it logged "Filename too long" errors on Windows for a deep path, which fail the scan closed. `first-parent` shows everything a merge adds to its first parent.
- **No check of the CI configuration in a test** (actionlint alone): rejected. actionlint checks syntax and expressions, but not that `ci-ok` needs every job, that checkouts drop their credentials, or that scanning jobs fetch the full history; `scripts/ci-config.test.ts` does, on every push and in `pnpm verify`.
