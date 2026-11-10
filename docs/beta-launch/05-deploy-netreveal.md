# Deploy NetReveal

This is the Professional Services deployment flow for NetReveal solutions.

## Wizard flow

1. Landing
2. Environment
3. Solutions
4. Components
5. Review
6. Deploying

## What the wizard expects

- Environment
- Cluster
- Namespace
- Solution selection
- Supporting components
- Review before deploy

## Practical order

1. Pick the environment first.
2. Choose the target cluster and namespace.
3. Select the solution profile.
4. Enable any required supporting components.
5. Review the generated configuration.
6. Deploy only after the review is correct.

## Notes

- The wizard auto-sets some values when the environment changes.
- It warns when a solution is selected without the required engine.
- Production deployments should always go through review and approval.

## Related UI

- NetReveal stage: `/deployment?stage=s4`
