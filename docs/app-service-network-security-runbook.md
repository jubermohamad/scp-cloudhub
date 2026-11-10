# App Service Network Security Runbook

## Scope

This runbook covers the public/private network posture of the CloudHub Azure App Service instances (`cloudhub-frontend` and `cloudhub-backend`) in resource group `rg-cfe-apps-mj`. It documents how to inspect the current state, what a private endpoint actually does, and how to lock the apps down to internal traffic only.

## Current state as of last review

The following checks were run against `cloudhub-frontend` in `rg-cfe-apps-mj`.

```bash
az webapp show \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --query '{
    name: name,
    state: state,
    publicNetworkAccess: publicNetworkAccess,
    defaultHostName: defaultHostName,
    httpsOnly: httpsOnly,
    kind: kind,
    vnetRouteAllEnabled: vnetRouteAllEnabled,
    virtualNetworkSubnetId: virtualNetworkSubnetId
  }'
```

Result:

| Setting | Value | Risk |
|---|---|---|
| `publicNetworkAccess` | `Enabled` | **Public internet can reach the app.** |
| `ipSecurityRestrictions` | `Allow all` | No IP allow-listing. |
| `privateEndpointConnections` | `[]` | **No private endpoint attached.** |
| `virtualNetworkSubnetId` | `null` | No VNet integration. |
| `httpsOnly` | `false` | HTTP is still accepted. |
| `minTlsVersion` | `1.2` | Acceptable. |
| `ftpsState` | `FtpsOnly` | Acceptable. |

Bottom line: the frontend App Service is **publicly exposed with no private endpoint and no IP restrictions**. The backend App Service should be checked with the same commands because the frontend proxies `/api` traffic to it.

## What does a private endpoint do?

A private endpoint gives an Azure PaaS resource a private IP address inside one of your VNet subnets. Internal users and services can then reach the app over private addressing instead of going across the public internet.

A private endpoint does **not** automatically disable the public `.azurewebsites.net` endpoint. If `publicNetworkAccess` remains `Enabled`, the app is still reachable from the internet. The private endpoint only adds an internal path; it does not remove the public path.

To make the app truly internal, you must both attach a private endpoint **and** disable public network access.

## How to inspect the current configuration

### App Service core network settings

```bash
az webapp show \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --query '{
    name: name,
    state: state,
    publicNetworkAccess: publicNetworkAccess,
    defaultHostName: defaultHostName,
    httpsOnly: httpsOnly,
    vnetRouteAllEnabled: vnetRouteAllEnabled,
    virtualNetworkSubnetId: virtualNetworkSubnetId
  }' -o json
```

### Access restrictions

```bash
az webapp config show \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --query '{
    ipSecurityRestrictions: ipSecurityRestrictions,
    scmIpSecurityRestrictions: scmIpSecurityRestrictions,
    ipSecurityRestrictionsDefaultAction: ipSecurityRestrictionsDefaultAction,
    scmIpSecurityRestrictionsDefaultAction: scmIpSecurityRestrictionsDefaultAction,
    ftpsState: ftpsState,
    minTlsVersion: minTlsVersion,
    scmMinTlsVersion: scmMinTlsVersion
  }' -o json
```

### Private endpoint connections

```bash
az network private-endpoint-connection list \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --type Microsoft.Web/sites -o json
```

### App Service authentication (authsettingsV2)

```bash
az resource show \
  --ids "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/rg-cfe-apps-mj/providers/Microsoft.Web/sites/cloudhub-frontend/config/authsettingsV2" \
  --query properties.platform -o json
```

## Hardening options

### Option 1 — IP restrictions only (quick win)

Restrict public access to known corporate egress IP ranges. This keeps the public endpoint alive but blocks general internet traffic.

```bash
# Allow a corporate IP range
az webapp config access-restriction add \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --rule-name "AllowCorporateOffice" \
  --action Allow \
  --ip-address "203.0.113.0/24" \
  --priority 100

# Set default action to Deny for the main site
az webapp config access-restriction set \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --use-main-site-rule \
  --default-action Deny

# Restrict the SCM / Kudu site as well
az webapp config access-restriction add \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --scm-site \
  --rule-name "AllowCorporateSCM" \
  --action Allow \
  --ip-address "203.0.113.0/24" \
  --priority 100

az webapp config access-restriction set \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --scm-site \
  --default-action Deny
```

### Option 2 — Private endpoint + disable public access (recommended)

This makes the app reachable only from inside your private network.

1. Create or attach a private endpoint for `cloudhub-frontend` in the target VNet/subnet.
2. Disable public network access:

```bash
az webapp update \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --set publicNetworkAccess=Disabled
```

3. Configure private DNS so `cloudhub-frontend.azurewebsites.net` resolves to the private endpoint IP inside your network.
4. Ensure users reach it through VPN, ExpressRoute, or a secure internal proxy.

### Option 3 — Both private endpoint and IP restrictions

Use a private endpoint for internal traffic and keep public access restricted to a small set of trusted IPs for break-glass or external integrations.

## Additional hardening

### Enforce HTTPS only

```bash
az webapp update \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --set httpsOnly=true
```

### Check the backend as well

The frontend proxies `/api` calls to the backend App Service. If the backend is also public, the overall attack surface is larger than it appears. Run the same inspection commands against `cloudhub-backend`.

```bash
az webapp show --name cloudhub-backend --resource-group rg-cfe-apps-mj \
  --query '{publicNetworkAccess:publicNetworkAccess, httpsOnly:httpsOnly, virtualNetworkSubnetId:virtualNetworkSubnetId}' -o json

az webapp config show --name cloudhub-backend --resource-group rg-cfe-apps-mj \
  --query '{ipSecurityRestrictions:ipSecurityRestrictions, ipSecurityRestrictionsDefaultAction:ipSecurityRestrictionsDefaultAction}' -o json

az network private-endpoint-connection list --name cloudhub-backend --resource-group rg-cfe-apps-mj --type Microsoft.Web/sites -o json
```

## Rollback

If disabling public access breaks access for legitimate users, re-enable it:

```bash
az webapp update \
  --name cloudhub-frontend \
  --resource-group rg-cfe-apps-mj \
  --set publicNetworkAccess=Enabled
```

Keep IP restrictions in place if you used Option 1 or 3.

## Key takeaways

- `cloudhub-frontend` is currently public on the internet.
- A private endpoint alone does not remove public access.
- The most secure configuration is **private endpoint + `publicNetworkAccess=Disabled`**.
- Always inspect and harden `cloudhub-backend` with the same rules because the frontend depends on it.

## Related files

- [docker/Dockerfile.frontend](../docker/Dockerfile.frontend)
- [docker/Dockerfile.backend](../docker/Dockerfile.backend)
- [docs/container-architecture.md](container-architecture.md)
- [docs/github-actions-deployment-workflows.md](github-actions-deployment-workflows.md)
