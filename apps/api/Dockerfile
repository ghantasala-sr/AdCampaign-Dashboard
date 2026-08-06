# syntax=docker/dockerfile:1
#
# BFF image for Cloud Run. Build from the REPO ROOT, not from apps/api:
#
#   docker build -f apps/api/Dockerfile -t adsight-api .
#
# The context has to be the root because this is an npm workspace — apps/api
# depends on @adsight/types via "*", which only resolves through the root
# lockfile.

# ---------------------------------------------------------------------------
# build — compile TypeScript and generate the fixture set
# ---------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# @playwright/test is a devDependency of apps/web and downloads ~100 MB of
# browsers on install. Nothing in this image needs them.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY . .
RUN npm ci

# Turbo builds @adsight/types first; apps/api imports it from dist/.
RUN npx turbo run build --filter=@adsight/api

# Generate the fixture set. Must happen while devDependencies are present (the
# seed script runs under tsx). Without it the server throws at boot rather than
# serving an empty dashboard.
RUN npm run seed

# ---------------------------------------------------------------------------
# deps — production dependencies for the API workspace only
# ---------------------------------------------------------------------------
# A `npm prune --omit=dev` in the build stage is not enough: prune keeps the
# production dependencies of *every* workspace, so Next, React and Recharts —
# which belong to apps/web — stay in the tree. That measured at 539 MB of
# node_modules for a service that imports express, graphql, zod and the
# Anthropic SDK. Scoping the install to @adsight/api is what fixes it.
FROM node:22-slim AS deps
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Every workspace's package.json must be present or npm cannot validate the
# lockfile, even though only one workspace is being installed.
COPY package.json package-lock.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --omit=dev --workspace=@adsight/api --include-workspace-root

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-slim
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run injects PORT and expects the container to listen on it. 8080 is the
# platform default and only matters when running the image directly.
ENV PORT=8080

# Run unprivileged. The node image ships a `node` user for exactly this.
USER node

# node_modules carries a workspace symlink @adsight/types -> ../packages/types,
# so the package's dist and manifest have to be copied for it to resolve.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/packages/types/package.json ./packages/types/
COPY --from=build --chown=node:node /app/packages/types/dist ./packages/types/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/data ./apps/api/data

EXPOSE 8080

# Compiled output lands under dist/src because the seed script is compiled too.
CMD ["node", "apps/api/dist/src/index.js"]
