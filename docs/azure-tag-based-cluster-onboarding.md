# Azure Tag-Based Cluster Onboarding Implementation

## Overview

This implementation introduces a controlled AKS cluster onboarding system using Azure Tags. CloudHub now discovers deployment targets based on explicit tag-based eligibility rather than listing all available AKS clusters.

## Architecture

### Core Concepts

**Tag-Based Eligibility**: A cluster is deployable only when both required tags are present and set to "true":

- `cloudhub-enabled=true` - Platform accepts this cluster for deployments
- `cloudhub-onboarded=true` - Operator has approved this cluster for production use

Any cluster missing either tag or having them set to "false" is hidden from deployment targets.

### Service Layer

#### ClusterTagValidator (Utility)

**Location**: `src/utils/clusterTagValidator.ts`

Centralized tag validation logic used across all services:

- `isCloudHubEligible(tags)` - Check if cluster is deployable
- `getEligibilityReport(tags)` - Detailed eligibility diagnostics
- `createCloudHubTags(enabled, onboarded)` - Create standard tags
- `mergeCloudHubTags(existing, new)` - Merge while preserving non-CloudHub tags
- `validateTagFormat(tags)` - Validate tag values

**Key Principle**: All tag evaluation must go through this validator. No UI-side or controller-side tag logic.

#### ClusterDiscoveryService (Service)

**Location**: `src/services/clusterDiscoveryService.ts`

Abstracts AKS cluster discovery with automatic tag filtering:

- `getDeployableClusters(input)` - Returns only CloudHub-eligible clusters
- `getAllClusters(input)` - Returns all clusters (for admin views)
- `getClustersByTag(input)` - Custom tag filtering
- `getDeployableCluster(input)` - Single cluster lookup with eligibility check

**Design Pattern**: This service wraps `AzureProvider.discoverClusters()` and layers tag-based filtering on top. The implementation is designed to be replaceable with `ClusterRegistryService` in the future without changing consumers.

#### ClusterTagService (Service)

**Location**: `src/services/clusterTagService.ts`

Manages all Azure tag operations for cluster onboarding:

- `getTags(input)` - Retrieve current cluster tags
- `updateTags(input, tags)` - Update tags with validation
- `onboardCluster(input, userId)` - Complete onboarding flow
- `offboardCluster(input, userId)` - Remove from deployment
- `enableCluster(input)` - Set cloudhub-enabled=true
- `disableCluster(input)` - Set cloudhub-enabled=false

**Implementation Details**:

- Uses `ContainerServiceClient` (available via @azure/arm-containerservice)
- Merges new CloudHub tags with existing tags (preserves non-CloudHub tags)
- Validates tag format before updating
- Logs all operations with cluster name, resource group, subscription, and user ID

### API Layer

#### Discovery Endpoints

**GET /api/clusters/deployable**

```http
GET /api/clusters/deployable?subscriptionId=xxx&resourceGroup=yyy&region=zzz&environment=prod
Authorization: Bearer <token>
```

Returns only CloudHub-eligible clusters. Requires `canRead` authorization.

**Query Parameters**:

- `subscriptionId` (required) - Azure subscription ID (UUID)
- `resourceGroup` (optional) - Filter by resource group
- `region` (optional) - Filter by region (case-insensitive)
- `environment` (optional) - Filter by environment tag

**Response**:

```json
{
  "clusters": [
    {
      "clusterName": "aks-prod-eastus",
      "region": "eastus",
      "resourceGroup": "rg-prod",
      "subscriptionId": "00000000-0000-0000-0000-000000000000",
      "kubernetesVersion": "1.27.0",
      "nodePools": 3,
      "environment": "prod",
      "tags": {
        "cloudhub-enabled": "true",
        "cloudhub-onboarded": "true",
        "app": "payment-service"
      },
      "status": "Succeeded"
    }
  ]
}
```

#### Onboarding Endpoints

**POST /api/clusters/onboard**

