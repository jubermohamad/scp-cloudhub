# CloudHub Deployment DNS and Health Checks

> **Current implementation:** DNS and post-deploy health checks are part of the
> deployment-control-plane deployment portal. The former `packages/backend`
> `dnsResolverService`, `cloudflareDnsService`, and `/api/v1/dns/*` router have
> been removed. The historical material below is retained for reference only;
> do not use its hard-coded ingress IPs, endpoints, or test commands.

## Current flow

1. After approval, the deployment service derives one canonical host using
  `plugins/platform-common/src/ingressUrl.ts`.
2. Before GitHub Actions is dispatched, the backend reads the target instance
  helmfile from the selected pipeline repository and takes its `kubeContext`.
  It maps that exact context to an ingress IP using
  `CLOUDHUB_CLUSTER_INGRESS_IPS`.
3. If `CLOUDFLARE_API_TOKEN` is configured, the backend creates/updates an
  unproxied A record (TTL 300) in `symphonyai.dev` or `symphonyai.cloud`, then
  checks DNS resolution. A Cloudflare or ingress-map error fails the deployment
  before workflow dispatch. If the token is absent, DNS is deliberately logged
  as `SKIPPED` and the workflow may continue; the hostname then needs to have
  been provisioned outside CloudHub.
4. Deploy dispatch uses the workflow input contract in
  `plugins/deployment-control-plane-backend/src/services/deploymentPipeline.ts`.
  The default is `SymphonyFS/pipeline-internal` with
  `deploy-with-dynamic-runners.yml`; diff uses `github-actions-diff-manual.yml`.
5. Once GitHub reports `SUCCEEDED`, Step 4 polls the backend health-check route
  every five seconds for up to ten minutes. It probes `/health`, `/api/health`,
  and `/actuator/health` on the canonical host without following redirects.

## Required settings

Set these as **backend runtime environment variables**, not frontend build
arguments. Locally use the repository-root `.env`; in Azure use
**cloudhub-backend → Settings → Environment variables (Application settings)**.
Restart/recreate the backend after changing them.

| Setting | Purpose | Required behavior |
|---|---|---|
| `GITHUB_ACTIONS_TOKEN` (or the supported GitHub token alias) | Read repository files and dispatch workflows | Token must have repository read and Actions/workflow dispatch write access on the configured pipeline repository. |
| `SYMPHONYFS_SCRIPTS_REPOSITORY` | Pipeline repository | Leave unset to use `SymphonyFS/pipeline-internal`, or set to that exact owner/repository. |
| `SYMPHONYFS_WORKFLOW_ID` | Deploy workflow | Leave unset to use `deploy-with-dynamic-runners.yml`. Do not override with a workflow from a different repository. |
| `SYMPHONYFS_DIFF_WORKFLOW_ID` | Diff workflow | Leave unset to use `github-actions-diff-manual.yml`. |
| `SYMPHONYFS_WORKFLOW_REF` | Branch/tag containing workflows and app files | Defaults to `main`; verify this is the intended branch in the selected pipeline repository. |
| `CLOUDFLARE_API_TOKEN` | Create/update DNS A records | Optional only if DNS is managed elsewhere. If set, needs DNS edit access for both zones. |
| `CLOUDFLARE_ZONE_ID_SYMPHONYAI_DEV`, `CLOUDFLARE_ZONE_ID_SYMPHONYAI_CLOUD` | Pin DNS zones | Optional if the token can list zones; otherwise set both IDs. |
| `CLOUDHUB_CLUSTER_INGRESS_IPS` | Map actual kubeContext names to ingress IPv4 addresses | Required whenever Cloudflare automation is enabled. JSON object, e.g. `{"uk-eng-dev":"<actual-ingress-ip>"}`. Never guess an IP. |

For local validation, the root `.env` is loaded by docker-compose for the
backend. Keep Cloudflare tokens and GitHub credentials out of committed files;
`.env` is ignored by Git. In Azure, store token values as protected App Service
application settings/Key Vault references. Obtain ingress IPs from the platform
owner of the target cluster and map the **exact** `kubeContext` string in the
instance helmfile.

## Configuration audit (2026-10-08)

The code and tests for the new DNS/health flow are present, but the current
production backend settings do **not** yet enable it:

- `CLOUDFLARE_API_TOKEN` is not configured, so DNS automation is skipped.
- `CLOUDHUB_CLUSTER_INGRESS_IPS` and pinned zone IDs are not configured. Add the
  exact cluster mappings and zone IDs before enabling the token (zone IDs can be
  omitted only if the token has Zone:Read).
