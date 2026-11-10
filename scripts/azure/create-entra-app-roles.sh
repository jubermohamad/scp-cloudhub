#!/usr/bin/env bash
set -euo pipefail

# Create/update CloudHub Microsoft Entra ID app roles on an existing App Registration.
#
# Usage:
#   ./scripts/azure/create-entra-app-roles.sh --app-id <APPLICATION_CLIENT_ID>
#   ./scripts/azure/create-entra-app-roles.sh --app-id <APPLICATION_CLIENT_ID> --dry-run
#
# Prerequisites:
#   - Azure CLI logged in: az login
#   - Microsoft Graph permissions to update applications
#
# Notes:
#   - This script REPLACES appRoles on the app registration with the CloudHub set below.
#   - If your app already has custom roles, merge them before applying.

APP_ID=""
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-id)
      APP_ID="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$APP_ID" ]]; then
  echo "ERROR: --app-id is required"
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  echo "ERROR: az CLI is required"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required"
  exit 1
fi

OBJECT_ID="$(az ad app show --id "$APP_ID" --query id -o tsv)"
if [[ -z "$OBJECT_ID" ]]; then
  echo "ERROR: could not resolve app object id for app id $APP_ID"
  exit 1
fi

TMP_FILE="$(mktemp)"
python3 - "$TMP_FILE" <<'PY'
import json
import sys
import uuid

out = sys.argv[1]
roles = [
    {
    "allowedMemberTypes": ["User", "Application"],
        "description": "Platform Administrator",
        "displayName": "Platform Admin",
        "id": str(uuid.uuid4()),
        "isEnabled": True,
        "value": "CloudHub.PlatformAdmin",
    },
    {
    "allowedMemberTypes": ["User", "Application"],
        "description": "Application Engineering",
        "displayName": "App Engineer",
        "id": str(uuid.uuid4()),
        "isEnabled": True,
        "value": "CloudHub.AppEngineer",
    },
    {
    "allowedMemberTypes": ["User", "Application"],
        "description": "Professional Services",
        "displayName": "Professional Services",
        "id": str(uuid.uuid4()),
        "isEnabled": True,
        "value": "CloudHub.ProfessionalServices",
    },
    {
    "allowedMemberTypes": ["User", "Application"],
        "description": "Reliability Engineering",
        "displayName": "SRE",
        "id": str(uuid.uuid4()),
        "isEnabled": True,
        "value": "CloudHub.SRE",
    },
]

with open(out, "w", encoding="utf-8") as f:
    json.dump(roles, f, indent=2)
PY

echo "Generated app role payload: $TMP_FILE"
cat "$TMP_FILE"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run only. No Azure update performed."
  exit 0
fi

az ad app update --id "$OBJECT_ID" --app-roles "@$TMP_FILE"

echo
echo "CloudHub app roles updated on app registration $APP_ID"
echo "Next: assign these app roles to Entra groups (recommended):"
echo "  - GRP-CloudHub-PlatformAdmin"
echo "  - GRP-CloudHub-AppEngineer"
echo "  - GRP-CloudHub-ProfessionalServices"
echo "  - GRP-CloudHub-SRE"
