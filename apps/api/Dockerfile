# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b
# The production images of the API (07 §1): `runtime` serves requests, `migrate` runs the database
# tasks as one-off containers. Build context: the repository root.
ARG NODE_IMAGE=node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

FROM ${NODE_IMAGE} AS base
# OpenSSL before any install: the Prisma engines postinstall picks the native schema engine for the
# libssl it finds (debian-openssl-3.0.x on trixie).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
# pnpm 12 links its native binary in an install script: no --ignore-scripts here.
RUN npm install -g pnpm@12.16.1
ENV CI=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /repo

# Depends only on the lockfile, so this layer survives source changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM deps AS build
COPY package.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/db-migrate apps/db-migrate
RUN pnpm install --offline --frozen-lockfile \
      --filter '@medibooker/api...' --filter '@medibooker/db-migrate'
RUN pnpm --filter @medibooker/api db:generate \
 && pnpm --filter '@medibooker/api...' run build
RUN pnpm --filter @medibooker/api deploy --prod /out/api \
 && pnpm --filter @medibooker/db-migrate deploy --prod /out/migrate \
 && find /out/migrate/node_modules -name 'schema-engine-debian-openssl-3.0.x' | grep -q .

FROM ${NODE_IMAGE} AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api /app
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=5s --timeout=3s --retries=12 --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health/live').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM ${NODE_IMAGE} AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 PRISMA_ROOT=/app/schema
WORKDIR /app
COPY --from=build /out/migrate /app
COPY apps/api/prisma/platform /app/schema/prisma/platform
COPY apps/api/prisma/practice /app/schema/prisma/practice
COPY apps/api/prisma.platform.config.ts apps/api/prisma.practice.config.ts /app/schema/
USER node
ENTRYPOINT ["node", "src/cli.ts"]
CMD ["migrate", "all"]
