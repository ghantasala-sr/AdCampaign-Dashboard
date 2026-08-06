# syntax=docker/dockerfile:1
#
# Web image for Cloud Run. Build from the REPO ROOT:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://adsight-api-xxxx.run.app \
#     -t adsight-web .
#
# NEXT_PUBLIC_API_URL is a BUILD ARG, not a runtime environment variable. Next
# inlines NEXT_PUBLIC_* values into the client bundle at build time, so setting
# it on the Cloud Run service does nothing — the browser would keep calling
# whatever host this build baked in. Deploy the API first, then build this with
# its URL.

FROM node:22-slim AS build
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY . .
RUN npm ci

# Must be declared after the install layer so a URL change does not invalidate
# the (slow) npm ci cache — only the build below re-runs.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Fails fast rather than shipping a client that silently calls localhost.
RUN test -n "$NEXT_PUBLIC_API_URL" || \
    (echo "ERROR: --build-arg NEXT_PUBLIC_API_URL=... is required" && exit 1)

# Turbo compiles @adsight/types and @adsight/ui first; plain `next build` here
# fails with "Module not found: @adsight/ui".
RUN npx turbo run build --filter=@adsight/web


FROM node:22-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
# Bind all interfaces; Cloud Run's health check cannot reach 127.0.0.1.
ENV HOSTNAME=0.0.0.0

USER node

# `output: 'standalone'` produces a tree containing only the modules actually
# reached at runtime, with the workspace packages copied in rather than
# symlinked — symlinks would dangle once the build stage is dropped. 65 MB here
# versus a ~600 MB full workspace install.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
# Static assets are deliberately excluded from the standalone tree; the server
# expects them at this exact path.
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 8080

CMD ["node", "apps/web/server.js"]
