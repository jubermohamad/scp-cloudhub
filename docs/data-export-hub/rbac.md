# RBAC

Roles come from Entra ID groups, synchronised into Backstage by the Microsoft Graph org provider. They are read from the signed-in user's ownership references on every request, matched case-insensitively. No role is stored in Data Export Hub, so granting or revoking access is a group-membership change only.

| Role | Entra group | Override |
|---|---|---|
| Platform admin | `grp-cloudhub-data-export`, `CloudHubPlatformOwners`, or `CloudHub.DataExport.Admin` | `DATA_EXPORT_ADMIN_GROUPS` adds custom groups |
| Tenant admin | `CloudHub.DataExport.Tenant.<tenant>.Admin` | prefix `DATA_EXPORT_TENANT_GROUP_PREFIX` |
| Tenant user | `CloudHub.DataExport.Tenant.<tenant>.User` | same prefix |

`<tenant>` is the tenant slug: lower-case letters, digits and hyphens, e.g. `metrobank`. A tenant admin is also a member of that tenant. One person can hold roles for several tenants.

Membership in `grp-cloudhub-data-export` or `CloudHubPlatformOwners` grants the
platform-admin role across all tenants, including catalog, cluster, agent, and
shared-destination administration. The Data Export group is verified at sign-in
against Entra group object ID `ea5a79c7-5b88-4108-9c2e-9e88bffff673` in tenant
`d0fec9dd-9219-4514-a1d8-1a872244bf6e` (SymphonyAI Sensa). Configure
`CLOUDHUB_DATA_EXPORT_GROUP_ID` to override that object ID. Entra group
membership changes apply to new sign-ins.

## Permissions

| Action | Platform admin | Tenant admin (own tenant) | Tenant user (own tenant) | No role |
|---|---|---|---|---|
| View dashboard (scoped) | All tenants | ✓ | ✓ | Empty |
| Browse data catalog and lineage | ✓ | ✓ | ✓ | ✓ |
| Register or edit datasets | ✓ | — | — | — |
| View exports, jobs, clusters, agents | All | ✓ | ✓ | — |
| Create, edit, enable, disable, delete exports; Run now | ✓ | ✓ | — | — |
| Retry or cancel jobs; download manifests and logs | ✓ | ✓ | Download only | — |
| View destinations | All | Shared + own | Shared + own | Shared |
| Create or edit tenant destinations | ✓ | ✓ | — | — |
| Create or edit shared destinations | ✓ | — | — | — |
| Register, edit, retire or restore clusters; sync from Platform Registry | ✓ | — | — | — |
| Register, edit or remove agents | ✓ | — | — | — |
| View audit trail | All | Own tenant | — | — |

Moving an export to another tenant requires admin rights on both tenants.

Records outside the caller's tenants return **404**, not 403, so their existence is not disclosed. The UI hides actions a caller cannot take, but every rule is enforced by the backend.

## Non-human callers

| Caller | Identity | Can |
|---|---|---|
| Cluster agent | Its Azure Workload Identity, registered as an agent (`identitySubject`) | Only the `/agent/*` protocol, for its own cluster's jobs |
| Scheduler plugin | Backstage service principal `plugin:data-export-scheduler` | Only `/internal/clusters/sync` |
