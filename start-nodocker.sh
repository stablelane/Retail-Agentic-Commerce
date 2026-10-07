#!/usr/bin/env bash
# =============================================================================
# start-nodocker.sh — Start Retail Agentic Commerce without Docker infra.
#
# Same 9 services as install.sh (merchant, psp, apps-sdk, 4 NAT agents, UI,
# storefront), but skips Docker (Milvus/MinIO/Phoenix) which isn't available in this env.
# Consequences: Milvus seeding is skipped; search + recommendation agents run
# degraded (no vector retrieval) until Milvus is provided.
#
# Services are detached (survive shell exit). Logs: logs/<service>.log
# Stop: ./stop.sh  (reads .local-dev.pids, same format as install.sh)
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.local-dev.pids"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/logs"
ENV_FILE="$ROOT_DIR/.env"
ROOT_VENV="$ROOT_DIR/.venv"
AGENTS_DIR="$ROOT_DIR/src/agents"
AGENTS_VENV="$AGENTS_DIR/.venv"
UI_DIR="$ROOT_DIR/src/ui"
STOREFRONT_DIR="$ROOT_DIR/src/storefront"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
info() { printf "${CYAN}[INFO]${NC}  %s\n" "$1"; }
ok()   { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; }

if [ -f "$PID_FILE" ]; then
    warn "Existing .local-dev.pids found — run ./stop.sh first."
    exit 1
fi
[ -f "$ENV_FILE" ] || { echo "Missing .env (cp env.example .env)"; exit 1; }
command -v node &>/dev/null || { echo "node not on PATH (need 20.9+)"; exit 1; }
[ -x "$ROOT_DIR/.tools/bin/pnpm" ] || { echo "Missing .tools/bin/pnpm"; exit 1; }
[ -x "$ROOT_VENV/bin/uvicorn" ] || { echo "Missing root venv uvicorn"; exit 1; }
[ -x "$AGENTS_VENV/bin/nat" ] || { echo "Missing agents venv nat binary"; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${NVIDIA_API_KEY:-}" ] || [ "$NVIDIA_API_KEY" = "nvapi-xxx" ]; then
    warn "NVIDIA_API_KEY is a placeholder — agents will boot but LLM calls will fail."
    warn "Set a real key in .env and restart agents for full function."
fi

# Fan out merchant webhooks to the storefront too (process env overrides .env for the merchant)
STOREFRONT_WEBHOOK_URL="http://localhost:3002/api/webhooks/acp"
WEBHOOK_URL="${WEBHOOK_URL:-}"
case ",${WEBHOOK_URL// /}," in
    *",$STOREFRONT_WEBHOOK_URL,"*) ;;
    *) export WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:3000/api/webhooks/acp},$STOREFRONT_WEBHOOK_URL" ;;
esac

export PATH="$ROOT_DIR/.tools/bin:$PATH"
export no_proxy="localhost,127.0.0.1${no_proxy:+,$no_proxy}"
export NO_PROXY="localhost,127.0.0.1${NO_PROXY:+,$NO_PROXY}"
export NPM_CONFIG_CACHE="$ROOT_DIR/.npm-cache"
export XDG_DATA_HOME="$ROOT_DIR/.xdg-data"
export XDG_CACHE_HOME="$ROOT_DIR/.xdg-cache"
export XDG_CONFIG_HOME="$ROOT_DIR/.xdg-config"

mkdir -p "$LOG_DIR" "$RUN_DIR"
rm -f "$RUN_DIR"/*.pid

if [ ! -d "$STOREFRONT_DIR/node_modules" ]; then
    info "Installing storefront dependencies..."
    (cd "$STOREFRONT_DIR" && { pnpm install --frozen-lockfile || pnpm install; })
fi
if [ ! -f "$STOREFRONT_DIR/.env.local" ]; then
    cp "$STOREFRONT_DIR/env.example" "$STOREFRONT_DIR/.env.local"
    ok "Created src/storefront/.env.local from env.example"
fi

run_daemon() {
    local name="$1" workdir="$2"; shift 2
    export WORKDIR="$workdir" DAEMON_PIDFILE="$RUN_DIR/$name.pid"
    # shellcheck disable=SC2016
    setsid -f bash -c 'cd "$WORKDIR" && echo $$ > "$DAEMON_PIDFILE" && exec "$@"' _ "$@" \
        </dev/null >>"$LOG_DIR/$name.log" 2>&1
    info "  Launched $name → logs/$name.log"
}

info "Starting backend services..."
run_daemon "merchant" "$ROOT_DIR" "$ROOT_VENV/bin/uvicorn" src.merchant.main:app --host 0.0.0.0 --port 8000
run_daemon "psp" "$ROOT_DIR" "$ROOT_VENV/bin/uvicorn" src.payment.main:app --host 0.0.0.0 --port 8001
run_daemon "apps-sdk" "$ROOT_DIR" "$ROOT_VENV/bin/uvicorn" src.apps_sdk.main:app --host 0.0.0.0 --port 2091

info "Starting NAT agents..."
for spec in "promotion-agent:8002:promotion.yml" "post-purchase-agent:8003:post-purchase.yml" \
            "recommendation-agent:8004:recommendation.yml" "search-agent:8005:search.yml"; do
    name="${spec%%:*}"; rest="${spec#*:}"; port="${rest%%:*}"; cfg="${rest##*:}"
    run_daemon "$name" "$AGENTS_DIR" "$AGENTS_VENV/bin/nat" serve --config_file "configs/$cfg" --port "$port"
done

info "Starting UI..."
run_daemon "ui" "$UI_DIR" "$ROOT_DIR/.tools/bin/pnpm" dev

info "Starting storefront..."
run_daemon "storefront" "$STOREFRONT_DIR" "$ROOT_DIR/.tools/bin/pnpm" dev

sleep 3
: > "$PID_FILE"
for f in "$RUN_DIR"/*.pid; do
    name="$(basename "$f" .pid)"
    pid="$(cat "$f")"
    echo "$pid:$name" >> "$PID_FILE"
done
ok "PID file written ($PID_FILE)"

info "Waiting 20s for startup, then health checks..."
sleep 20
printf "\n${BOLD}%-22s %-6s %-8s${NC}\n" "SERVICE" "PORT" "STATUS"
ALL_OK=true
i=0
for spec in "merchant:8000:/health" "psp:8001:/health" "apps-sdk:2091:/health" \
            "promotion-agent:8002:/health" "post-purchase-agent:8003:/health" \
            "recommendation-agent:8004:/health" "search-agent:8005:/health" "ui:3000:/" \
            "storefront:3002:/"; do
    name="${spec%%:*}"; rest="${spec#*:}"; port="${rest%%:*}"; path="${rest##*:}"
    status="${RED}FAIL${NC}"
    for _ in 1 2 3 4 5 6; do
        if curl -sf "http://localhost:$port$path" -o /dev/null --max-time 5 2>/dev/null; then
            status="${GREEN}OK${NC}"; break
        fi
        sleep 5
    done
    [[ "$status" == *"FAIL"* ]] && ALL_OK=false
    printf "%-22s %-6s %-8b\n" "$name" "$port" "$status"
done

printf "\n${BOLD}Access URLs:${NC}\n"
echo "  Demo UI:      http://localhost:3000"
echo "  Storefront:   http://localhost:3002"
echo "  Merchant API: http://localhost:8000/docs"
echo "  PSP:          http://localhost:8001/docs"
echo "  Apps SDK:     http://localhost:2091/docs"
$ALL_OK && ok "All services healthy" || warn "Some services failed — see logs/<service>.log"
