#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND_FILE="$SCRIPT_DIR/db-migration-command.txt"
COMMAND="${DB_MIGRATION_COMMAND:-}"

if [ -z "$(echo "$COMMAND" | tr -d '[:space:]')" ] && [ -f "$COMMAND_FILE" ]; then
  COMMAND="$(sed -n '1p' "$COMMAND_FILE" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
fi

if [ -z "$(echo "$COMMAND" | tr -d '[:space:]')" ]; then
  echo "[db-migration] No migration command configured; skipping."
  echo "[db-migration] Set DB_MIGRATION_COMMAND or create db-migration-command.txt."
  exit 0
fi

echo "[db-migration] Running migration command"
bash -lc "$COMMAND"
echo "[db-migration] Migration completed"
