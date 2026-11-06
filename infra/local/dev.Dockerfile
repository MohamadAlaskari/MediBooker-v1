# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b
# The development image of compose.dev.yaml: the whole workspace with its dev dependencies. It has
# no bind mount of the sources: compose watch syncs a change into the container, because file events
# do not cross a Windows bind mount. Build context: the repository root.
ARG NODE_IMAGE=node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

FROM ${NODE_IMAGE} AS base
# OpenSSL before any install: the Prisma engines postinstall picks the native schema engine for the
# libssl it finds. As root only this stage: compose watch and the tools write as node.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@12.16.1 \
 && mkdir /repo && chown node:node /repo
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
USER node

# Depends only on the lockfile and the manifests, so this layer survives source changes. The store
# and pnpm's cache stay in cache mounts: in a layer they would double the image.
FROM base AS deps
COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node --parents package.json apps/*/package.json packages/*/package.json ./
RUN --mount=type=cache,id=medibooker-pnpm-store,target=/pnpm-store,uid=1000,gid=1000 \
    --mount=type=cache,id=medibooker-pnpm-cache,target=/home/node/.cache/pnpm,uid=1000,gid=1000 \
    CI=1 pnpm install --frozen-lockfile --store-dir /pnpm-store

FROM deps AS dev
COPY --chown=node:node . .
RUN --mount=type=cache,id=medibooker-pnpm-store,target=/pnpm-store,uid=1000,gid=1000 \
    --mount=type=cache,id=medibooker-pnpm-cache,target=/home/node/.cache/pnpm,uid=1000,gid=1000 \
    CI=1 pnpm install --offline --frozen-lockfile --store-dir /pnpm-store
# What the apps import as built packages, and the Prisma clients.
RUN pnpm --filter @medibooker/api db:generate \
 && pnpm --filter './packages/**' --if-present run build \
 && find node_modules/.pnpm -name 'schema-engine-debian-openssl-3.0.x' | grep -q .

# The browser of the end-to-end tests, only built when they run.
FROM dev AS e2e
USER root
RUN pnpm --filter @medibooker/web exec playwright install-deps chromium
USER node
RUN pnpm --filter @medibooker/web exec playwright install chromium
