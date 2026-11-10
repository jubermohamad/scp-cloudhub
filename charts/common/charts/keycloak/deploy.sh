#!/bin/bash
#
# Deploy the Keycloak chart (CNPG-backed) with ingress + TLS.
#
# Everything is created by Helm: the namespace (--create-namespace), the
# registry pull secret (imageCredentials.*) and the ingress TLS secret
# (ingress.secrets). No kubectl pre-steps.
#
# Examples:
#
#   First install (uses the current kubectl context):
#     ./deploy.sh -H keycloak.example.com \
#       --acr-username myuser --acr-password 'mypass' \
#       --tls-cert ./tls.crt --tls-key ./tls.key
#
#   Quick test without a real certificate (self-signed by the chart):
#     ./deploy.sh -H keycloak.example.com --self-signed \
#       --acr-username myuser --acr-password 'mypass'
#
#   Upgrade later (credentials/cert kept from the release, nothing to pass):
#     ./deploy.sh -H keycloak.example.com
#
#   Deploy to a specific kubectl context:
#     ./deploy.sh -H keycloak.example.com --context my-cluster-context
#
#   Or fetch AKS credentials first (needs az login):
#     ./deploy.sh -H keycloak.example.com -c my-aks-cluster -g my-resource-group ...
#
#   Preview the manifests without applying:
#     ./deploy.sh -H keycloak.example.com --dry-run
#
#   Remove the release (keeps namespace and PVCs):
#     ./deploy.sh --uninstall
#
set -euo pipefail

SCRIPT_PATH="$(dirname "$(realpath "$0")")"
readonly SCRIPT_PATH
readonly CHART_PATH="$SCRIPT_PATH"

# ── Defaults (override via flags or environment) ─────────────────────────────
NAMESPACE="${NAMESPACE:-keycloak}"
RELEASE_NAME="${RELEASE_NAME:-keycloak}"
KC_HOST="${KC_HOST:-}"
KC_ADMIN_USER="${KC_ADMIN_USER:-SRI_Admin@symphonyai.dev}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-}"
SRI_USER_PASSWORD="${SRI_USER_PASSWORD:-}"
NS_USER_PASSWORD="${NS_USER_PASSWORD:-}"

ACR_SERVER="${ACR_SERVER:-symphonyfs.azurecr.io}"
ACR_USERNAME="${ACR_USERNAME:-}"
ACR_PASSWORD="${ACR_PASSWORD:-}"
TLS_CERT_FILE="${TLS_CERT_FILE:-}"
TLS_KEY_FILE="${TLS_KEY_FILE:-}"

CLUSTER_NAME="${CLUSTER_NAME:-}"
CLUSTER_RESOURCE_GROUP="${CLUSTER_RESOURCE_GROUP:-}"
KUBE_CONTEXT="${KUBE_CONTEXT:-}"

HELM_TIMEOUT="${HELM_TIMEOUT:-10m}"

DRY_RUN=""
UNINSTALL=""
SELF_SIGNED=""
EXTRA_VALUES_FILES=()
CERT_MANAGER_ISSUER="${CERT_MANAGER_ISSUER:-}"
EXTERNAL_DB="${EXTERNAL_DB:-}"

RED='\e[31m'; GREEN='\e[32m'; YELLOW='\e[33m'; CYAN='\033[0;36m'; RESET='\e[0m'
log_info()    { echo -e "$(date +"%H:%M:%S") ${CYAN}$1${RESET}"; }
log_warn()    { echo -e "$(date +"%H:%M:%S") ${YELLOW}$1${RESET}"; }
log_error()   { echo -e "$(date +"%H:%M:%S") ${RED}$1${RESET}"; }
log_success() { echo -e "$(date +"%H:%M:%S") ${GREEN}$1${RESET}"; }

