#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Bootstrap CloudHub AKS namespace prerequisites.

Required environment variables:
  AKS_RESOURCE_GROUP
  AKS_CLUSTER_NAME
  ACR_NAME
  K8S_NAMESPACE
  AZURE_TENANT_ID

Optional environment variables:
  IDENTITY_RESOURCE_GROUP (defaults to AKS_RESOURCE_GROUP)
  IDENTITY_NAME (defaults to uai-cloudhub-backend-<namespace>)
  FEDERATED_CREDENTIAL_NAME (defaults to fc-cloudhub-backend-<namespace>)
  SERVICE_ACCOUNT_NAME (defaults to cloudhub-backend)
  K8S_MANIFEST_DIR (defaults to k8s/aks-namespace)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required variable: $name" >&2
    exit 1
  fi
}

require_var AKS_RESOURCE_GROUP
require_var AKS_CLUSTER_NAME
require_var ACR_NAME
require_var K8S_NAMESPACE
require_var AZURE_TENANT_ID

IDENTITY_RESOURCE_GROUP="${IDENTITY_RESOURCE_GROUP:-$AKS_RESOURCE_GROUP}"
IDENTITY_NAME="${IDENTITY_NAME:-uai-cloudhub-backend-${K8S_NAMESPACE}}"
FEDERATED_CREDENTIAL_NAME="${FEDERATED_CREDENTIAL_NAME:-fc-cloudhub-backend-${K8S_NAMESPACE}}"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-cloudhub-backend}"
K8S_MANIFEST_DIR="${K8S_MANIFEST_DIR:-k8s/aks-namespace}"

echo "Using AKS cluster: ${AKS_CLUSTER_NAME} (${AKS_RESOURCE_GROUP})"
echo "Namespace: ${K8S_NAMESPACE}"
echo "Identity: ${IDENTITY_NAME}"

issuer_url="$(az aks show \
  --resource-group "$AKS_RESOURCE_GROUP" \
  --name "$AKS_CLUSTER_NAME" \
  --query oidcIssuerProfile.issuerUrl \
  -o tsv)"

if [[ -z "$issuer_url" ]]; then
  echo "Unable to resolve AKS OIDC issuer URL." >&2
  exit 1
fi

if az identity show \
  --resource-group "$IDENTITY_RESOURCE_GROUP" \
  --name "$IDENTITY_NAME" \
  >/dev/null 2>&1; then
  echo "Managed identity already exists; reusing it."
else
  az identity create \
    --resource-group "$IDENTITY_RESOURCE_GROUP" \
    --name "$IDENTITY_NAME" \
    --location "$(az group show -n "$IDENTITY_RESOURCE_GROUP" --query location -o tsv)" \
    >/dev/null
fi

client_id="$(az identity show \
  --resource-group "$IDENTITY_RESOURCE_GROUP" \
  --name "$IDENTITY_NAME" \
  --query clientId \
  -o tsv)"
principal_id="$(az identity show \
  --resource-group "$IDENTITY_RESOURCE_GROUP" \
  --name "$IDENTITY_NAME" \
  --query principalId \
  -o tsv)"

if az identity federated-credential show \
  --identity-name "$IDENTITY_NAME" \
  --resource-group "$IDENTITY_RESOURCE_GROUP" \
  --name "$FEDERATED_CREDENTIAL_NAME" \
  >/dev/null 2>&1; then
  echo "Federated credential already exists; reusing it."
else
  az identity federated-credential create \
    --name "$FEDERATED_CREDENTIAL_NAME" \
    --identity-name "$IDENTITY_NAME" \
    --resource-group "$IDENTITY_RESOURCE_GROUP" \
    --issuer "$issuer_url" \
    --subject "system:serviceaccount:${K8S_NAMESPACE}:${SERVICE_ACCOUNT_NAME}" \
    --audiences api://AzureADTokenExchange \
    >/dev/null
fi

acrpull_scope="$(az acr show --name "$ACR_NAME" --query id -o tsv)"

az role assignment create \
  --assignee-object-id "$principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPull \
  --scope "$acrpull_scope" \
  >/dev/null || true

echo "Creating namespace if needed."
kubectl create namespace "$K8S_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "Apply the namespace manifests after you prepare the runtime secret."
echo "Render/apply path: ${K8S_MANIFEST_DIR}"
echo "Managed identity clientId: ${client_id}"
echo "Managed identity principalId: ${principal_id}"
echo "Federated subject: system:serviceaccount:${K8S_NAMESPACE}:${SERVICE_ACCOUNT_NAME}"
echo "Grant AcrPull to the identity if the cluster is not already attached to ACR."
echo "Example scope: ${acrpull_scope}"
