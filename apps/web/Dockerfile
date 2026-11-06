# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b
# The production image of the web app (07 §1): the Next standalone server. Every setting is read at
# run time, so one image serves every environment. Build context: the repository root.
ARG NODE_IMAGE=node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

FROM ${NODE_IMAGE} AS base
RUN npm install -g pnpm@12.16.1
ENV CI=1 NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

# Depends only on the lockfile, so this layer survives source changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM deps AS build
COPY package.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm install --offline --frozen-lockfile --filter '@medibooker/web...'
RUN NEXT_OUTPUT=standalone pnpm --filter '@medibooker/web...' run build

FROM ${NODE_IMAGE} AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone /app
COPY --from=build /repo/apps/web/.next/static /app/apps/web/.next/static
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=5s --timeout=3s --retries=12 --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