usage() {
  cat <<USAGE
Usage: $(basename "$0") -H <hostname> [options]

Required:
  -H, --host FQDN            Ingress hostname for Keycloak

Cluster access (defaults to the current kubectl context):
      --context NAME         Switch to this kubectl context first
  -c, --cluster NAME         AKS cluster name (with -g, runs az aks get-credentials;
  -g, --resource-group NAME  AKS resource group              needs az login)

Registry secret, created by Helm (required on first install; kept from the
release values on upgrades):
      --acr-server HOST      Container registry            (default: $ACR_SERVER)
      --acr-username USER    Registry username
      --acr-password PASS    Registry password

Ingress TLS secret, created by Helm (one of, required on first install; kept
from the release values on upgrades):
      --tls-cert FILE        PEM certificate for the hostname
      --tls-key FILE         PEM private key
      --self-signed          Chart-generated self-signed cert (testing)
      --cert-manager-issuer NAME  Set cert-manager.io/cluster-issuer=NAME; cert-manager
                                  issues/renews the TLS secret (issuer must already exist)

Database:
      --external-db          Skip the CNPG operator install/precheck and the
                              cluster/cn-postgres-keycloak readiness wait. Pass this
                              when values set cn-postgres-keycloak.enabled=false and
                              point externalDatabase.* at your own PostgreSQL server.

Other:
  -n, --namespace NAME       Target namespace              (default: $NAMESPACE)
  -r, --release NAME         Helm release name             (default: $RELEASE_NAME)
  -p, --admin-password PW    Bootstrap admin password      (default: generated)
      --sri-password PW      Password for SRI@symphonyai.dev          (default: generated)
      --ns-password PW       Password for <namespace>@symphonyai.dev  (default: generated)
  -f, --values FILE          Extra helm values file merged last (repeatable)
      --dry-run              helm --dry-run=server, deploy nothing
      --uninstall            helm uninstall the release and exit
  -h, --help                 This help

Every flag can also be set via environment variables (NAMESPACE, KC_HOST,
ACR_USERNAME, TLS_CERT_FILE, ...).
USAGE
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace)       NAMESPACE="$2"; shift 2 ;;
    -r|--release)         RELEASE_NAME="$2"; shift 2 ;;
    -H|--host)            KC_HOST="$2"; shift 2 ;;
    -p|--admin-password)  KC_ADMIN_PASSWORD="$2"; shift 2 ;;
    --sri-password)       SRI_USER_PASSWORD="$2"; shift 2 ;;
    --ns-password)        NS_USER_PASSWORD="$2"; shift 2 ;;
    -c|--cluster)         CLUSTER_NAME="$2"; shift 2 ;;
    -g|--resource-group)  CLUSTER_RESOURCE_GROUP="$2"; shift 2 ;;
    -f|--values)          EXTRA_VALUES_FILES+=("$2"); shift 2 ;;
    --acr-server)         ACR_SERVER="$2"; shift 2 ;;
    --acr-username)       ACR_USERNAME="$2"; shift 2 ;;
    --acr-password)       ACR_PASSWORD="$2"; shift 2 ;;
    --tls-cert)           TLS_CERT_FILE="$2"; shift 2 ;;
    --tls-key)            TLS_KEY_FILE="$2"; shift 2 ;;
    --self-signed)        SELF_SIGNED=1; shift ;;
    --cert-manager-issuer) CERT_MANAGER_ISSUER="$2"; shift 2 ;;
    --external-db)        EXTERNAL_DB=1; shift ;;
    --context)            KUBE_CONTEXT="$2"; shift 2 ;;
    --dry-run)            DRY_RUN=1; shift ;;
    --uninstall)          UNINSTALL=1; shift ;;
    -h|--help)            usage ;;
    *) log_error "Unknown option: $1"; usage 1 ;;
  esac
done

for bin in kubectl helm; do
  command -v "$bin" >/dev/null || { log_error "$bin is required but not found"; exit 1; }
done

# ── Cluster access: current context by default ──────────────────────────────
if [[ -n "$CLUSTER_NAME" || -n "$CLUSTER_RESOURCE_GROUP" ]]; then
  if [[ -z "$CLUSTER_NAME" || -z "$CLUSTER_RESOURCE_GROUP" ]]; then
    log_error "-c/--cluster and -g/--resource-group must be used together"
    exit 1
  fi
  command -v az >/dev/null || { log_error "az CLI not found (omit -c/-g to use the current kubectl context)"; exit 1; }
  log_info "Fetching kubeconfig for $CLUSTER_NAME ($CLUSTER_RESOURCE_GROUP)"
  az aks get-credentials --name "$CLUSTER_NAME" --resource-group "$CLUSTER_RESOURCE_GROUP" --overwrite-existing
elif [[ -n "$KUBE_CONTEXT" ]]; then
  log_info "Switching kubectl context to '$KUBE_CONTEXT'"
  kubectl config use-context "$KUBE_CONTEXT" >/dev/null
fi
log_info "kubectl context: $(kubectl config current-context)"

if [[ -n "$UNINSTALL" ]]; then
  log_warn "Uninstalling release '$RELEASE_NAME' from namespace '$NAMESPACE' (namespace and PVCs are kept)"
  helm uninstall "$RELEASE_NAME" -n "$NAMESPACE"
  log_success "Uninstalled."
  exit 0
fi

[[ -n "$KC_HOST" ]] || { log_error "Ingress hostname is required (-H/--host)"; usage 1; }