- Production currently overrides `SYMPHONYFS_SCRIPTS_REPOSITORY` to
  `jubermohamad/platform_cloudhub` and `SYMPHONYFS_WORKFLOW_ID` to
  `deploy-fe-be-prod-basic.yml`. Those override the feature's intended
  `SymphonyFS/pipeline-internal` / `deploy-with-dynamic-runners.yml` contract.
  In the same backend App Service settings, change them to the intended values
  (and verify the GitHub token can access that repository) before using the new
  deployment flow.
- The current workflow ref is `main`; verify that the target repository's
  required workflow files and instance helmfiles are on that branch.

Do not change these production settings until the pipeline repository owner has
confirmed the repository, workflow files, branch, token permissions, zones, and
cluster ingress IP map. This documentation update does not modify live Azure
configuration.

---

## Archived implementation (superseded)

The sections below describe the deleted `/api/v1/dns/*` implementation and are
not valid operational instructions for the current deployment portal.

## Overview

This document describes the complete implementation of automated DNS provisioning for CloudHub deployments. The system automatically creates or updates DNS A records in Cloudflare before application deployment, ensuring that:

1. **Zero-touch DNS**: No manual DNS record creation required
2. **TLS/ACME Ready**: DNS exists before cert-manager requests certificates
3. **Idempotent**: Safe to run multiple times without side effects
4. **Verified**: Propagation is verified before deployment proceeds

## Architecture

### Service Layer

#### 1. DNS Resolver Service (`src/services/dnsResolverService.ts`)
Derives DNS targets from deployment parameters and resolves cluster ingress IPs.

**Key Functions:**
- `constructDnsTarget()` - Builds FQDN and retrieves cluster IP
- `resolveClusterIngressIp()` - Maps cluster names to static IPs
- `validateDnsTarget()` - Validates DNS target specifications

**Cluster IP Mapping:**
```
aks-scp-dev-eastus-sri       → 4.223.72.185 (symphonyai.dev)
aks-scp-prod-eastus-sri      → 20.120.45.10 (symphonyai.cloud)
aks-scp-dev-westeurope       → 51.144.120.80 (symphonyai.dev)
aks-scp-prod-westeurope      → 51.144.136.40 (symphonyai.cloud)
```

**Example Usage:**
```typescript
const target = constructDnsTarget({
  appName: 'invhub',
  customerCode: 'sri',
  namespace: 'invhub-dt-juber-poc3',
  clusterName: 'aks-scp-dev-eastus-sri',
  environmentType: 'dev'
});
// Returns:
// {
//   hostname: 'invhub-sri-dt-juber-poc3',
//   fullFqdn: 'invhub-sri-dt-juber-poc3.symphonyai.dev',
//   zoneName: 'symphonyai.dev',
//   ingressIp: '4.223.72.185'
// }
```

#### 2. Cloudflare DNS Service (`src/services/cloudflareDnsService.ts`)
Implements idempotent DNS record management via Cloudflare API.

**Key Functions:**
- `upsertDnsRecord()` - Creates new or updates existing DNS records
- `waitForDnsPropagation()` - Polls DNS resolution until verified
- `verifyDnsResolution()` - One-shot DNS resolution check

**Behavior:**
- **CREATE**: If no existing record found
- **UPDATE**: If existing record has different IP
- **UNCHANGED**: If existing record has matching IP

**Example Usage:**
```typescript
const result = await upsertDnsRecord({
  hostname: 'invhub-sri-poc3',
  fullFqdn: 'invhub-sri-poc3.symphonyai.dev',
  targetIp: '4.223.72.185'
});
// Returns: { success: true, action: 'CREATED', fqdn: '...', ip: '...', recordId: '...' }
```

### API Layer

#### DNS Provisioning Router (`src/createDnsProvisioningRouter.ts`)

Express router providing three DNS management endpoints:

**POST /api/v1/dns/provision**
Complete DNS provisioning flow (search → create/update → verify).

Request:
```json
{
  "appName": "invhub",
  "customerCode": "sri",
  "namespace": "invhub-dt-juber-poc3",
  "clusterName": "aks-scp-dev-eastus-sri",
  "environmentType": "dev"
}
```

Response:
```json
{
  "success": true,
  "message": "DNS record created for invhub-sri-dt-juber-poc3.symphonyai.dev",
  "dns": {
    "fqdn": "invhub-sri-dt-juber-poc3.symphonyai.dev",
    "ip": "4.223.72.185",
    "action": "CREATED",
    "isPropagated": true,
    "appUrl": "https://invhub-sri-dt-juber-poc3.symphonyai.dev",
    "recordId": "record-123"
  }
}
```

**GET /api/v1/dns/verify?fqdn=...&expectedIp=...**
Verify DNS resolution without modifying records.

**POST /api/v1/dns/propagate**
Wait for DNS propagation with configurable retries.

Request:
```json
{
  "fqdn": "invhub-sri-poc3.symphonyai.dev",
  "expectedIp": "4.223.72.185",
  "maxRetries": 6,
  "retryDelayMs": 2000
}
```

