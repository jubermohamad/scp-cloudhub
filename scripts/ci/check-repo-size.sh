#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-.}"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "Error: directory not found: $ROOT_DIR" >&2
  exit 1
fi

# du -sk gives stable KB values that are easy to subtract.
total_kb=$(du -sk "$ROOT_DIR" | awk '{print $1}')

nm_kb=0
if [[ -d "$ROOT_DIR/node_modules" ]]; then
  nm_kb=$(du -sk "$ROOT_DIR/node_modules" | awk '{print $1}')
fi

without_nm_kb=$((total_kb - nm_kb))

to_human_gb() {
  awk -v kb="$1" 'BEGIN { printf "%.2f GB", kb/1024/1024 }'
}

to_human_mb() {
  awk -v kb="$1" 'BEGIN { printf "%.0f MB", kb/1024 }'
}

echo "Path: $ROOT_DIR"
echo "Total: $(to_human_gb "$total_kb")"
echo "node_modules: $(to_human_gb "$nm_kb")"
echo "Without node_modules: $(to_human_mb "$without_nm_kb")"
