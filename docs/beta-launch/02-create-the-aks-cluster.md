# Create the AKS Cluster

This is the platform foundation step.

## Flow

The AKS wizard follows this order:

1. Profile
2. Configure
3. Review
4. Submit
5. Approval
6. Provision

## What the wizard does

- Builds the cluster plan from the form inputs
- Creates the infrastructure request
- Opens the Git-based work item for review and approval
- Defers Git operations until the approval chain is complete
- Provisions the cluster after approval

## What to enter

- Cluster profile
- Customer
- Business unit
- Azure subscription
- Resource group information
- Region and Kubernetes version
- Node size and node counts
- Owner and cost center

## How to use it

1. Open the AKS stage from Deployment.
2. Fill in the cluster and customer details.
3. Review the generated plan carefully.
4. Submit only when the plan is correct.
5. Wait for approval.
6. Merge the generated PR when the request is approved.
7. Track provisioning until the cluster is ready.

## Approval note

For larger profiles, the approval chain can include more than Platform Team. Do not assume the plan means the cluster is approved.

## Related UI

- AKS stage: `/deployment?stage=s2`
- Cluster create route: `/create/aks`
