# GPU Compute Architecture Validation

**Date:** 2026-08-24

## Result

The GPU Compute implementation uses centralized network profiles from `CLOUDHUB_NETWORKS_JSON` in backend runtime as the source of truth for approved GPU VNets. Arbitrary VNet discovery is no longer used by the GPU workflow.

## Current Implementation

| Area                  | State                  | Details                                                                                                                                                       |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VNet dropdown         | Implemented            | `GET /gpu-instances/vnets` returns only GPU network profiles (`gpu-*`) from centralized CloudHub network configuration.                                      |
| Subnet dropdown       | Implemented            | Selecting a configured VNet calls Azure Resource Graph for that VNet only. Reserved, delegated, and zero-capacity subnets are removed.                        |
| Region handling       | Implemented            | Region is taken from the selected VNet and the UI field is read-only. The backend rejects mismatches.                                                         |
| Subscription handling | Implemented            | Subscription is metadata from the selected VNet; there is no subscription selector in the user workflow.                                                      |
| Capacity display      | Implemented            | Subnet entries show CIDR and available IP count. Total and used counts are returned by the provider; 32 or fewer available addresses are marked low capacity. |
| Resource ID exposure  | Implemented            | Azure subnet IDs are not returned in the browser network-options response.                                                                                    |
| Subnet ID resolution  | Implemented            | The backend re-queries the selected VNet's subnets during create and obtains the actual subnet resource ID server-side.                                       |
| Terraform payload     | Implemented            | `subnet_id` and fixed `resource_group_name` are included in the tfvars payload and dispatch request.                                                          |
| Hardcoded VNet IDs    | Implemented            | No VNet IDs are hardcoded.                                                                                                                                    |
| Mock networking data  | Not used in production | Tests use explicit fixtures; production uses Backstage config and Azure discovery.                                                                            |

## Configuration Source

The backend expects this JSON map schema in `CLOUDHUB_NETWORKS_JSON`:

```json
{
  "gpu-a100": {
    "subscriptionId": "<subscription-id>",
    "resourceGroup": "rg-network-prod",
    "vnetName": "vnet-payments-prod",
    "subnetName": "snet-gpu-a100",
    "region": "westus2"
  }
}
```

Deployment source of truth is `CLOUDHUB_NETWORKS_JSON` propagated by the deployment workflow into backend App Service settings. Invalid or incomplete entries are rejected with descriptive errors.

## End-to-End Code Path

1. `CreateGpuInstancePage` loads `/gpu-instances/vnets` and displays `vnetName` and `region` only.
2. VNet selection stores its `subscriptionId`, `vnetName`, and `region` metadata in form state.
3. The page calls `/gpu-instances/network-options` for the selected subscription, VNet, and derived region.
4. `GpuComputeService.getNetworkOptions` verifies the VNet exists in configured `gpu-*` network profiles, then calls `AzureProvider.discoverGpuSubnets` for the configured subscription, resource group, VNet, and region.
5. On create, `GpuComputeService.create` repeats the allow-list and region validation, re-queries Azure, finds the selected subnet by name, and reads its actual `subnet.id`.
6. `buildTfvars` generates the Terraform variables and the Terraform service dispatch receives the same server-resolved `subnetId`.

## Exact Terraform Variables

For a request named `gpu-a100-01`, selected SKU `a100`, region `westus2`, and subnet ID `/subscriptions/sub-prod/resourceGroups/rg-network-prod/providers/Microsoft.Network/virtualNetworks/vnet-payments-prod/subnets/snet-app`, the generated payload is:

```json
{
  "env": "dev",
  "region_code": "westus2",
  "tenancy": "st",
  "tenant_id": "all",
  "override_vm_name": "gpu-a100-01",
  "resource_group_name": "rg-gpu-sdc",
  "location": "westus2",
  "subnet_id": "/subscriptions/sub-prod/resourceGroups/rg-network-prod/providers/Microsoft.Network/virtualNetworks/vnet-payments-prod/subnets/snet-app",
  "vm_size": "Standard_NC24ads_A100_v4",
  "tags": {
    "owner": "user@symphonysensa.com",
    "environment": "dev",
    "managed-by": "cloudhub-gpu-compute"
  }
}
```

The Terraform dispatch also passes `resourceGroupName: "rg-gpu-sdc"`, `location: "westus2"`, `vmSize: "Standard_NC24ads_A100_v4"`, and the same server-resolved `subnetId`.

## Gap Analysis Before Migration

| Required state                             | Previous state                                             | Resolution                                                            |
| ------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Read onboarded VNets from centralized JSON config | Implemented via `CLOUDHUB_NETWORKS_JSON` | Configure `gpu-*` profiles in centralized CloudHub network config. |
| Populate only approved VNets               | Not implemented; Azure Resource Graph listed all VNets     | VNet endpoint now returns config entries only.                        |
| No resource IDs in UI                      | Partially implemented; subnet API included IDs             | Removed IDs from browser response.                                    |
| Derive and lock region                     | Partially implemented; region was independently selectable | Region now follows selected VNet and is read-only.                    |
| Resolve subnet ID before Terraform         | Implemented                                                | Backend revalidates and resolves the Azure subnet ID during create.   |

## Migration Plan Status

No further migration is required for the core architecture. The changed components are:

- `.github/workflows/deploy-fe-be-prod-basic.yml`: validates and applies `CLOUDHUB_NETWORKS_JSON` to backend App Service.
- `plugins/deployment-control-plane-backend/src/index.ts`: injects Backstage root config.
- `ControlPlaneService` and `GpuComputeService`: read and enforce the allow-list.
- `AzureProvider`: dynamically reads subnet capacity for the selected VNet.
- GPU router: exposes approved VNets and subnet options.
- `CreateGpuInstancePage`: removes free-form subscription/region selection and adds review/capacity display.
- `docs/gpu-compute-network-onboarding.md`: documents operator onboarding.

## Confidence Assessment

**HIGH**, assuming `CLOUDHUB_NETWORKS_JSON` is configured with `gpu-*` profiles, the Azure service identity has read access to the configured VNets/subnets, and the Terraform module honors `subnet_id` and `resource_group_name` as documented. The backend fixes the deployment resource group to `rg-gpu-sdc`, resolves the selected subnet ID server-side, and sends that ID to Terraform.

Automated validation: full TypeScript check passes; focused GPU service tests pass 12/12.
