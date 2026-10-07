# Local Development

Use this when you want faster iteration outside the full Docker runtime. Services run on your host while infrastructure (Milvus, MinIO, Phoenix) stays in Docker.

## Quick Start

The fastest way to get running locally:

```bash
./install.sh   # install deps + start all 9 services
./stop.sh      # stop everything
```

`install.sh` handles prerequisite checks, dependency installation, environment setup, and launches all services in the background with health checks. Logs are written to `logs/<service>.log`.

`install.sh` (and `start-nodocker.sh`) append `http://localhost:3002/api/webhooks/acp` to the merchant's `WEBHOOK_URL` for the started processes when it is missing, so post-purchase webhooks reach both the Demo UI and the storefront. To run the merchant manually with fan-out, set it in `.env`:

```bash
WEBHOOK_URL=http://localhost:3000/api/webhooks/acp,http://localhost:3002/api/webhooks/acp
```

## Prerequisites

- Python 3.12+
- [uv](https://astral.sh/uv) package manager
- Node.js 20.9+ and pnpm
- Docker (for infrastructure services)
- NVIDIA API key configured in `.env`

## Infrastructure

Local development still requires the infrastructure stack running in Docker:

```bash
docker network create acp-infra-network || true
docker compose -f docker-compose.infra.yml up -d
```

## Agent Health

When running locally, agents are accessible on host ports:

```bash
curl http://localhost:8002/health   # promotion
curl http://localhost:8003/health   # post-purchase
curl http://localhost:8004/health   # recommendation
curl http://localhost:8005/health   # search
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/   # storefront
```

## Access URLs

| Service | URL |
|---------|-----|
| Demo UI | http://localhost:3000 |
| Storefront | http://localhost:3002 |
| Merchant API | http://localhost:8000/docs |
| PSP | http://localhost:8001/docs |
| Apps SDK MCP | http://localhost:2091/docs |
| Phoenix Traces | http://localhost:6006 (requires Docker infra) |
| MinIO Console | http://localhost:9001 (requires Docker infra) |

## Manual Setup

<details>
<summary>Step-by-step manual setup (without install.sh)</summary>

### 1. Start Infra in Docker

```bash
docker network create acp-infra-network || true
docker compose -f docker-compose.infra.yml up -d
```

### 2. Run Backend Services

Run each service in a separate terminal:

```bash
# Terminal 1
uv venv
source .venv/bin/activate
uv sync
uvicorn src.merchant.main:app --reload
```

```bash
# Terminal 2
source .venv/bin/activate
uvicorn src.payment.main:app --reload --port 8001
```

```bash
# Terminal 3
source .venv/bin/activate
uvicorn src.apps_sdk.main:app --reload --port 2091
```

### 3. Run NAT Agents

Run each agent in a separate terminal:

```bash
# Setup once
cd src/agents
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
```

```bash
# Terminal 4
cd src/agents
source .venv/bin/activate
nat serve --config_file configs/promotion.yml --port 8002
```

```bash
# Terminal 5
cd src/agents
source .venv/bin/activate
nat serve --config_file configs/post-purchase.yml --port 8003
```

```bash
# Terminal 6
cd src/agents
source .venv/bin/activate
nat serve --config_file configs/recommendation.yml --port 8004
```

```bash
# Terminal 7
cd src/agents
source .venv/bin/activate
nat serve --config_file configs/search.yml --port 8005
```

### 4. Run UI

```bash
cd src/ui
cp env.example .env.local
pnpm install
pnpm dev
```

Optional Apps SDK widget dev server:

```bash
cd src/apps_sdk/web
pnpm install
pnpm dev
```

### 5. Run Storefront

```bash
cd src/storefront
cp env.example .env.local   # keys/secret must match the merchant, PSP, and NIM settings
pnpm install
pnpm dev                    # port 3002
```

Server-side env: `MERCHANT_API_URL`, `MERCHANT_API_KEY`, `PSP_API_URL`, `PSP_API_KEY`, `MCP_SERVER_URL`, `WEBHOOK_SECRET`, `NVIDIA_API_KEY`, `NIM_LLM_BASE_URL`, `NIM_LLM_MODEL_NAME`, `CHAT_MAX_TOOL_STEPS`, `CHAT_LLM_TIMEOUT_MS` (see `src/storefront/env.example`).

</details>