```http
POST /api/clusters/onboard
Authorization: Bearer <token>
Content-Type: application/json

{
  "subscriptionId": "00000000-0000-0000-0000-000000000000",
  "resourceGroup": "rg-prod",
  "clusterName": "aks-prod-eastus"
}
```

Requires `canProvisionInfrastructure` authorization (platform-engineer role).

**Response** (200 OK):

```json
{
  "clusterName": "aks-prod-eastus",
  "resourceGroup": "rg-prod",
  "subscriptionId": "00000000-0000-0000-0000-000000000000",
  "tags": {
    "cloudhub-enabled": "true",
    "cloudhub-onboarded": "true"
  }
}
```

**Error Responses**:

- 403 Forbidden - Insufficient permissions
- 404 Not Found - Cluster doesn't exist
- 502 Bad Gateway - Tag update failed

**POST /api/clusters/offboard**

```http
POST /api/clusters/offboard
Authorization: Bearer <token>
Content-Type: application/json

{
  "subscriptionId": "00000000-0000-0000-0000-000000000000",
  "resourceGroup": "rg-prod",
  "clusterName": "aks-prod-eastus"
}
```

Sets `cloudhub-onboarded=false`, immediately hiding cluster from deployment targets.

**Response** (200 OK):

```json
{
  "clusterName": "aks-prod-eastus",
  "resourceGroup": "rg-prod",
  "subscriptionId": "00000000-0000-0000-0000-000000000000",
  "tags": {
    "cloudhub-enabled": "true",
    "cloudhub-onboarded": "false"
  }
}
```

### Control Plane Service Integration

**Location**: `src/services/controlPlaneService.ts`

Three new methods added:

- `discoverDeployableClusters(input)` - Uses ClusterDiscoveryService
- `onboardCluster(input, userId)` - Uses ClusterTagService with audit logging
- `offboardCluster(input, userId)` - Uses ClusterTagService with audit logging

All methods log operations for audit trail.

## Eligibility Logic

### Business Rules

```
A cluster is deployable IF AND ONLY IF:
  cloudhub-enabled = "true"  AND
  cloudhub-onboarded = "true"
```

### Examples

| `cloudhub-enabled` | `cloudhub-onboarded` | Result          | Display |
| ------------------ | -------------------- | --------------- | ------- |
| true               | true                 | ✅ Eligible     | YES     |
| true               | false                | ❌ Not eligible | Hidden  |
| false              | true                 | ❌ Not eligible | Hidden  |
| false              | false                | ❌ Not eligible | Hidden  |
| (missing)          | (missing)            | ❌ Not eligible | Hidden  |
| (partial)          | true                 | ❌ Not eligible | Hidden  |

## Testing

### Unit Tests

**Location**: `src/utils/__tests__/clusterTagValidator.test.ts`

Comprehensive test coverage for:

- Tag eligibility checking (11 test cases)
- Eligibility reports (5 test cases)
- Tag creation (3 test cases)
- Tag merging (5 test cases)
- Tag format validation (6 test cases)

**Run tests**:

```bash
yarn test clusterTagValidator
```

### Integration Tests (Recommended Future)

Create tests for:

1. Discovery filtering with mixed tagged/untagged clusters
2. Tag update operations (success and error scenarios)
3. Permission enforcement (RBAC)
4. Audit logging

## Configuration

### Azure Credentials

The implementation reuses existing CloudHub Azure credential configuration:

```bash
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_ID=<spn-client-id>
AZURE_CLIENT_SECRET=<spn-secret>
```

**Credential selection**: `ClientSecretCredential` uses only `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`; the configured client and tenant
are validated against CloudHub's platform identity. Missing or mismatched values
fail closed; there is no Managed Identity, CLI, or `DefaultAzureCredential` fallback.

### Subscription Configuration (Future)

Currently subscriptionId is passed per-request. For hardcoded subscriptions in future:

```typescript
// config/deployment-control-plane.yml
azure:
  subscriptions:
    - id: 00000000-0000-0000-0000-000000000000
      name: production
      description: Production AKS clusters
```

