# Deploy SRI Workloads

Use the SRI deploy page for AIStore, DetectionHub, and SRI AML.

## Options on the page

- AIStore: direct deploy card
- DetectionHub: component picker first, then the wizard
- SRI AML: multi-module deploy with one approval gate per selected module

## AIStore

1. Choose the AIStore card.
2. Enter the application instance name.
3. Select the target cluster.
4. Run the wizard through review and deploy.

## DetectionHub

1. Choose the DetectionHub card.
2. Pick the exact component in the selector.
3. Enter the application instance name.
4. Review the payload and deploy.

## SRI AML

1. Choose the SRI AML card.
2. Select the modules you want to deploy.
3. Enter a unique application instance name for each module.
4. Select the target AKS cluster.
5. Deploy each selected module through the wizard.

## Related UI

- SRI deploy stage: `/deployment?stage=s3`
