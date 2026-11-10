# Tenant isolation

A tenant can never see another tenant's exports, jobs, clusters, agents, destinations or audit events, and can never cause data to be delivered to another tenant's destination or location.

## Enforcement points

| Layer | Mechanism |
|---|---|
| **Query** | Every user list is filtered in SQL by `tenant_id = ANY(<caller's tenants>)`: exports, jobs, clusters, agents, audit and the dashboard aggregates. Destinations are filtered to shared ones plus the caller's tenants. Platform admins have no filter. |
| **Read** | A single record outside the caller's tenants returns **404**, the same response as a record that doesn't exist. |
| **Write** | Creating or changing an export, destination or job requires tenant admin on the record's tenant (both tenants when moving an export). |
| **References** | An export's cluster must belong to the same tenant and environment, and its destination must be shared or the same tenant's. Both are checked on every create and update. |
| **Execution** | Jobs carry the tenant at creation. An agent can only claim jobs for its own cluster, and that cluster belongs to exactly one tenant. Progress, complete and fail calls are rejected (404) for jobs on other clusters, and rejected (409) for jobs not assigned to that agent. |
| **Storage** | Every delivery path starts with `tenant/<tenant>/`, which the control plane builds from the job's tenant, not from anything the agent supplies. A shared ADLS destination therefore still separates tenants by path; grant consumers access per tenant directory. |
| **Destination checks** | An agent's live-check results are applied only to destinations its own cluster's exports use. |
| **Watermarks** | Kept per profile, and carry the tenant. |

## Verifying

The PostgreSQL integration suite (`plugins/data-export-hub-backend/src/__tests__/dataExport.integration.test.ts`) asserts:

- another tenant's admin gets 404 on an export and on its jobs;
- that tenant's lists and dashboard are empty;
- a tenant user cannot create, run, retry or cancel;
- an agent cannot claim, progress or complete another cluster's job;
- an export cannot target another tenant's cluster or destination;
- the audit trail a tenant admin sees contains only their tenant.
