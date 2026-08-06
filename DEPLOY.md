# Deploying to Google Cloud Run

Both services run on Cloud Run as containers. One platform, one deployment model,
and — unlike a serverless-function host — real long-lived processes, which this
app needs: campaigns created through the UI live in an in-memory array, and the
natural-language endpoint streams SSE.

## Quick version

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
./deploy/gcp-deploy.sh
```

That script does everything below in the right order and prints both URLs. The
rest of this document explains what it does and why, for when something breaks.

## The one thing that dictates the order

`NEXT_PUBLIC_API_URL` is **inlined into the client bundle at build time**, not
read at runtime. Setting it on the Cloud Run web service does nothing — the
browser will keep calling whatever host the image was built with.

So the order is fixed:

1. Deploy the API → get its URL
2. Build the web image **with that URL as a Docker build arg**
3. Deploy the web image
4. Tighten `CORS_ORIGIN` on the API to the web URL

If the API URL ever changes, the web image must be rebuilt. The web Dockerfile
fails the build outright if the arg is missing, rather than shipping a client
that silently calls `localhost`.

## Why Cloud Build and not a local `docker build`

Cloud Run runs `linux/amd64`. An Apple Silicon machine produces `arm64` images
that push and deploy without complaint, then fail to start with an exec format
error. Cloud Build is amd64 natively, so it avoids the whole class of problem.

If you do want to build locally, you must pass `--platform linux/amd64`, and it
will be slow under emulation.

## Service configuration, and why

| | API | Web |
|---|---|---|
| Memory | 512Mi | 512Mi |
| CPU | 1 | 1 |
| Min instances | 0 | 0 |
| Max instances | **1** | 2 |
| CPU boost | on | on |

**Memory** — measured working set is 134 MiB for the API and 46 MiB for the web
service under load. 512Mi leaves Node headroom above its live set; sizing to the
measurement would show up as GC pressure under traffic.

**`--max-instances=1` on the API is deliberate and not about cost.** Created
campaigns live in an in-memory array in `campaignService.ts`. With two instances,
a create can land on one and the follow-up read on the other, so the page you
were just redirected to 404s. One instance makes the behaviour identical to local.
Cloud Run's default concurrency is 80 simultaneous requests per instance, which is
far more than a demo needs.

**`--min-instances=0`** keeps it inside the free tier and scales to zero. Cold
start is a few seconds: Node boot plus reading 47 MB of fixtures (measured at
~440 ms for the read itself). `--cpu-boost` shortens it. If you are putting the
URL on a resume and want it instant, set `--min-instances=1` — but that bills for
an always-on instance, roughly $10–20/month, and is well outside the free tier.

## Environment variables

Set on the API service by the deploy script:

| Variable | Value set | Notes |
|---|---|---|
| `CORS_ORIGIN` | the web URL | Set to `*` during deploy, tightened at the end. Must include the web origin or every browser request fails. |
| `UPSTREAM_LATENCY_MIN_MS` / `_MAX_MS` | `0` / `0` | Defaults simulate upstream latency — useful in development, pointless in a demo. |
| `BUDGET_SERVICE_FAILURE_RATE` | `0` | Default 0.06 shows a "partial data" banner on ~6% of loads. Correct behaviour, but confusing to a reviewer with no context for it. |
| `PORT` | injected by Cloud Run | Do not set it. |
| `VERTEX_PROJECT_ID` | not set | Set by `ENABLE_VERTEX=1`. Presence switches the planner from keyword matching to Claude on Vertex AI. |
| `VERTEX_REGION` | `global` | Only `global` and `us-central1` carry current Claude models. |

`SEED_END_DATE` is deliberately left unset so each build regenerates the 90-day
window ending today, and the demo never shows a stale "data through" date. CI
pins it instead, where reproducibility is what matters.

### Turning on Claude via Vertex AI

There is no API key. The planner authenticates as the Cloud Run runtime service
account through Application Default Credentials, and `ENABLE_VERTEX=1` grants
that account `roles/aiplatform.user`:

```bash
ENABLE_VERTEX=1 ./deploy/gcp-deploy.sh
```

**One manual step first.** A project must be granted access to the Claude model in
Vertex AI Model Garden before the endpoint exists. Until then calls return:

```
Publisher model .../claude-opus-5 was not found or your project does not have
access to it.
```

Confirm what your project can actually reach:

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $(gcloud config get-value project)" \
  "https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models"
```

