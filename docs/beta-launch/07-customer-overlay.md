# Customer Overlay

This is the final step after the platform baseline and workloads are already deployed.

## What it does

- Applies tenant-specific configuration on top of the platform baseline
- Keeps customer settings separate from platform-owned templates
- Supports go-live handoff after the main deployment is complete

## How to use it

1. Open the customer overlay stage.
2. Select the customer and environment.
3. Generate the overlay configuration.
4. Review the result before applying it.
5. Confirm the overlay is in place before handoff.

## Related UI

- Customer overlay stage: `/deployment?stage=s5`
- Customer onboarding: `/customer-onboarding`
- Tenant registry: `/tenant-environment-registry`