RELEASE_EXISTS=""
helm status "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1 && RELEASE_EXISTS=1

# ── Input validation: Helm creates the secrets, so on first install the
#    inputs are mandatory; on upgrades previous release values are reused ────
HAVE_ACR=""
[[ -n "$ACR_USERNAME" && -n "$ACR_PASSWORD" ]] && HAVE_ACR=1
if [[ -z "$HAVE_ACR" && -z "$RELEASE_EXISTS" ]]; then
  log_error "First install: registry credentials are required (--acr-username/--acr-password)"
  exit 1
fi

HAVE_TLS=""
if [[ -n "$TLS_CERT_FILE" || -n "$TLS_KEY_FILE" ]]; then
  [[ -f "$TLS_CERT_FILE" ]] || { log_error "TLS cert file not found: $TLS_CERT_FILE"; exit 1; }
  [[ -f "$TLS_KEY_FILE"  ]] || { log_error "TLS key file not found: $TLS_KEY_FILE"; exit 1; }
  HAVE_TLS=1
fi
if [[ -z "$HAVE_TLS" && -z "$SELF_SIGNED" && -z "$CERT_MANAGER_ISSUER" && -z "$RELEASE_EXISTS" ]]; then
  log_error "First install: TLS input is required (--tls-cert/--tls-key, --self-signed, or --cert-manager-issuer)"
  exit 1
fi

# ── DNS sanity check ─────────────────────────────────────────────────────────
if ! getent hosts "$KC_HOST" >/dev/null; then
  log_warn "DNS: $KC_HOST does not resolve yet — the ingress will not be reachable until a record exists"
else
  log_info "DNS: $KC_HOST -> $(getent hosts "$KC_HOST" | awk '{print $1}' | head -1)"
fi

# ── CNPG operator (cluster-wide prerequisite, skipped for --external-db) ─────
# Cluster-wide add-ons (CNPG, cert-manager, ingress-nginx, ...) are installed
# once per cluster via the shared common-res chart, not by this script.
if [[ -z "$EXTERNAL_DB" ]]; then
  if ! kubectl get crd clusters.postgresql.cnpg.io >/dev/null 2>&1; then
    log_error "CloudNativePG operator not found in this cluster."
    log_error "Install it cluster-wide via the common-res chart (cloudnative-pg.enabled=true), then retry."
    log_error "Alternatively pass --external-db and configure externalDatabase.* to use your own PostgreSQL server."
    exit 1
  fi
  log_info "CloudNativePG operator present"
fi

# ── cert-manager / ClusterIssuer (only when --cert-manager-issuer is used) ──
if [[ -n "$CERT_MANAGER_ISSUER" ]]; then
  if ! kubectl get crd clusterissuers.cert-manager.io >/dev/null 2>&1; then
    log_error "cert-manager CRDs not found in this cluster."
    log_error "Install cert-manager cluster-wide via the common-res chart (cert-manager.enabled=true), then retry."
    exit 1
  fi
  if ! kubectl get clusterissuer "$CERT_MANAGER_ISSUER" >/dev/null 2>&1; then
    log_error "ClusterIssuer '$CERT_MANAGER_ISSUER' not found in this cluster."
    log_error "Enable/configure it via the common-res chart (cluster-issuers.enabled=true), then retry."
    exit 1
  fi
  log_info "ClusterIssuer '$CERT_MANAGER_ISSUER' present"
fi

# ── Admin password: keep the existing one on upgrades, generate on install ───
if [[ -z "$KC_ADMIN_PASSWORD" ]]; then
  KC_ADMIN_PASSWORD="$(kubectl -n "$NAMESPACE" get secret "$RELEASE_NAME" \
    -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d || true)"
fi
if [[ -z "$KC_ADMIN_PASSWORD" ]]; then
  KC_ADMIN_PASSWORD="$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)"
  GENERATED_PASSWORD=1
fi

# ── Deployment values (secrets are rendered by the chart) ────────────────────
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
VALUES_FILE="$WORKDIR/keycloak-deploy-values.yaml"

cat > "$VALUES_FILE" <<EOF
global:
  security:
    allowInsecureImages: true

auth:
  adminUser: ${KC_ADMIN_USER}
  adminPassword: "${KC_ADMIN_PASSWORD}"

# TLS terminates at the nginx ingress; Keycloak trusts forwarded headers
proxyHeaders: xforwarded

ingress:
  enabled: true
  ingressClassName: nginx
  hostname: ${KC_HOST}
  tls: true
EOF

if [[ -n "$SELF_SIGNED" ]]; then
  log_warn "Using a chart-generated self-signed certificate (testing only)"
  cat >> "$VALUES_FILE" <<EOF
  selfSigned: true