## Environment Configuration

Set these environment variables in Azure App Service Configuration:

```
CLOUDFLARE_API_TOKEN=<your-cloudflare-api-token>
CLOUDFLARE_ZONE_ID=<your-cloudflare-zone-id>
```

Get these values from Cloudflare:
1. API Tokens: https://dash.cloudflare.com/profile/api-tokens
2. Zone ID: Visible on domain overview page in Cloudflare dashboard

## Deployment Integration

### Pre-Deployment Flow

```
User clicks "Deploy"
    ↓
[Step 1: Validate deployment parameters]
    ↓
[Step 2: DNS Provision (NEW)]
    ├─ Construct DNS target (hostname, FQDN, ingress IP)
    ├─ Upsert record in Cloudflare (create/update)
    └─ Wait for DNS propagation (~5-15 seconds)
    ↓
[Step 3: Helmfile Apply / GitOps]
    ├─ Deploy pods and services
    ├─ cert-manager requests Let's Encrypt/DigiCert certificate
    └─ DNS-01 challenge validation succeeds (DNS already exists)
    ↓
[Step 4: Health check]
    ├─ Poll application health via HTTPS
    └─ Display live app URL to user
```

### Integration into Deployment Orchestrator

```typescript
// In your deployment orchestrator (e.g., createProvisioningRouter.ts)
import { upsertDnsRecord, waitForDnsPropagation } from './services/cloudflareDnsService';
import { constructDnsTarget } from './services/dnsResolverService';

export async function executeDeploymentPipeline(deploymentJob: any) {
  const { appName, customerCode, namespace, clusterName } = deploymentJob;

  // STEP 1: Validate 1Password Secrets
  // ... existing code ...

  // STEP 2: Provision DNS (NEW)
  logger.info(`[DNS] Provisioning DNS for ${namespace}...`);
  const target = constructDnsTarget({
    appName,
    customerCode,
    namespace,
    clusterName
  });

  const dnsResult = await upsertDnsRecord({
    hostname: target.hostname,
    fullFqdn: target.fullFqdn,
    targetIp: target.ingressIp
  });

  const isPropagated = await waitForDnsPropagation(
    target.fullFqdn,
    target.ingressIp,
    6
  );

  if (!isPropagated) {
    logger.warn(`DNS propagation timeout for ${target.fullFqdn}, continuing...`);
  } else {
    logger.info(`DNS verified: ${target.fullFqdn} → ${target.ingressIp}`);
  }

  // STEP 3: Deploy via GitOps
  logger.info(`[Deploy] Triggering helmfile apply...`);
  await dispatchScriptsDeployment({
    appName,
    appInstance: namespace,
    customer: customerCode,
    aksCluster: clusterName,
    action: 'deploy',
  });

  return {
    status: 'DEPLOYING',
    appUrl: `https://${target.fullFqdn}`
  };
}
```

## Test Coverage

### Unit Tests

#### DNS Resolver Service Tests (`src/__tests__/dnsResolverService.test.ts`)
- ✅ 27 tests covering:
  - Hostname construction from various namespace patterns
  - Environment (dev/prod) and cluster resolution
  - Hostname normalization (lowercase, special characters)
  - Label collapsing and trimming
  - DNS target validation with edge cases

#### Cloudflare DNS Service Tests (`src/__tests__/cloudflareDnsService.test.ts`)
- ✅ 35+ tests covering:
  - DNS record search, creation, update operations
  - Idempotent upsert logic (CREATE/UPDATE/UNCHANGED)
  - DNS propagation polling with exponential backoff
  - Cloudflare API error handling
  - Network error resilience
  - Concurrent operations

#### DNS Provisioning Router Tests (`src/__tests__/createDnsProvisioningRouter.test.ts`)
- ✅ 40+ tests covering:
  - Complete provisioning flow (all parameters)
  - Default parameter handling
  - Environment-specific behavior (dev/prod)
  - Record updates with IP changes
  - Query parameter validation
  - DNS propagation timeout handling
  - Error responses and logging
  - End-to-end integration scenarios
  - Concurrent requests

### Running Tests

Run all backend tests:
```bash
cd packages/backend
npm test
```

Run specific test suite:
```bash
cd packages/backend
npm test -- src/__tests__/dnsResolverService.test.ts
npm test -- src/__tests__/cloudflareDnsService.test.ts
npm test -- src/__tests__/createDnsProvisioningRouter.test.ts
```

## Error Handling & Resilience

### Handled Error Scenarios

1. **Missing Environment Variables**
   - Returns 500 with clear error message
   - Prompts operator to configure Cloudflare credentials

2. **Invalid Request Parameters**
   - Returns 400 with field-level validation errors
   - Prevents invalid DNS names from being created

3. **Cloudflare API Errors**
   - Logs full error details for debugging
   - Returns wrapped error with message
   - Examples: Invalid token, rate limit, invalid zone

4. **DNS Propagation Timeout**
   - Logs warning but does NOT fail deployment
   - Allows deployment to proceed with potential transient DNS issues
   - Returns `isPropagated: false` for UI feedback

5. **Network Connectivity Issues**
   - Caught and returned as 500 errors
   - Includes error message for troubleshooting

### Retry Logic

- **DNS Propagation**: Up to 6 retries with 2-second intervals
- **No retry on API failures**: Fail fast for Cloudflare API errors
- **Configurable via request**: `maxRetries` and `retryDelayMs` parameters

## Verification Checklist

### Pre-Deployment

- [ ] CLOUDFLARE_API_TOKEN configured in Azure App Service
- [ ] CLOUDFLARE_ZONE_ID configured in Azure App Service
- [ ] DNS service files deployed to backend
- [ ] DNS provisioning router registered in backend
- [ ] Tests passing locally and in CI

### Manual Testing

```bash
# 1. Test DNS target construction
curl -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "invhub",
    "customerCode": "sri",
    "namespace": "invhub-dt-juber-test",
    "clusterName": "aks-scp-dev-eastus-sri",
    "environmentType": "dev"
  }'

