#!/usr/bin/env bash
# Run all tests for the CloudHub self-service platform scaffolding.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 -m unittest discover -s tests -p "test_*.py" -t . -v
