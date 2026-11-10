#!/usr/bin/env bash
set -euo pipefail

base_url="${1:?Usage: frontend-smoke-test.sh <base-url>}"
base_url="${base_url%/}"

check() {
  local path="$1"
  local code
  code="$(curl --fail --silent --show-error --location --max-time 20 -o /dev/null -w '%{http_code}' "${base_url}${path}")"
  if [[ "$code" != "200" ]]; then
    echo "::error::Frontend smoke test failed for ${base_url}${path}: HTTP ${code}"
    exit 1
  fi
  echo "Frontend smoke test passed: ${path} (HTTP ${code})"
}

check "/"

html="$(curl --fail --silent --show-error --location --max-time 20 "${base_url}/")"
asset="$(printf '%s' "$html" | sed -nE 's#.*(static/[A-Za-z0-9._/-]+\.(js|css)).*#\1#p' | head -n1)"
if [[ -z "$asset" ]]; then
  echo "::error::Frontend smoke test could not find a static JS/CSS asset in ${base_url}/"
  exit 1
fi
check "/${asset}"
