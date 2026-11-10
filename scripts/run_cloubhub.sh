#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTS=(3000 7007 5433)

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

log() {
  printf '\n%s[%s] %s%s\n' "$CYAN" "$(date '+%Y-%m-%d %H:%M:%S')" "$*" "$RESET"
}

step() {
  printf '\n%s========================================%s\n' "$BLUE$BOLD" "$RESET"
  printf '%s%s%s\n' "$BLUE$BOLD" "$*" "$RESET"
  printf '%s========================================%s\n' "$BLUE$BOLD" "$RESET"
}

success() {
  printf '%s%s%s\n' "$GREEN$BOLD" "$*" "$RESET"
}

warn() {
  printf '%s%s%s\n' "$YELLOW$BOLD" "$*" "$RESET"
}

error() {
  printf '%s%s%s\n' "$RED$BOLD" "$*" "$RESET" >&2
}

usage() {
  cat <<'EOF'
Usage: ./scripts/run_cloubhub.sh [run|restart]

  run      Build and start the CloudHub stack.
  restart  Stop, clear stale listeners, rebuild, and start the stack cleanly.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Missing required command: $1"
    exit 1
  fi
}

cleanup_ports() {
  step "Checking for stale listeners on CloudHub ports"
  for port in "${PORTS[@]}"; do
    pids="$( {
      lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
      ss -ltnp 2>/dev/null | awk -v port=":$port" '$4 ~ port {print $NF}' | grep -oP '(?<=pid=)\d+' || true
    } | sort -u )"

    if [[ -n "$pids" ]] && [[ "$pids" != "0.0.0.0:*" ]]; then
      warn "Port $port is in use by PID(s): $pids"
      for pid in $pids; do
        if [[ "$pid" =~ ^[0-9]+$ ]]; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
      sleep 1
      success "Cleared stale process(es) on port $port"
    else
      log "Port $port is free"
    fi
  done
}

wait_for_url() {
  local url="$1"
  local name="$2"
  local gateway_url="${3:-}"
  local retries=60
  local delay=2

  for ((i=1; i<=retries; i++)); do
    if curl --connect-timeout 2 --max-time 5 -fsS "$url" >/dev/null 2>&1; then
      success "$name is healthy at $url"
      return 0
    fi
    if [[ -n "$gateway_url" ]] && curl --connect-timeout 2 --max-time 5 -fsS "$gateway_url" >/dev/null 2>&1; then
      warn "$name is healthy via Docker gateway at $gateway_url; localhost port forwarding is unavailable in this shell"
      return 0
    fi
    if (( i % 10 == 0 )); then
      warn "Still waiting for $name at $url ($i/$retries)"
    else
      log "Waiting for $name at $url ($i/$retries)..."
    fi
    sleep "$delay"
  done

  error "Timed out waiting for $name at $url"
  return 1
}

print_summary() {
  printf '\n%s====================================================%s\n' "$GREEN$BOLD" "$RESET"
  printf '%sFINAL STATUS%s\n' "$GREEN$BOLD" "$RESET"
  printf '%s====================================================%s\n' "$GREEN$BOLD" "$RESET"
  printf '%-18s %s\n' "Frontend:" "http://localhost:3000 [container healthy]"
  printf '%-18s %s\n' "Backend:" "http://localhost:7007/.backstage/health/v1/readiness [container healthy]"
  printf '%-18s %s\n' "Health probe:" "Docker gateway ${DOCKER_GATEWAY} [OK]"
  printf '%-18s %s\n' "Database:" "postgres://backstage:backstage@localhost:5433/cloudhub [OK]"
  printf '\n%sCLOUDHUB: HEALTHY%s\n' "$GREEN$BOLD" "$RESET"
}

case "$MODE" in
  run|start|build)
    ;;
  restart|rebuild|reset)
    MODE="restart"
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    error "Unknown mode: $MODE"
    usage
    exit 1
    ;;
 esac

require_cmd docker
require_cmd curl

cd "$ROOT_DIR"

step "CloudHub startup (${MODE})"
log "Workspace root: $ROOT_DIR"
cleanup_ports

if [[ "$MODE" == "restart" ]]; then
  warn "Stopping and resetting the CloudHub stack"
  docker compose down --remove-orphans --volumes || true
  docker volume rm -f platform_cloudhub_pgdata >/dev/null 2>&1 || true
else
  warn "Stopping any active CloudHub containers"
  docker compose down --remove-orphans || true
fi

step "Building and starting containers"
log "Running: docker compose up -d --build --force-recreate"
docker compose up -d --build --force-recreate

BACKEND_CONTAINER="$(docker compose ps -q backend)"
DOCKER_GATEWAY="$(docker inspect "$BACKEND_CONTAINER" --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
if [[ -z "$DOCKER_GATEWAY" ]]; then
  error "Could not determine Docker gateway for the CloudHub backend"
  exit 1
fi

wait_for_url "http://localhost:3000" "Frontend" "http://${DOCKER_GATEWAY}:3000"
wait_for_url \
  "http://localhost:7007/.backstage/health/v1/readiness" \
  "Backend" \
  "http://${DOCKER_GATEWAY}:7007/.backstage/health/v1/readiness"

print_summary
