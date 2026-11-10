# CloudHub Beta Launch Runbooks

Use these runbooks in order when preparing a beta deployment.

## Recommended order

1. [Access and secrets](./01-access-and-secrets.md)
2. [Create the AKS cluster](./02-create-the-aks-cluster.md)
3. [Deploy common-res](./03-deploy-common-res.md)
4. [Deploy SRI workloads](./04-deploy-sri-workloads.md)
5. [Deploy NetReveal](./05-deploy-netreveal.md)
6. [Approvals and PRs](./06-approvals-and-prs.md)
7. [Customer overlay](./07-customer-overlay.md)

## What this set covers

- 1Password access and secret handling
- AKS cluster creation through the review and approval workflow
- Shared baseline deployment with `common-res`
- AIStore, DetectionHub, and SRI AML deployment flows
- NetReveal deployment flow
- PR creation, approvals, and merge order
- Final customer overlay deployment

## Product rule

Do not skip ahead. CloudHub is designed to work as a chained workflow:
access -> cluster -> baseline -> workload -> overlay.