EOF
elif [[ -n "$HAVE_TLS" ]]; then
  {
    echo "  secrets:"
    echo "    - name: ${KC_HOST}-tls"
    echo "      certificate: |"
    sed 's/^/        /' "$TLS_CERT_FILE"
    echo "      key: |"
    sed 's/^/        /' "$TLS_KEY_FILE"
  } >> "$VALUES_FILE"
elif [[ -n "$CERT_MANAGER_ISSUER" ]]; then
  log_info "TLS secret will be issued by cert-manager (ClusterIssuer: $CERT_MANAGER_ISSUER)"
  cat >> "$VALUES_FILE" <<EOF
  annotations:
    cert-manager.io/cluster-issuer: ${CERT_MANAGER_ISSUER}
EOF
fi

if [[ -n "$SRI_USER_PASSWORD" || -n "$NS_USER_PASSWORD" ]]; then
  {
    echo ""
    echo "adminUsers:"
    [[ -n "$SRI_USER_PASSWORD" ]] && echo "  sriPassword: \"${SRI_USER_PASSWORD}\""
    [[ -n "$NS_USER_PASSWORD"  ]] && echo "  namespacePassword: \"${NS_USER_PASSWORD}\""
  } >> "$VALUES_FILE"
fi

if [[ -n "$HAVE_ACR" ]]; then
  cat >> "$VALUES_FILE" <<EOF

imageCredentials:
  create: true
  secretName: regcred
  registry: ${ACR_SERVER}
  username: "${ACR_USERNAME}"
  password: "${ACR_PASSWORD}"
EOF
fi

HELM_ARGS=(upgrade --install "$RELEASE_NAME" "$CHART_PATH"
  -n "$NAMESPACE" --create-namespace --timeout "$HELM_TIMEOUT")

# On upgrades where cert/credentials were not re-passed, use the previous
# release values as the base layer so the Helm-managed secrets are kept.
# (Not --reuse-values: that would also freeze the new chart defaults.)
if [[ -n "$RELEASE_EXISTS" && ( -z "$HAVE_ACR" || ( -z "$HAVE_TLS" && -z "$SELF_SIGNED" && -z "$CERT_MANAGER_ISSUER" ) ) ]]; then
  log_info "Reusing registry/TLS configuration from the existing release values"
  helm get values "$RELEASE_NAME" -n "$NAMESPACE" -o yaml > "$WORKDIR/previous-values.yaml"
  HELM_ARGS+=(-f "$WORKDIR/previous-values.yaml")
fi

HELM_ARGS+=(-f "$VALUES_FILE")
for f in "${EXTRA_VALUES_FILES[@]+"${EXTRA_VALUES_FILES[@]}"}"; do
  HELM_ARGS+=(-f "$f")
done
[[ -n "$DRY_RUN" ]] && HELM_ARGS+=(--dry-run=server)

log_info "Deploying release '$RELEASE_NAME' to namespace '$NAMESPACE' (host: $KC_HOST)"
helm "${HELM_ARGS[@]}"

if [[ -n "$DRY_RUN" ]]; then
  log_success "Dry run complete — nothing was deployed."
  exit 0
fi

# ── Verify ───────────────────────────────────────────────────────────────────
log_info "Waiting for Keycloak to become ready"
if [[ -z "$EXTERNAL_DB" ]]; then
  kubectl -n "$NAMESPACE" wait cluster/cn-postgres-keycloak \
    --for=condition=Ready --timeout=10m
fi
kubectl -n "$NAMESPACE" rollout status statefulset/"$RELEASE_NAME" --timeout=10m

echo
kubectl get pods,ingress -n "$NAMESPACE"
[[ -z "$EXTERNAL_DB" ]] && kubectl get cluster -n "$NAMESPACE"
echo
log_success "Keycloak deployed: https://${KC_HOST}/"
log_success "Realm 'SRI' and admin users are created automatically, each with its own random password:"
log_success "  ${KC_ADMIN_USER}            -> secret '$RELEASE_NAME', key admin-password"
log_success "  SRI@symphonyai.dev              -> secret '$RELEASE_NAME-admin-users', key sri-password"
log_success "  ${NAMESPACE}@symphonyai.dev -> secret '$RELEASE_NAME-admin-users', key namespace-admin-password"
if [[ -n "${GENERATED_PASSWORD:-}" ]]; then
  log_warn "Generated admin password: ${KC_ADMIN_PASSWORD}"
  log_warn "Also stored in secret '$RELEASE_NAME' (key admin-password) in namespace '$NAMESPACE'"
fi
