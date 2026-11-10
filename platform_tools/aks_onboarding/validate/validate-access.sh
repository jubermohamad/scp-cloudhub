#!/usr/bin/env bash
# validate-access.sh
#
# Verifies that the Backstage Service Principal has read-only access
# to nodes and pods on the target AKS cluster after RBAC onboarding.
#
# Usage:
#   ./validate-access.sh <cluster-name> <resource-group>
#
# Prerequisites:
#   - az CLI authenticated with the platform SPN
#   - kubectl available on PATH
#
# Exit codes:
#   0  All checks passed
#   1  One or more checks failed

set -euo pipefail

CLUSTER_NAME="${1:?Usage: $0 <cluster-name> <resource-group>}"
RESOURCE_GROUP="${2:?Usage: $0 <cluster-name> <resource-group>}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
fail()  { echo -e "${RED}[✗]${NC} $*"; }
info()  { echo -e "${CYAN}[i]${NC} $*"; }

FAILED=0

info "Fetching kubeconfig for cluster: ${CLUSTER_NAME} (rg: ${RESOURCE_GROUP})"
az aks get-credentials \
  --name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --overwrite-existing \
  --admin \
  >/dev/null 2>&1

info "Running access checks against cluster: ${CLUSTER_NAME}"

# ── Check 1: list nodes ──────────────────────────────────────────────────────
if kubectl get nodes --context="${CLUSTER_NAME}" >/dev/null 2>&1; then
  ok "Can list nodes"
else
  fail "Cannot list nodes"
  FAILED=1
fi

# ── Check 2: list pods (all namespaces) ──────────────────────────────────────
if kubectl get pods -A --context="${CLUSTER_NAME}" >/dev/null 2>&1; then
  ok "Can list pods (all namespaces)"
else
  fail "Cannot list pods"
  FAILED=1
fi

# ── Check 3: cannot create pods (write must be denied) ───────────────────────
if kubectl auth can-i create pods --context="${CLUSTER_NAME}" 2>/dev/null | grep -q "^no$"; then
  ok "Cannot create pods (write correctly denied)"
else
  fail "Unexpected write access: can create pods — check RBAC"
  FAILED=1
fi

# ── Check 4: cannot delete nodes ─────────────────────────────────────────────
if kubectl auth can-i delete nodes --context="${CLUSTER_NAME}" 2>/dev/null | grep -q "^no$"; then
  ok "Cannot delete nodes (write correctly denied)"
else
  fail "Unexpected write access: can delete nodes — check RBAC"
  FAILED=1
fi

echo ""
if [[ "${FAILED}" -eq 0 ]]; then
  ok "All access checks passed for cluster: ${CLUSTER_NAME}"
else
  fail "One or more access checks failed for cluster: ${CLUSTER_NAME}"
  exit 1
fi