## Logging & Audit Trail

All operations are logged with structured prefixes:

```
[cluster-discovery] Found 3 deployable clusters (7 total) in subscription XXX
[cluster-tags] Cluster aks-prod-eastus onboarded successfully by user@company.com
[cluster-tags] Cluster aks-prod-eastus offboarded successfully by user@company.com
[cluster-tags] Error updating tags for aks-prod-eastus: Insufficient permissions
```

**Logged Information**:

- Cluster name
- Resource group
- Subscription ID
- User ID (when applicable)
- Operation (onboard/offboard/enable/disable)
- Timestamp (implicit in log output)
- Error details (when applicable)

## Migration Path: Toward Cluster Registry

This implementation is designed as an intermediate step. The future migration to a dedicated Cluster Registry will:

1. **No UI changes required** - All consumers use `ClusterDiscoveryService`
2. **No API changes required** - Endpoints remain the same
3. **Backward compatible** - Tag validation logic stays the same
4. **Drop-in replacement**:

   ```typescript
   // Today
   const discoveryService = new ClusterDiscoveryService(azureProvider, logger);

   // Future
   const discoveryService = new ClusterRegistryService(registryClient, logger);
   ```

## Implementation Details

### Kubernetes API Integration

Uses `ContainerServiceClient` from `@azure/arm-containerservice` v25.2.0+

Methods called:

- `managedClusters.get(resourceGroup, clusterName)` - Retrieve cluster
- `managedClusters.beginCreateOrUpdateAndWait(...)` - Update with new tags

### Tag Merge Strategy

When updating tags:

1. Get existing cluster
2. Extract existing tags
3. Merge new CloudHub tags (overwrites only CloudHub tags)
4. Preserve all non-CloudHub tags
5. Update cluster with merged tags

Example:

```typescript
// Existing tags
{ "app": "api", "team": "backend" }

// Update request
{ "cloudhub-enabled": "true" }

// Result
{ "app": "api", "team": "backend", "cloudhub-enabled": "true" }
```

## Security Considerations

### Authorization

- Only `platform-engineer` role can onboard/offboard clusters
- Read operations available to all authenticated users with `canRead` permission
- RBAC enforced at router layer before service calls

### Azure Permissions Required

Service Principal needs:

- `Microsoft.ContainerService/managedClusters/read` - List/get clusters
- `Microsoft.ContainerService/managedClusters/write` - Update tags

### Tag Manipulation

- No direct tag modification without validation
- Validation ensures only "true"/"false" string values
- Case-sensitive: `cloudhub-enabled` (lowercase required)

## Acceptance Criteria Met

✅ Existing deployment workflow continues working (backward compatible)
✅ Azure remains source of discovery (wraps AzureProvider)
✅ Only tagged clusters appear (automatic filtering)
✅ Non-tagged clusters are hidden (no hardcoded lists)
✅ Onboarding can be done through API (POST /api/clusters/onboard)
✅ Offboarding removes deployment visibility (immediate effect)
✅ No UI-side filtering (backend source of truth)
✅ All tag evaluation centralized (ClusterTagValidator)
✅ Subscription IDs not hardcoded (passed per-request)
✅ Foundation for Cluster Registry migration (IClusterDiscoveryService)

## Files Added/Modified

### New Files

- `src/utils/clusterTagValidator.ts` - Tag validation utility
- `src/services/clusterDiscoveryService.ts` - Discovery with filtering
- `src/services/clusterTagService.ts` - Tag management
- `src/utils/__tests__/clusterTagValidator.test.ts` - Unit tests

### Modified Files

- `src/services/controlPlaneService.ts` - Added cluster discovery/management methods
- `src/router.ts` - Added onboarding/offboarding endpoints

## Quality Metrics

- ✅ TypeScript: 0 errors
- ✅ Prettier: All files formatted
- ✅ ESLint: All checks pass
- ✅ Tests: 5/5 test suites passed
- ✅ Unit Tests: 30+ test cases for tag validator
