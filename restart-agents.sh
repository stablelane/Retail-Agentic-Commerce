#!/usr/bin/env bash
# =============================================================================
# restart-agents.sh — (Re)start recommendation + search agents (no-docker safe).
# Kills any live ones, refreshes their .local-dev.pids lines, health-checks.
# Run from repo root AFTER Milvus is healthy and seeded.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.local-dev.pids"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/logs"
AGENTS_DIR="$ROOT_DIR/src/agents"
AGENTS_VENV="$AGENTS_DIR/.venv"

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { printf "${CYAN}[INFO]${NC}  %s\n" "$1"; }
ok()   { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }

set -a
# shellcheck disable=SC1090
source "$ROOT_DIR/.env"
set +a
export no_proxy="localhost,127.0.0.1${no_proxy:+,$no_proxy}"

mkdir -p "$LOG_DIR" "$RUN_DIR"

for spec in "recommendation-agent:8004:recommendation.yml" "search-agent:8005:search.yml"; do
    name="${spec%%:*}"; rest="${spec#*:}"; port="${rest%%:*}"; cfg="${rest##*:}"
    if [ -f "$PID_FILE" ]; then
        oldpid="$(grep ":$name\$" "$PID_FILE" | cut -d: -f1 || true)"
        if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
            kill "$oldpid" 2>/dev/null || true
            sleep 2
            kill -9 "$oldpid" 2>/dev/null || true
            info "Stopped old $name (PID $oldpid)"
        fi
        grep -v ":$name\$" "$PID_FILE" > "$PID_FILE.tmp" || true
        mv "$PID_FILE.tmp" "$PID_FILE"
    fi
    export WORKDIR="$AGENTS_DIR" DAEMON_PIDFILE="$RUN_DIR/$name.pid"
    rm -f "$DAEMON_PIDFILE"
    # shellcheck disable=SC2016
    setsid -f bash -c 'cd "$WORKDIR" && echo $$ > "$DAEMON_PIDFILE" && exec "$@"' _ \
        "$AGENTS_VENV/bin/nat" serve --config_file "configs/$cfg" --port "$port" \
        </dev/null >>"$LOG_DIR/$name.log" 2>&1
    sleep 2
    newpid="$(cat "$DAEMON_PIDFILE")"
    echo "$newpid:$name" >> "$PID_FILE"
    info "Launched $name (PID $newpid, port $port)"
done

echo ""
for spec in "recommendation-agent:8004" "search-agent:8005"; do
    name="${spec%%:*}"; port="${spec##*:}"
    status="${RED}FAIL${NC}"
    for _ in $(seq 1 12); do
        if curl -sf "http://localhost:$port/health" -o /dev/null --max-time 5 2>/dev/null; then
            status="${GREEN}OK${NC}"; break
        fi
        sleep 5
    done
    printf "%-22s %-6s %-8b\n" "$name" "$port" "$status"
done
ok "done (stop everything with ./stop.sh; infra needs sudo compose down)"
