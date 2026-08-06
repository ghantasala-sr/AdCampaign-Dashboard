#!/usr/bin/env bash
#
# Deploys both services to Cloud Run, in the order the build-time API URL forces.
#
#   ./deploy/gcp-deploy.sh
#
# Run from the repo root. Requires gcloud, authenticated, with a project set:
#
#   gcloud auth login
#   gcloud config set project YOUR_PROJECT_ID
#
# Idempotent — safe to re-run to redeploy after a code change.

set -euo pipefail

REGION="${REGION:-us-central1}"
REPO="${REPO:-adsight}"
API_SERVICE="${API_SERVICE:-adsight-api}"
WEB_SERVICE="${WEB_SERVICE:-adsight-web}"

# Gemini is reached through Vertex AI using the Cloud Run service account, so
# there is no API key anywhere in this deployment.
#
# On by default: unlike Anthropic's publisher models, Gemini needs no Model
# Garden grant, so enabling the aiplatform API is the only prerequisite and it is
# handled below. Set ENABLE_VERTEX=0 to deploy with the keyword planner only.
ENABLE_VERTEX="${ENABLE_VERTEX:-1}"
# Verified region for the Gemini Flash models. `global` also works.
VERTEX_REGION="${VERTEX_REGION:-us-central1}"
# Flash keeps a query bar responsive; -lite is cheaper again.
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"

# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------
command -v gcloud >/dev/null 2>&1 || {
  echo "gcloud not found. Install: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
}

PROJECT_ID="$(gcloud config get-value project 2>/dev/null)"
if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
  echo "No project set. Run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

[[ -f package.json && -d apps/api ]] || {
  echo "Run this from the repo root." >&2
  exit 1
}

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
API_IMAGE="${REGISTRY}/api:latest"
WEB_IMAGE="${REGISTRY}/web:latest"

echo "project ${PROJECT_ID} | region ${REGION}"
echo

# --------------------------------------------------------------------------
# 1. One-time project setup
# --------------------------------------------------------------------------
echo "[1/6] Enabling APIs (no-op if already enabled)…"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  --quiet

echo "[2/6] Ensuring Artifact Registry repository '${REPO}'…"
if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="AdSight container images" \
    --quiet
else
  echo "      already exists"
fi

# --------------------------------------------------------------------------
# 2. API — must go first, because the web build needs its URL
# --------------------------------------------------------------------------
echo
echo "[3/6] Building API image (Cloud Build, ~4 min cold)…"
gcloud builds submit \
  --config deploy/cloudbuild-api.yaml \
  --substitutions="_IMAGE=${API_IMAGE}" \
  --quiet \
  .

echo
echo "[4/6] Deploying API to Cloud Run…"
# --max-instances=1 is deliberate, not a cost measure. Campaigns created through
# the UI live in an in-memory array in campaignService.ts; with more than one
# instance a create would land on one and the follow-up read on another,
# producing a 404 on the page you were just redirected to.
#
# 512Mi against a measured 134Mi working set: the fixtures load into typed arrays
# at boot, and Node wants headroom above its live set before GC pressure shows up
# as latency.
#
# --cpu-boost shortens the cold start, which reads 47MB of fixtures.
API_ENV="NODE_ENV=production,UPSTREAM_LATENCY_MIN_MS=0,UPSTREAM_LATENCY_MAX_MS=0,BUDGET_SERVICE_FAILURE_RATE=0,CORS_ORIGIN=*"

if [[ "$ENABLE_VERTEX" == "1" ]]; then
  echo "      granting the runtime service account access to Vertex AI…"
  # Cloud Run's default runtime identity is the Compute Engine default service
  # account. It needs aiplatform.user to call publisher models; the container
  # picks the credential up through Application Default Credentials, so nothing
  # is stored in the image or in an environment variable.
  RUNTIME_SA="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/aiplatform.user" \
    --condition=None \
    --quiet >/dev/null
  API_ENV="${API_ENV},VERTEX_PROJECT_ID=${PROJECT_ID},VERTEX_REGION=${VERTEX_REGION},GEMINI_MODEL=${GEMINI_MODEL}"
fi

gcloud run deploy "$API_SERVICE" \
  --image="$API_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --cpu-boost \
  --set-env-vars="$API_ENV" \
  --quiet

API_URL="$(gcloud run services describe "$API_SERVICE" --region="$REGION" --format='value(status.url)')"
echo "      API: ${API_URL}"

# --------------------------------------------------------------------------
# 3. Web — baked with the API URL from above
# --------------------------------------------------------------------------
echo
echo "[5/6] Building web image with NEXT_PUBLIC_API_URL=${API_URL} …"
gcloud builds submit \
  --config deploy/cloudbuild-web.yaml \
  --substitutions="_IMAGE=${WEB_IMAGE},_API_URL=${API_URL}" \
  --quiet \
  .

echo
echo "[6/6] Deploying web to Cloud Run…"
gcloud run deploy "$WEB_SERVICE" \
  --image="$WEB_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=2 \
  --cpu-boost \
  --quiet

WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --region="$REGION" --format='value(status.url)')"

# --------------------------------------------------------------------------
# 4. Close the CORS hole opened above
# --------------------------------------------------------------------------
echo
echo "Restricting API CORS to ${WEB_URL} …"
gcloud run services update "$API_SERVICE" \
  --region="$REGION" \
  --update-env-vars="CORS_ORIGIN=${WEB_URL}" \
  --quiet >/dev/null

# --------------------------------------------------------------------------
# 5. Verify rather than assume
# --------------------------------------------------------------------------
echo
echo "Checking API health…"
if curl -fsS --max-time 60 "${API_URL}/health" | grep -q '"campaigns":10000'; then
  echo "  ok — 10,000 campaigns served"
else
  echo "  WARNING: /health did not report 10,000 campaigns."
  echo "  The seed step may have failed. Check: gcloud run services logs read ${API_SERVICE} --region ${REGION}"
fi

echo
echo "───────────────────────────────────────────────"
echo "  Web  ${WEB_URL}"
echo "  API  ${API_URL}"
echo "───────────────────────────────────────────────"
if [[ "$ENABLE_VERTEX" == "1" ]]; then
  PLANNER="$(curl -fsS --max-time 30 "${API_URL}/api/ai/status" 2>/dev/null || echo '{}')"
  echo "Planner: ${PLANNER}"
  case "$PLANNER" in
    *'"source":"model"'*) echo "  ${GEMINI_MODEL} on Vertex AI, authenticated as the runtime service account." ;;
    *) echo "  WARNING: expected the model planner but the API reports the fallback." ;;
  esac
else
  echo "Planner: keyword fallback (ENABLE_VERTEX=0)."
fi

echo
echo "Redeploy after a code change: re-run this script."
echo "Note the web image must be rebuilt if the API URL ever changes."
