# GPU Compute Network Onboarding

GPU Compute does not discover or display arbitrary Azure VNets. The Cloud Platform team controls the approved network allow-list through `CLOUDHUB_NETWORKS_JSON` in the backend runtime.

## Configuration

Set `CLOUDHUB_NETWORKS_JSON` as a JSON object keyed by profile name. For GPU onboarding, use profile names that begin with `gpu-`:

```json
{
  "gpu-a100": {
    "subscriptionId": "sub-prod",
    "resourceGroup": "rg-network-prod",
    "vnetName": "vnet-payments-prod",
    "subnetName": "snet-gpu-a100",
    "region": "westus2"
  },
  "gpu-h100": {
    "subscriptionId": "sub-dev",
    "resourceGroup": "rg-network-dev",
    "vnetName": "vnet-data-dev",
    "subnetName": "snet-gpu-h100",
    "region": "eastus"
  }
}
```

Each `gpu-*` profile must contain `subscriptionId`, `resourceGroup`, `vnetName`, `subnetName`, and `region`. Invalid profile objects fail configuration parsing so the issue is explicit.

Schema expected by backend parser:

```json
{
  "<profile-name>": {
    "subscriptionId": "<azure-subscription-id>",
    "resourceGroup": "<vnet-resource-group>",
    "vnetName": "<vnet-name>",
    "subnetName": "<subnet-name>",
    "region": "<azure-region-lowercase>"
  }
}
```

## User flow

1. The user selects an approved VNet.
2. CloudHub derives the subscription and region from that VNet metadata.
3. The region field is read-only and cannot mismatch the VNet region.
4. CloudHub retrieves subnets from the selected VNet.
5. Gateway, firewall, bastion, reserved, delegated, and zero-capacity subnets are hidden.
6. The subnet list displays CIDR, used addresses, and available addresses. Availability of 32 or fewer addresses is marked `Low IP Capacity`.
7. The create review shows the selected VNet, subnet, deployment resource group, and available IP count.

The backend repeats all VNet, region, subnet, and capacity checks during creation. A caller cannot bypass onboarding by submitting a different subscription, VNet, or subnet in the request.

## Azure permissions

The backend identity needs permission to read the selected virtual network and subnet resources. The same identity is used for subnet discovery and capacity calculation.

## Required profile names

`CLOUDHUB_NETWORKS_JSON` is shared by every provisioning feature, and each one
looks up a specific profile **name**. A missing profile is never a server
error — it is a disabled button or an empty dropdown, so it is easy to miss.

| Profile | Match | Used by | Symptom when absent |
| ------- | ----- | ------- | ------------------- |
| `testvm` | exact | Test VM card | "Provisioning is not configured"; create refused |
| `gpu-a100*` | prefix | GPU Compute, A100 | "Approved VNet" dropdown empty |
| `gpu-h100*` | prefix | GPU Compute, H100 | "Approved VNet" dropdown empty |

Configuring only `gpu-*` profiles silently disables Test VM creation, and
configuring only `testvm` silently leaves GPU Compute with no VNets. Set all of
them.
Profile names are load bearing. GPU Compute looks for profiles prefixed
`gpu-<sku>` (`gpu-a100*`, `gpu-h100*`) for the SKU the user selected, and falls
back to generic `gpu*` profiles only if no SKU-specific profile exists. A
profile named anything else is invisible to GPU Compute. Prefer
`gpu-a100-<name>` / `gpu-h100-<name>`.

The value should be kept on a single line in `.env` to avoid accidental parsing issues.

## Deployment Configuration Locations

Configure `CLOUDHUB_NETWORKS_JSON` in all three places:

1. GitHub Environment (`production`): set Secret or Variable `CLOUDHUB_NETWORKS_JSON`.
2. Deployment pipeline: `.github/workflows/deploy-fe-be-prod-basic.yml` validates and forwards `CLOUDHUB_NETWORKS_JSON`.
3. Azure App Service (`cloudhub-backend`): app setting `CLOUDHUB_NETWORKS_JSON` must be present after deploy.

Redeploy the backend after changing profiles.

`GPU_ONBOARDED_VNETS_JSON` is the retired predecessor. No code reads it. It was
a JSON *array* and carried no `subnetName`, so its value cannot be reused
as-is — reshape it into the profile-keyed object above.

## Other prerequisites for GPU creation

Network onboarding alone is not sufficient. Creation also requires:

- **`AZURE_SUBSCRIPTION_ID`** (or `GPU_AZURE_SUBSCRIPTION_ID`) on the backend.
  `GpuQuotaService` resolves vCPU-family quota against it; unset, every quota
  check fails with "Unable to validate GPU quota".
- **Non-zero GPU quota** in the profile's region for the requested family
  (`StandardNCADSA100v4Family` for a100, `StandardNCadsH100v5Family` for h100).
  A GPU VM costs 24 vCPUs (a100) or 80 (h100), and creation is refused with 409
  when the remaining quota is smaller. Check with:

  ```bash
  az vm list-usage -l <region> \
    --query "[?contains(name.value,'NCADSA100v4')||contains(name.value,'NCadsH100v5')]" -o table
  ```

  A fresh subscription reports `limit 0` for both families and needs a quota
  increase request before GPU Compute can provision anything.
- **`GPU_ENTRA_GROUP_ID`**, and `GPU_GRAPH_ENABLED=true` when sign-in tokens
  carry no group claims. Authorization fails closed.

## Troubleshooting

Both of the failure modes below are silent — the request succeeds and returns an
empty list, so the form simply cannot be completed.

| Symptom | Cause |
| ------- | ----- |
| "Approved VNet" dropdown empty | No `gpu-*` profile resolved. Check `CLOUDHUB_NETWORKS_JSON` is set on the backend and that profile names carry the `gpu-<sku>` prefix. `GET /api/deployment-control-plane/gpu-instances/network-profiles` reports what the backend resolved per SKU, including whether it fell back to generic profiles. |
| VNet selected, "Subnet" dropdown empty | Every subnet in the VNet was filtered out — all delegated, Azure-reserved by name, tagged `platform-reserved`, or at zero free addresses. |

Do not add arbitrary VNet discovery to the GPU workflow. To onboard another GPU network, add another `gpu-*` profile and redeploy.
