#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <image-family> <image-ref>"
  exit 1
fi

family="$1"
image="$2"

run_check() {
  local binary="$1"
  docker run --rm "$image" sh -lc "command -v $binary >/dev/null"
}

check_version() {
  local command="$1"
  docker run --rm "$image" sh -lc "$command"
}

run_check git
run_check kubectl
run_check helm
run_check az
run_check gh
check_version "id -u developer >/dev/null"

case "$family" in
  base)
    ;;
  node)
    run_check node
    run_check npm
    ;;
  python)
    run_check python
    run_check pip
    ;;
  java)
    run_check java
    if docker run --rm "$image" sh -lc "command -v mvn >/dev/null"; then
      check_version "mvn -v >/dev/null"
    else
      check_version "gradle -v >/dev/null"
    fi
    ;;
  scala)
    run_check java
    run_check scala
    run_check sbt
    ;;
  postgres)
    run_check psql
    ;;
  *)
    echo "Unknown image family: $family"
    exit 1
    ;;
esac

echo "Smoke test passed for $family ($image)"
