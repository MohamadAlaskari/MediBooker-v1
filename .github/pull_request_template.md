## What and why

<!-- What changes, and why. Name the roadmap item (docs/architecture/08-roadmap.md, for example F04) or the issue. -->

Roadmap item:

## Definition of Done

From the `feature-delivery` skill. Tick what applies; write "n/a" and the reason next to an item that does not apply.

- [ ] Acceptance criteria demonstrably met (tests, or a recorded manual check with steps)
- [ ] Lint, typecheck and all tests green, locally and in CI
- [ ] Every new endpoint tested for: no token (401), wrong role (403), another user's resource (404), own resource (200)
- [ ] No personal or health data in logs, errors, URLs, analytics, push texts or realtime payloads
- [ ] All UI strings in i18n files (`ar`, `en`); every screen checked in RTL and LTR; dates, times and numbers formatted for the locale in the practice time zone
- [ ] Accessibility checked: labels, focus, contrast, screen reader, large text
- [ ] UI matches the Figma frames; tokens only, no hard-coded colours or sizes
- [ ] Database migration reviewed; seed data updated
- [ ] Docs and ADRs updated
- [ ] Security review passed where required

A bug fix names the test that failed before the fix:

## Changes to CI and secret scanning

Only when this pull request changes `.github/`, `scripts/`, `.gitleaks.toml` or `.gitleaksignore`. A pull request runs its own version of these files, so CI cannot catch a change that weakens them (docs/architecture/07-docker-ci-cd.md §3 and §4):

- [ ] Every action is pinned to a full commit SHA with a version comment (`# vX.Y.Z`), every image by its digest, every downloaded binary by its checksum
- [ ] Top-level `permissions: contents: read`; a job elevates only the permissions that 07 §3 lists for it
- [ ] Every checkout sets `persist-credentials` to `false`
- [ ] No `pull_request_target` trigger and no `docker://` steps
- [ ] No secret in an `if:` condition, in a job-level `env:` or in a log; a job that references a secret runs no repository or package code
- [ ] `ci-ok` stays the only required check, and it needs every job
- [ ] A change to the scan scripts, `.gitleaks.toml`, `.gitleaksignore` or `ACCEPTED_FINGERPRINTS` is approved by the security-reviewer; a new `.gitleaksignore` entry follows 07 §4 (rotated first, a commit-qualified fingerprint, a dated comment, the same change to `ACCEPTED_FINGERPRINTS`)

## Data and review

- [ ] Only synthetic test data: never real patient data in code, tests, fixtures, logs, screenshots or Figma
- [ ] Security review by the `security-reviewer` where `feature-delivery` §6 requires one: the change touches auth, permissions, personal or health data, logging, realtime, files, third-party services, infrastructure (CI included) or dependencies