Note that a model appearing in that catalog does **not** mean the project has
access — the listing is the public catalog. The `rawPredict` 404 above is the
authoritative check.

Vertex is deliberately off by default: with it on but access not granted, every
query pays a failed round trip before falling back, which is slower than not
trying. The fallback itself is a tested path, not an outage.

**Still worth knowing:** `POST /api/ai/query` has no authentication and no rate
limit. Vertex removes the leaked-key risk but not the open-endpoint one — usage
bills to your project. Add rate limiting before advertising the URL widely.

## What the images contain

Both are multi-stage. Sizes are real, from `docker images`:

**API — 426 MB.** The first version was 1.12 GB: `npm prune --omit=dev` keeps the
production dependencies of *every* workspace, so Next, React and Recharts —
`apps/web`'s dependencies — stayed in the tree, 539 MB of `node_modules` for a
service that imports Express, GraphQL, zod and the Vertex SDK. Scoping the
install with `npm ci --omit=dev --workspace=@adsight/api` brought `node_modules`
to 21 MB. The remaining bulk is the Node base image plus 47 MB of generated
fixtures.

**Web — 455 MB.** Uses Next's `output: 'standalone'`, which traces only the
modules actually reached at runtime and copies the workspace packages in rather
than symlinking them — symlinks would dangle once the build stage is discarded.
65 MB of application tree instead of a ~600 MB workspace install.

Both run as the unprivileged `node` user.

## Verifying

```bash
curl https://<api-url>/health
```

Wants `"campaigns": 10000`. Anything less means the seed step did not run.

Then open the web URL: the summary bar should show 10,000 campaigns and about
$29M of spend.

| Symptom | Cause |
|---|---|
| Empty table, "Could not reach the API" | `NEXT_PUBLIC_API_URL` was wrong **at build time**. Rebuild the web image; changing the env var on the service does nothing. |
| Table populates, CORS error in console | `CORS_ORIGIN` on the API does not include the web origin. |
| Container fails to start, exec format error | An arm64 image on Cloud Run. Build through Cloud Build. |
| `/health` reports fewer than 10,000 campaigns | The seed step failed. `gcloud run services logs read adsight-api --region us-central1` |
| Created campaign 404s after redirect | The API is running more than one instance. Set `--max-instances=1`. |
| **A route 404s in production but works locally** | Almost certainly `.gcloudignore` or `.dockerignore` excluding its source. See below. |

### A route that 404s only in production

`.gcloudignore` and `.dockerignore` use gitignore semantics: a pattern without a
leading slash matches **any** path component with that name, at any depth.

This bit exactly once here. `.gcloudignore` contained a bare `perf` to keep the
`perf/` measurement artifacts out of the build context. It also matched
`apps/web/src/app/perf/` — the `/perf` route — so the route source never reached
Cloud Build, and the deployed site returned 404 for a page that worked perfectly
under `next start` locally. Nothing failed; the file was simply not there.

Both files now anchor it as `/perf/`. Before adding a bare directory name to
either, check whether it collides with a source path:

```bash
find apps packages -type d -name NAME | grep -v node_modules
```

To see exactly what Cloud Build will receive:

```bash
gcloud meta list-files-for-upload .
```

That command is the fastest way to confirm this class of bug — grep it for the
route you expect to be missing.

## Cost

With `--min-instances=0`, a demo with light traffic sits inside the Cloud Run free
tier (2M requests, 360k GB-seconds, 180k vCPU-seconds per month). Artifact
Registry storage for two images is a few cents a month. Cloud Build has a free
daily allowance that a handful of deploys per day stays under.

The one thing that will cost real money is `--min-instances=1`.

## Later: one origin instead of two

Two Cloud Run services means the browser makes cross-origin requests, which is
why `CORS_ORIGIN` exists and why the API URL has to be baked in at build time.
Putting both behind an external HTTPS load balancer with serverless NEGs and
path-based routing — `/api/*` to the API, everything else to the web service —
would remove both problems: same-origin requests, no CORS, and the client could
call a relative `/api` path with nothing to inline. It is more GCP configuration
than a portfolio demo warrants, but it is the correct shape for production.
