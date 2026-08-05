# Deploying

Two deployables: a Next.js app and a Node service. The API must run `npm run seed`
during its build, because the fixture data is generated rather than committed.

## The one thing that will bite you

`NEXT_PUBLIC_API_URL` is **inlined at build time**, not read at runtime. Setting it
as a runtime environment variable on the web host does nothing — the client will
keep calling whatever host the last build baked in. It has to be present when
`next build` runs.

This is also why `apps/web/playwright.config.ts` builds inside its `webServer`
command rather than assuming a prior build.

## Web — Vercel

Point the project at the repo root and set the root directory to `apps/web`.
Vercel detects the monorepo and runs the workspace install itself.

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Build command | `cd ../.. && npx turbo run build --filter=@adsight/web` |
| Install command | `npm install` (run from the repo root) |
| Output | `.next` (detected) |

Environment variable, set for **Production and Preview**:

```
NEXT_PUBLIC_API_URL = https://<your-api-host>
```

The build command goes through Turbo so the two shared packages are compiled
first. `next build` alone will fail on a clean checkout — `@adsight/types` and
`@adsight/ui` resolve to `dist/`, which does not exist until they are built.

## API — any Node host

The service needs a filesystem it can write to during build (for the fixture) and
about 250 MB of memory (18 MB of metrics as typed arrays, plus the campaign,
ad group and keyword maps).

```bash
npm install
npx turbo run build --filter=@adsight/api
npm run seed
npm run start --workspace=@adsight/api
```

`npm run seed` uses `tsx`. If your host prunes dev dependencies before the start
command, run `npm run seed:built --workspace=@adsight/api` instead — the seed
script is compiled into `dist/` precisely so a production image does not need
`tsx` at all.

### Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated. Must include the deployed web origin, or every request fails CORS. |
| `ANTHROPIC_API_KEY` | unset | Unset means the deterministic keyword planner answers. The app is fully functional without it. |
| `UPSTREAM_LATENCY_MIN_MS` / `_MAX_MS` | `8` / `45` | Simulated upstream latency. Set both to `0` for a snappier demo. |
| `BUDGET_SERVICE_FAILURE_RATE` | `0.06` | Fraction of requests where the pacing upstream fails, exercising the degraded banner. Set to `0` for a demo you do not want to explain. |
| `SEED_END_DATE` | today (UTC) | Last day of the generated window. Pin it to make the fixture byte-identical across deploys. |

### Render

`render.yaml` in the repo root is ready to apply. It sets the build command to
include the seed step and pins `SEED_END_DATE` so redeploys are reproducible.

### Docker

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm ci
RUN npx turbo run build --filter=@adsight/api
# Seed before pruning, while tsx is still installed.
RUN npm run seed
RUN npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 4000
CMD ["node", "apps/api/dist/src/index.js"]
```

## Checks after deploying

```bash
curl https://<api-host>/health
```

Should report `status: ok`, `campaigns: 10000`, the data window, and which planner
is configured. If it reports fewer than 10,000 campaigns the seed step did not run.

Then load the web app and confirm the summary bar populates. An empty table with a
"Could not reach the API" message means `NEXT_PUBLIC_API_URL` was wrong at build
time; a populated table with a CORS error in the console means `CORS_ORIGIN` on the
API does not include the web origin.
