#!/usr/bin/env bash
set -euo pipefail

base_url="${1:?Usage: backend-smoke-test.sh <base-url>}"
base_url="${base_url%/}"

for path in "/.backstage/health/v1/readiness" "/.backstage/health/v1/liveness"; do
  code="$(curl --fail --silent --show-error --location --max-time 20 -o /dev/null -w '%{http_code}' "${base_url}${path}")"
  if [[ "$code" != "200" ]]; then
    echo "::error::Backend smoke test failed for ${base_url}${path}: HTTP ${code}"
    exit 1
  fi
  echo "Backend smoke test passed: ${path} (HTTP ${code})"
done
