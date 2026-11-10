# Keycloak Chart — Deployment Guide

This chart is based on Bitnami Keycloak 25.2.0 (Keycloak 26.3.3) with the
following modifications for our platform:

- **Database**: the embedded Bitnami PostgreSQL sub-chart was **removed**. The
  Keycloak database is provisioned as a **CloudNativePG (CNPG) `Cluster`**
  resource, managed by the PostgreSQL operator (same pattern as invhub/flow).
- **Operator precheck**: install/upgrade fails fast with a clear error when the
  CNPG operator CRDs are not present in the cluster.
- **Everything is created by Helm** — namespace, registry pull secret, ingress
  TLS secret, database, realm and admin users. No manual `kubectl` steps.
- **SRI realm** and **three admin users** are created automatically on every
  install/upgrade by keycloak-config-cli.

## Quick start

```bash
cd charts/keycloak

# First install (uses the current kubectl context)
./deploy.sh -H sri-keycloak-eng-dev.symphonyai.dev -n sri-keycloak-eng-dev \
  --acr-username <user> --acr-password '<pass>' \
  --tls-cert ./tls.crt --tls-key ./tls.key

# Upgrade later — registry/TLS are kept from the release, nothing to re-pass
./deploy.sh -H sri-keycloak-eng-dev.symphonyai.dev -n sri-keycloak-eng-dev
```

The script prints the URL and where every password is stored when it finishes.

## What gets deployed

| Resource | Name | Created by |
|---|---|---|
| Namespace | `-n` flag | `helm --create-namespace` |
| Registry pull secret | `regcred` | chart (`imageCredentials.*`) |
| Ingress TLS secret | `<hostname>-tls` | chart (`ingress.secrets`), or self-signed |
| PostgreSQL cluster | `cn-postgres-keycloak` (1 instance) | CNPG operator from the chart's `Cluster` resource |
| DB owner credentials | `postgres-credential-keycloak-cn` | chart (random, stable across upgrades) |
| Keycloak | statefulset `keycloak` | chart |
| Ingress | nginx, TLS terminated at the ingress (`proxyHeaders: xforwarded`) | chart |
| Realm `SRI` | — | keycloak-config-cli job (post-install/upgrade hook) |
| Admin users (see below) | — | keycloak-config-cli job |

## Admin users and passwords

Three admin users are created in the `master` realm by default, each with its
own random password:

| User | Password stored in | Key |
|---|---|---|
| `SRI_Admin@symphonyai.dev` (bootstrap admin) | secret `<release>` | `admin-password` |
| `SRI@symphonyai.dev` | secret `<release>-admin-users` | `sri-password` |
| `<namespace>@symphonyai.dev` | secret `<release>-admin-users` | `namespace-admin-password` |

Retrieve them:

```bash
kubectl -n <namespace> get secret keycloak -o jsonpath='{.data.admin-password}' | base64 -d
kubectl -n <namespace> get secret keycloak-admin-users -o jsonpath='{.data.sri-password}' | base64 -d
kubectl -n <namespace> get secret keycloak-admin-users -o jsonpath='{.data.namespace-admin-password}' | base64 -d
```

Passwords are generated randomly by default and stay stable across upgrades.
To set them explicitly, pass `-p/--admin-password`, `--sri-password`,
`--ns-password` to the script (or set `auth.adminPassword`,
`adminUsers.sriPassword`, `adminUsers.namespacePassword` values).

> **Password caveat**: keycloak-config-cli only applies a password when it
> *creates* the user. Changing `--sri-password`/`--ns-password` later updates
> the secret but not an existing user — change it in the admin console, or
> delete the user and re-run the script (`IMPORT_FORCE=true` recreates it).

## deploy.sh reference

```
Usage: deploy.sh -H <hostname> [options]

  -H, --host FQDN            Ingress hostname (required)
      --context NAME         Switch to this kubectl context first
  -c, --cluster NAME         AKS cluster name  (with -g, runs az aks get-credentials)
  -g, --resource-group NAME  AKS resource group
      --acr-server HOST      Registry (default: symphonyfs.azurecr.io)
      --acr-username USER    Registry username   (first install only)
      --acr-password PASS    Registry password   (first install only)
      --tls-cert FILE        PEM certificate     (first install only)
      --tls-key FILE         PEM private key     (first install only)
      --self-signed          Chart-generated self-signed cert (testing)
  -n, --namespace NAME       Namespace     (default: keycloak)
  -r, --release NAME         Release name  (default: keycloak)
  -p, --admin-password PW    Bootstrap admin password        (default: generated)
      --sri-password PW      SRI@symphonyai.dev password     (default: generated)
      --ns-password PW       <namespace>@... password        (default: generated)
  -f, --values FILE          Extra values file merged last
      --dry-run              helm --dry-run=server, deploys nothing
      --uninstall            Remove the release (keeps namespace and PVCs)
```

