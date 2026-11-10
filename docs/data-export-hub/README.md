# Data Export Hub

Data Export Hub is CloudHub's control plane for scheduled exports from SymphonyAI product databases (NetReveal first) running on 70+ AKS clusters. CloudHub holds the catalog, the export definitions and the cluster and agent registries. It schedules work and tracks every run. An agent on each cluster does the extraction and delivery. CloudHub itself never runs SQL, generates files or touches customer data.

## Documents

| Document | Read it to… |
|---|---|
| [Architecture](architecture.md) | understand the components and how a run flows end to end |
| [Data model](data-model.md) | look up any table, column or state |
| [Control plane](control-plane.md) | work on the CloudHub backend plugin and its API |
| [Scheduler](scheduler.md) | understand how schedules become jobs, and how jobs are reclaimed |
| [Agent design](agent-design.md) | work on or operate `data-export-agent` |
| [Cluster registry](cluster-registry.md) | register clusters, or understand Platform Registry sync and retirement |
| [Data catalog](data-catalog.md) | publish or maintain datasets |
| [Watermark processing](watermark-processing.md) | understand incremental exports |
| [RBAC](rbac.md) | grant access or reason about who can do what |
| [Security](security.md) | review identities, secrets, network paths and database guardrails |
| [Tenant isolation](tenant-isolation.md) | verify one tenant can never see or receive another's data |
| [ADLS structure](adls-structure.md) | find delivered files, or build a consumer |
| [Manifest format](manifest-format.md) | validate a delivery |
| [Operational guide](operational-guide.md) | run the platform day to day |
| [Runbooks](runbooks.md) | respond to an alert or a failed export |
| [Disaster recovery](disaster-recovery.md) | plan for or recover from loss of a component |
| [Troubleshooting](troubleshooting.md) | diagnose a specific error message |
| [Onboarding guide](onboarding-guide.md) | bring a new tenant or cluster live, using configuration only |

The API contract is in `plugins/data-export-hub-backend/openapi.yaml`. The agent protocol is in `services/data-export-agent/src/protocol.ts`.

## Code map

| Path | What it is |
|---|---|
| `plugins/data-export-hub/` | Frontend: dashboard, catalog, exports, destinations, executions, clusters, agents, administration |
| `plugins/data-export-hub-backend/` | Control plane API (plugin id `data-export`, served under `/api/data-export`), schema migrations, agent gateway |
| `plugins/data-export-scheduler/` | Backstage backend plugin that creates, dispatches and reclaims jobs, and triggers cluster sync |
| `services/data-export-agent/` | The cluster agent (Node.js service, its own container image) |
| `charts/platform/data-export-agent/` | Helm chart that deploys the agent to `cloudhub-system` on each cluster |