# Expected response:
# {
#   "success": true,
#   "dns": {
#     "fqdn": "invhub-sri-dt-juber-test.symphonyai.dev",
#     "ip": "4.223.72.185",
#     "action": "CREATED|UPDATED|UNCHANGED",
#     "isPropagated": true,
#     "appUrl": "https://invhub-sri-dt-juber-test.symphonyai.dev"
#   }
# }

# 2. Verify DNS resolution
dig +short invhub-sri-dt-juber-test.symphonyai.dev

# Expected output:
# 4.223.72.185

# 3. Verify via REST API
curl "http://localhost:3000/api/v1/dns/verify?fqdn=invhub-sri-dt-juber-test.symphonyai.dev&expectedIp=4.223.72.185"

# Expected response:
# {
#   "success": true,
#   "isResolved": true
# }
```

### Production Validation

After first deployment:
1. Check Cloudflare dashboard - should show new A record
2. Verify DNS resolution from deployment machine
3. Monitor cert-manager logs - should not show DNS validation failures
4. Confirm application is accessible via HTTPS

## File Structure

```
packages/backend/src/
├── services/
│   ├── dnsResolverService.ts           # DNS target construction
│   ├── cloudflareDnsService.ts         # Cloudflare API operations
│   └── ... (existing services)
├── createDnsProvisioningRouter.ts      # Express router
├── __tests__/
│   ├── dnsResolverService.test.ts      # 27 unit tests
│   ├── cloudflareDnsService.test.ts    # 35+ unit tests
│   ├── createDnsProvisioningRouter.test.ts  # 40+ integration tests
│   └── ... (existing tests)
└── ... (existing files)
```

## Performance Characteristics

- **DNS Record Creation**: ~200-500ms (Cloudflare API)
- **DNS Propagation Wait**: 2-15 seconds (configurable, default ~6 retries)
- **Total Provision Time**: ~1-20 seconds
- **API Response Time**: <25 seconds (including propagation wait)

## Future Enhancements

1. **Batch Operations**: Support provisioning multiple records in one request
2. **TTL Configuration**: Make TTL configurable per record
3. **Custom DNS Providers**: Abstract to support Route53, Azure DNS, etc.
4. **DNS Cleanup**: Auto-delete DNS records when deployments are destroyed
5. **Health Monitoring**: Track DNS resolution failures in metrics
6. **Audit Logging**: Record all DNS operations for compliance

## Troubleshooting

### DNS Record Not Created

1. Check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID
2. Verify API token has DNS write permissions
3. Check CloudHub logs for API error details
4. Verify zone ID matches the domain being provisioned

### DNS Propagation Timeout

1. May be transient - retry the deployment
2. Check Cloudflare DNS record shows correct IP
3. Test DNS resolution from deployment machine: `dig +short <fqdn>`
4. May need to increase `maxRetries` if local propagation is slow

### Certificate Issuance Failure

1. Verify DNS record exists: `dig <fqdn> A`
2. Check cert-manager logs for DNS-01 challenge details
3. Try manual DNS lookup from same machine: `nslookup <fqdn>`
4. May need to flush local DNS cache

## References

- [Cloudflare API Documentation](https://developers.cloudflare.com/api/)
- [DNS-01 Challenge (ACME)](https://letsencrypt.org/docs/challenge-types/#dns-01)
- [cert-manager DNS validation](https://cert-manager.io/docs/configuration/acme/dns01/)
