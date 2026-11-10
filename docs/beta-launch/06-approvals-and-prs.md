# Approvals and PRs

CloudHub uses a review-first workflow for changes that affect infrastructure or deployments.

## The rule

Do not treat a generated plan as approval.

## AKS requests

- The cluster request creates a reviewable plan first.
- Git work starts after approval is complete.
- The generated PR must be merged before provisioning continues.
- Larger profiles can require more than one approver.

## Deployment wizard requests

The wizard follows this sequence:

1. Generate Helmfile
2. Validate
3. Send for Review & Approval
4. Approve
5. Deploy

## Approval guidance

- Use the approval step to confirm the payload before deployment.
- Do not bypass the gate for production work.
- If a request is rejected, fix the source issue before resubmitting.

## Related UI

- AKS: `/deployment?stage=s2`
- SRI: `/deployment?stage=s3`
- NetReveal: `/deployment?stage=s4`
