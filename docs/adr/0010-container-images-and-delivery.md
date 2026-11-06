# 0010. Container images and the two Docker stacks

Status: Accepted — 2026-11-06

## Context

The client wants to run the whole product through Docker from one file, with development and production kept apart. Hosting is still open (CLAUDE.md), so "production" means the production build on this machine until OPS01 chooses a platform.

## Decision

1. **Two stacks, nothing shared.** `compose.dev.yaml` (project `medibooker-dev`) and `compose.prod.yaml` (project `medibooker-prod`) have their own containers, networks and databases, and publish different ports, so both can run at once. Every port is bound to `127.0.0.1`.
2. **One control program.** `medibooker.cmd` or `medibooker.sh` start `scripts/medibooker.ts`: first the mode, then the list of actions (build, start, stop, logs, health, links, database, mail server, tests, clean-up). A direct call such as `medibooker prod up` runs one entry, for CI. It needs only Node and Docker: it imports nothing from `node_modules`, so it runs on a fresh clone.
3. **The development image holds a copy of the sources, without a bind mount.** File events do not cross a Windows bind mount, and a bind mount would hide the container's `node_modules`. `docker compose watch` syncs a change into the container instead: Next.js reloads by itself; the API container restarts, because a sync fires `nest start --watch` twice and its two restarts race for the port.
4. **The production images follow 07 §1:** `pnpm fetch` in its own layer, `pnpm deploy --prod`, no dev dependencies, no npm, user `node`. The stack runs them read-only, without capabilities, behind Caddy on `http://localhost:8080`, also the proxy as uid 1000. The proxy answers probes with 404, so the health links use the loopback ports 8081 (API) and 8082 (web). These ports publish the whole services past the proxy, so a local process could choose its own `X-Forwarded-For` and `X-Request-Id` there; OPS01 removes them. The database sits on an internal network that only the API, `migrate` and `seed` share.
5. **Secrets of the production stack:** the control program writes `.env.prod` (gitignored, mode 600) with random values on the first start and never prints them. `APP_ENV` stays `local` and `SECRET_STORE` stays `dev` until OPS01 brings a real secret store, so this stack is a faithful build, not a deployment. It has no TLS, no backups and no encrypted volume: **it must never hold real patient data.**
6. **Demo data only on request in production.** The seed is a development tool, so `seed` of the production stack uses the development image and runs only from its menu entry. Development seeds on every start; a second run changes nothing.

## Consequences

- `pnpm db:up` keeps working for tools on the host: without a profile `compose.dev.yaml` starts only the database.
- The CI job `images` starts both stacks through the control program and runs its smoke test, so the file a developer uses is the file CI proves.
- A start of the development stack builds first, because the containers hold a copy of the sources. Only what changed is rebuilt: a source change takes seconds, a lockfile change a few minutes.
- The `integration` test container gets the Docker socket, which controls Docker itself: whatever runs in it can read the secrets of the other stack and mount the disk. It starts only on request and holds no secret of its own, so it reaches about what `pnpm test:integration` on the host reaches. Never run an unreviewed branch through it.
- `medibooker-dev:local` is about 2 GB. The pnpm store stays in BuildKit cache mounts, outside the image.
- Still open for F05: publishing to GHCR, attestations, Trivy, `docker-bake.hcl` and the deploy placeholder.
