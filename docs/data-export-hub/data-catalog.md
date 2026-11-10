# Data catalog

The catalog lists every dataset that can be exported. It is shared by all tenants and maintained by platform admins (`grp-cloudhub-data-export` or `CloudHubPlatformOwners`). Tenants choose from it when they build exports; they cannot change it.

## What a dataset records

| Area | Fields |
|---|---|
| Identity | `datasetId` (catalog code, e.g. `NR_V_CASES`, immutable), display name |
| Business | Business description, source product (NetReveal, SRI, AIStore, Eureka, SensaAI Sanctions), source domain, category (Alerts, Cases, Customers, CDD, Workflow, Screening, Audit, Reference Data), owner team, support email, refresh pattern, estimated daily volume, retention days |
| Governance | Classification (Public, Internal, Confidential, Restricted), contains PII, contains sensitive data |
| Structure | Column metadata (name, type, description, nullable, pii), primary keys, source tables, sample schema (JSON) |
| Extraction | SQL template, incremental support, watermark column, watermark strategy notes |
| Lineage | `dependsOn`, the upstream datasets |
| State | Enabled |

Rules enforced by the API:

- incremental support requires a watermark column;
- a dataset with PII cannot be classified Public;
- the SQL template must be a single `SELECT` or `WITH … SELECT`;
- dependencies must exist, and must not create a cycle (checked against everything downstream);
- `datasetId` cannot change after registration.

## Publishing a dataset

1. **Register** it: Datasets → Register, or Administration → Register Dataset.
2. **Fill in** business metadata, classification and column metadata.
3. **Add the SQL template.** It runs on each cluster's read replica in a read-only session ([security](security.md#database-guardrails)). An export cannot include a dataset without a template.
4. **For incremental export,** set the watermark column: a monotonically increasing timestamp or sequence in the template's output.
5. **Enable** it. It counts towards *Datasets Published* on the dashboard.

Disabling a dataset blocks new exports that use it. Scheduled jobs that reference it fail at dispatch with "Dataset … is disabled".

## Seed data

On first start, six NetReveal datasets are inserted if absent: `NR_V_CASES`, `NR_V_CC_ALERTS`, `NR_CUSTOMERS`, `NR_WORKFLOW_NOTE`, `NR_WLM_SWIFT_MATCH_DETAILS` and `NR_CUSTOMER_DYNAMIC`. The seed also adds one lineage edge, `NR_CUSTOMER_DYNAMIC` depends on `NR_CUSTOMERS`.

They are classified Confidential with PII, because NetReveal AML data carries personal data. They have **no SQL template or column metadata** until an admin confirms them, so they cannot be exported yet. Seeds never overwrite existing rows, and seed lineage is only added when the seed itself creates both datasets.

## Dependency graph

The dataset detail page draws upstream and downstream datasets with `reactflow`, from `GET /datasets/{id}/lineage`. That endpoint returns every dataset reachable in either direction, plus the edges between them.
