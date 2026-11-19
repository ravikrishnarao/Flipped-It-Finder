# Flipit Finder Public Beta — Cloud Run Deployment Guide

## 1. Service Configuration Summary

The container (`Dockerfile`, Node.js 22) and Cloud Run service manifest (`deploy/cloudrun.service.yaml`) target:

- **Runtime**: Node.js 22 (`node server.ts`, `NODE_ENV=production`, `NODE_OPTIONS=--max-old-space-size=768`)
- **Memory**: `1 GiB` (supports ~180 MiB cold RSS, ~340 MiB constrained solve RSS, and ~724 MiB warm-LRU RSS with headroom below 1 GiB)
- **CPU**: `1 vCPU`
- **Initial Concurrency**: `1` (avoids overlapping partition-parse spikes during initial traffic)
- **Scaling**: `minScale: 0` (scale-to-zero when idle), `maxScale: 1` initially
- **Request Timeout**: `30s` (exceeds the 10-second minimum for cold partition reads)
- **Health & Readiness Probe**: `GET /api/health` on `PORT` (`8080`)
- **Proxy Trust**: `TRUST_PROXY=1` (trusts single Cloud Run front-end proxy hop for per-IP rate limiting)

## 2. Build & Deploy Commands (Manual Execution Only)

> **Do not run deployment without approval.** Update `PROJECT_ID` and `REGION` (for example `us-central1` or `asia-east1`) before running.

```bash
# 1. Authenticate & configure GCP project
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

# 2. Create Artifact Registry repository (one-time)
gcloud artifacts repositories create flipit-finder \
  --repository-format=docker \
  --location=REGION

# 3. Build & push container image via Cloud Build
gcloud builds submit \
  --tag REGION-docker.pkg.dev/PROJECT_ID/flipit-finder/flipit-finder-beta:v3.0.0-beta.1

# 4. Deploy to Cloud Run
gcloud run deploy flipit-finder-beta \
  --image REGION-docker.pkg.dev/PROJECT_ID/flipit-finder/flipit-finder-beta:v3.0.0-beta.1 \
  --region REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 30 \
  --port 8080 \
  --set-env-vars NODE_ENV=production,NODE_OPTIONS=--max-old-space-size=768,TRUST_PROXY=1
```

## 3. Free Tier Limitations & Potential Charges

Google Cloud Run includes a monthly Always Free allocation (subject to current Google Cloud pricing and billing account terms):

- **Always Free Quotas (Tier 1 regions)**: 2 million requests/month, 180,000 vCPU-seconds/month, 360,000 GiB-seconds/month, and 1 GiB/month North America outbound network egress.
- **Cold Starts & Latency**: With `min-instances=0`, scale-from-zero cold boots load Node.js and read initial JSON partitions on disk, typically adding ~0.5–1.5s to the first request after idle periods.
- **Concurrency Limit (`1`)**: Each active instance serves 1 request at a time; concurrent users trigger additional instances up to `max-instances=3` (excess concurrent burst traffic beyond instance capacity may experience queueing or HTTP 429 from in-memory per-IP limits).
- **Per-Instance Rate Limiter Scope**: The Express `BoundedIpRateLimiter` (`40 req/min` per IP) lives in process memory per container instance. If autoscaling runs multiple instances concurrently, effective per-IP throughput across instances can multiply by active instance count.
- **Possible Charges**:
  1. **Billing Account Requirement**: Cloud Run and Artifact Registry require an active billing account even for free-tier usage.
  2. **Artifact Registry Storage**: Docker images (OS + Node 22 + ~217 MB compiled lexical JSONs) exceed Artifact Registry's 0.5 GB free tier if multiple unpruned tags accumulate (~$0.10/GB-month).
  3. **Cloud Build Minutes**: Building >120 minutes/day incurs per-minute build charges.
  4. **Egress & Overage**: Traffic beyond 1 GiB/month egress, non-Tier-1 regions, or sustained compute beyond Always Free vCPU/GiB-second quotas incurs standard Cloud Run usage billing. Setting a low `max-instances` (`3`) and GCP Billing Budget alerts bounds worst-case runaway costs.
