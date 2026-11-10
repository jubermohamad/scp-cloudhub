# Deploy common-res

`common-res` installs shared platform infrastructure that other workloads depend on.

## When to use it

Deploy `common-res` before SAI applications or any product stack that depends on shared operators, controllers, or cluster services.

## What to do

1. Open the common-res stage in Deployment.
2. Select the CloudHub-eligible cluster.
3. Pick the components you actually need.
4. Enter a clear application instance name.
5. Deploy the shared baseline.

## Good practice

- Keep the component set minimal.
- Use one instance name per deployment so the generated pipeline payload is traceable.
- Do not deploy workload-specific overlays before the shared baseline is ready.

## Related UI

- common-res stage: `/deployment?stage=common-res`