Notes:

- **Cluster access**: the current kubectl context is used by default. `--context`
  switches context; `-c`/`-g` fetch AKS credentials via `az` (needs `az login`).
- **CNPG operator**: must already be installed cluster-wide (e.g. via the
  shared `common-res` chart, `cloudnative-pg.enabled=true`) — the script fails
  fast with an error if the CRDs are missing rather than installing it, since
  that's a cluster-wide change other releases may depend on. Skipped entirely
  when `--external-db` is used.
- **Upgrades**: when registry/TLS flags are not re-passed, the previous release
  values are used as the base layer, so the Helm-managed secrets are kept while
  new chart defaults still apply (deliberately *not* `helm --reuse-values`).
- **DNS**: the script warns when the hostname does not resolve. The
  `*.symphonyai.dev` wildcard cert covers one-level subdomains.

## Database (CloudNativePG)

- `cn-postgres-keycloak` runs **1 instance** by default
  (`cn-postgres-keycloak.instances`); raise it for HA — CNPG handles replicas
  and failover automatically.
- Keycloak connects to the `cn-postgres-keycloak-rw` service with
  `sslmode=verify-full` against the operator-generated CA
  (secret `cn-postgres-keycloak-ca`, mounted at `/pg-ca-cert`).
- Backups are disabled by default — see `charts/cn-postgres/values.yaml` for
  barmanObjectStore examples (Azure Blob / MinIO).

### Using an external PostgreSQL instead

```yaml
cn-postgres-keycloak:
  enabled: false            # also skips the operator precheck
externalDatabase:
  host: "your-postgres-host"
  port: 5432
  user: keycloak_user
  database: keycloak
  password: "<db-password>"   # or existingSecret
  extraParams: ""             # e.g. "sslmode=require"
extraVolumes: []              # clear the CNPG CA mount defaults
extraVolumeMounts: []
```

Pass it with `./deploy.sh ... -f external-db-values.yaml`.

## Verification

```bash
kubectl get cluster,pods,ingress -n <namespace>
# cluster cn-postgres-keycloak: "Cluster in healthy state", keycloak-0 Running

# login check via port-forward (or use https://<hostname>/ once DNS resolves)
kubectl -n <namespace> port-forward svc/keycloak 18080:80 &
curl -s -X POST http://localhost:18080/realms/master/protocol/openid-connect/token \
  -d client_id=admin-cli -d grant_type=password \
  -d username=SRI_Admin@symphonyai.dev -d "password=$PW" | head -c 60
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `PRECHECK FAILED: the PostgreSQL operator does not exist` / `CloudNativePG operator not found` | CNPG CRDs missing. Install cluster-wide via the shared `common-res` chart (`cloudnative-pg.enabled=true`), or manually: `helm install cnpg cnpg/cloudnative-pg -n cnpg-system --create-namespace`. Alternatively pass `--external-db` and configure `externalDatabase.*`. |
| `cert-manager CRDs not found` / `ClusterIssuer '...' not found` | Install cert-manager and the issuer cluster-wide via `common-res` (`cert-manager.enabled=true`, `cluster-issuers.enabled=true`), or pass `--tls-cert`/`--tls-key`/`--self-signed` instead of `--cert-manager-issuer` |
| `VALUES VALIDATION: ... embedded Bitnami PostgreSQL ... removed` | `postgresql.enabled=true` was set — the embedded DB no longer exists; use the CNPG cluster or `externalDatabase` |
| Admin user login fails after changing a password value | config-cli doesn't update existing users' passwords — see the password caveat above |
| A deleted realm/user doesn't come back after upgrade | It should — `IMPORT_FORCE=true` re-imports on every upgrade. Check the `keycloak-keycloak-config-cli` job logs |
| Image pull errors | `regcred` missing or wrong ACR credentials — re-run with `--acr-username/--acr-password` |
| `helm template` fails with image verification error | expected with the private registry — set `global.security.allowInsecureImages=true` (the script does) |

## History

- Deployed and verified on `aks-scp-dev-uks-st-eng`
  (namespace `sri-keycloak-eng-dev`, host `sri-keycloak-eng-dev.symphonyai.dev`)
  and previously on `eureka-flows-dfdev` (namespace `sri-keycloak`).
