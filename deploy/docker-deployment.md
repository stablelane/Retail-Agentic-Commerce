# Docker Deployment

Full-stack deployment using Docker Compose. This is the recommended approach.

## Prerequisites

- Docker 24+
- Docker Compose v2
- NVIDIA API key ([create one](https://build.nvidia.com/settings/api-keys))

## 1. Set Environment Variables

By default the stack calls NVIDIA public NIMs hosted on `build.nvidia.com`.

**Required:**

```bash
export NVIDIA_API_KEY=<YOUR_KEY>
```

**Optional** — choose a hosted endpoint or point the stack to the local NIM containers:

```bash
# NVIDIA hosted endpoint
export NIM_LLM_MODEL_NAME=nvidia/nemotron-3.5-lightning-30b-a3b

# Local NIM containers from docker-compose-nim.yml
export NIM_LLM_BASE_URL=http://nemotron-lightning:8000/v1
export NIM_LLM_MODEL_NAME=nvidia/nemotron-3.5-lightning
export NIM_EMBED_BASE_URL=http://embedqa:8000/v1
export NIM_EMBED_MODEL_NAME=nvidia/nemotron-3-embed-1b
```

## 2. Create Shared Docker Network (one-time)

```bash
docker network create acp-infra-network || true
```

## 3. Start Infrastructure + App Stack

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.yml up --build -d
```

## 4. Verify Health

```bash
curl http://localhost/api/health
curl http://localhost/psp/health
curl http://localhost/apps-sdk/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/   # storefront, expect 200
```

Agent services also expose `/health`, but in full Docker deployment they are internal-only (not published on `localhost`).

## 5. Open the Application

- Demo UI: http://localhost
- Storefront: http://localhost:3002 (published directly; nginx keeps fronting the Demo UI)
- Phoenix traces: http://localhost:6006
- MinIO console: http://localhost:9001

### Storefront Configuration

The `storefront` service (`src/storefront/Dockerfile`, build context `src/storefront`) reaches `merchant`, `psp`, and `apps-sdk` over the Docker network and reuses `MERCHANT_API_KEY`, `PSP_API_KEY`, `WEBHOOK_SECRET`, `NVIDIA_API_KEY`, `NIM_LLM_BASE_URL`, and `NIM_LLM_MODEL_NAME` from `.env`. Without `NVIDIA_API_KEY` the chat answers through its deterministic fallback router.

Post-purchase webhooks fan out to both clients. The merchant uses `WEBHOOK_URL_DOCKER` (comma-separated), which defaults to:

```bash
WEBHOOK_URL_DOCKER=http://ui:3000/api/webhooks/acp,http://storefront:3002/api/webhooks/acp
```

If your `.env` sets `WEBHOOK_URL_DOCKER` to the UI only, add the storefront URL or the storefront will not receive notifications.

`NEXT_PUBLIC_BRAND_NAME` is baked in at build time from `BRAND_NAME` (default `Matter`); rebuild the image after changing it.

## Common Operations

### Logs and Status

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.yml ps
docker compose -f docker-compose.infra.yml -f docker-compose.yml logs -f merchant
docker compose -f docker-compose.infra.yml -f docker-compose.yml logs -f nginx
docker compose -f docker-compose.infra.yml -f docker-compose.yml logs -f storefront
```

### Agent Health (Troubleshooting)

Check from inside the merchant container:

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.yml exec merchant \
  python -c "import urllib.request as u; print('promotion', u.urlopen('http://promotion-agent:8002/health', timeout=5).status); print('post-purchase', u.urlopen('http://post-purchase-agent:8003/health', timeout=5).status); print('recommendation', u.urlopen('http://recommendation-agent:8004/health', timeout=5).status); print('search', u.urlopen('http://search-agent:8005/health', timeout=5).status)"
```

### Stop Services

```bash
# Stop app + infra containers
docker compose -f docker-compose.infra.yml -f docker-compose.yml down

# Stop and remove volumes (full reset)
docker compose -f docker-compose.infra.yml -f docker-compose.yml down -v
```

### Rebuild

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.yml build
docker compose -f docker-compose.infra.yml -f docker-compose.yml up -d
```
