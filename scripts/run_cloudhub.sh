#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-7007}"

kill_port() {
  local port="$1"
  local pids=()

  if command -v lsof >/dev/null 2>&1; then
    mapfile -t pids < <(lsof -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)
  elif command -v fuser >/dev/null 2>&1; then
    mapfile -t pids < <(fuser -n tcp "${port}" 2>/dev/null || true)
  elif command -v ss >/dev/null 2>&1; then
    mapfile -t pids < <(ss -lntp "sport = :${port}" 2>/dev/null | awk 'NR>1 {print $NF}' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u || true)
  fi

  if [ "${#pids[@]}" -gt 0 ]; then
    echo "Stopping CloudHub processes on port ${port}: ${pids[*]}"
    kill -TERM "${pids[@]}" 2>/dev/null || true
    sleep 2
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi
}

kill_repo_processes() {
  local pids=()
  mapfile -t pids < <(
    ps -eo pid,comm,args --no-headers 2>/dev/null |
      awk '
        $0 ~ /scp-cloudhub/ ||
        $0 ~ /packages\/backend.*app-config/ ||
        $0 ~ /backstage-cli repo start/ ||
        $0 ~ /webpack-dev-server/ ||
        $0 ~ /rspack.*dev-server/ ||
        $0 ~ /node.*yarn.*start/ {
          print $1
        }
      ' |
      sort -u || true
  )

  if [ "${#pids[@]}" -gt 0 ]; then
    echo "Stopping stale CloudHub dev processes: ${pids[*]}"
    kill -TERM "${pids[@]}" 2>/dev/null || true
    sleep 2
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi
}

for port in "${PORT}" "${BACKEND_PORT}"; do
  kill_port "$port"
done
kill_repo_processes

cd "${REPO_ROOT}"
export PORT BACKEND_PORT
exec yarn start "$@"
