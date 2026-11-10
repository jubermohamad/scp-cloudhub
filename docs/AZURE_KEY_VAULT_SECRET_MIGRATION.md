# Azure Key Vault Secret Flow and 1Password Replacement Plan

## Purpose

This document explains how CloudHub currently handles secrets in this repository, where Azure Key Vault is already used, where 1Password is still the active deployment-readiness system, and what would be required to replace the remaining 1Password flow with Azure Key Vault.

## Current State

CloudHub currently uses two different secret systems:

1. Azure Key Vault for runtime deployment secrets consumed by the Helm deployment workflow.
2. 1Password for deployment readiness and secret provisioning inside the deployment portal.

That split is intentional in the current codebase. The Key Vault path is implemented in the deployment workflow, while the deployment wizard and backend readiness gate still rely on 1Password.

Relevant files:

- [.github/workflows/deploy-helmfile.yml](../.github/workflows/deploy-helmfile.yml)
- [plugins/deployment-control-plane-backend/src/services/onePasswordSecretReadinessService.ts](../plugins/deployment-control-plane-backend/src/services/onePasswordSecretReadinessService.ts)
- [plugins/deployment-control-plane-backend/src/services/deploymentPortalService.ts](../plugins/deployment-control-plane-backend/src/services/deploymentPortalService.ts)
- [plugins/platform-home/src/components/DeploymentWizard.tsx](../plugins/platform-home/src/components/DeploymentWizard.tsx)
- [docs/deployment-1password-communication.md](../docs/deployment-1password-communication.md)

## How Azure Key Vault Is Used Today

The deployment workflow retrieves runtime secrets from Azure Key Vault before Helm executes.

### Retrieval

In [.github/workflows/deploy-helmfile.yml](../.github/workflows/deploy-helmfile.yml), the workflow reads secrets with `az keyvault secret show` using the configured vault name:

- `helm-repo-username`
- `helm-repo-password`
- `database-password`
- `api-key`

The workflow masks sensitive values in logs after retrieval.

### Storage

The workflow itself does not generate these secrets. It assumes the secrets already exist in Key Vault and are reachable by the workflow identity.

The Key Vault management model is therefore external to the workflow and can be handled by:

- manual secret creation in Azure Portal,
- Azure CLI, or
- infrastructure as code / secret bootstrap automation.

### Runtime Consumption

Once retrieved, the values are used to:

- authenticate to Helm repositories,
- populate deployment environment variables,
- and support Helm tests and post-deploy verification.

## How 1Password Is Used Today

The deployment portal still uses 1Password for readiness gating and secret provisioning.

### Readiness Check

The backend service [onePasswordSecretReadinessService.ts](../plugins/deployment-control-plane-backend/src/services/onePasswordSecretReadinessService.ts) scans deployment files for references and validates them against 1Password.

It checks:

- direct `op://...` references,
- `ref+op://...` references,
- `{{ env "CLOUDHUB_*" }}` and `{{ requiredEnv "CLOUDHUB_*" }}` references,
- and `UPDATE_ME` placeholders in files.

It then uses read-only 1Password operations to confirm that each referenced field exists and contains a non-empty, non-placeholder value.

### Provisioning

If readiness is blocked, the backend dispatches the secure runner workflow [copy-1password-section.yml](../.github/workflows/copy-1password-section.yml).

That workflow:

- creates or updates the customer item in the `Customers` vault,
- creates the required section(s),
- generates strong random values for secret-like fields,
- and writes them back into 1Password using a write-enabled GitHub secret.

The backend never writes to 1Password directly and never exposes generated plaintext values to the browser.

### UI Flow

The deployment wizard [DeploymentWizard.tsx](../plugins/platform-home/src/components/DeploymentWizard.tsx) exposes:

- `Validate 1Password`,
- `Create & Populate 1Password Section`,
- field-level secret editing for missing values,
- and a blocked-state explanation when values are still empty or set to `UPDATE_ME`.

## Secret Shape in the Current 1Password Model

The current readiness service maps deployment metadata into a customer-scoped 1Password layout.

### Default Layout

- Vault: `Customers`
- Item: `<customer>`
- Runtime section: `<application>-<instanceName>`
- Pipeline section: `pipeline_refs`

### Reference Forms

- Runtime references use the runtime section.
- Pipeline control references use the `pipeline_refs` section.
- Environment-derived references are normalized to the same layout.

### Placeholder Rules

The readiness service treats these as failures:

- missing fields,
- empty fields,
- values still equal to `UPDATE_ME` or a similar placeholder pattern,
- and file-level `UPDATE_ME` tokens.

## What It Would Take To Replace 1Password With Azure Key Vault

This is the actual migration work needed if Key Vault is meant to fully replace 1Password for deployment readiness and secret provisioning.

### 1. Replace the backend readiness engine

The current readiness service is 1Password-specific. A Key Vault replacement would need a new backend service that:

- resolves deployment references to Key Vault secret names,
- uses Azure authentication instead of `op` authentication,
- checks that each secret exists and has a non-empty value,
- detects placeholder values if you still want placeholder-based gating,
- and returns the same readiness report shape to the UI.

This is the main abstraction boundary today:

- current implementation: [onePasswordSecretReadinessService.ts](../plugins/deployment-control-plane-backend/src/services/onePasswordSecretReadinessService.ts)
- call site: [deploymentPortalService.ts](../plugins/deployment-control-plane-backend/src/services/deploymentPortalService.ts)

### 2. Replace the provisioning workflow

The current create/populate flow writes to 1Password. A Key Vault version would need a new secure-runner workflow that:

- authenticates to Azure,
- creates the vault if needed, or assumes it already exists,
- sets or updates each secret with `az keyvault secret set` or the Azure SDK,
- generates secret values for passwords, keys, certificates, and tokens,
- and optionally applies tags/metadata for traceability.

This workflow would replace [copy-1password-section.yml](../.github/workflows/copy-1password-section.yml).

### 3. Redesign the secret naming model

1Password supports vault / item / section / field, while Key Vault is flat at the secret-name level.

That means the current structure must be translated.

Typical options:

- one vault per customer,
- one vault per environment,
- or one shared vault with a strict naming convention.

Recommended naming pattern if you want to preserve the current logical layout:

- `customer--application-instance--field`
- `customer--pipeline-refs--instance__field`

If you keep the same logical split, you also need a translation layer for:

- runtime values,
- pipeline values,
- and any environment-derived references.

### 4. Rework section semantics

Key Vault has no native concept of sections.

If the current section model matters, you need one of these:

- encode section names into secret names,
- store section metadata as tags,
- or maintain a manifest file that maps logical sections to Key Vault secrets.

Without that mapping, the current `runtime section` and `pipeline_refs` behavior cannot be preserved as-is.

### 5. Update authentication and RBAC

The 1Password flow currently uses:

- `OP_SERVICE_ACCOUNT_TOKEN`, or
- `OP_CONNECT_HOST` + `OP_CONNECT_TOKEN`.

A Key Vault implementation would instead need Azure credentials for:

- the secure runner workflow,
- the backend readiness checker,
- and any operator-facing bootstrap path.

Depending on the deployment model, this likely means:

- managed identity for the runner,
- or a service principal / federated workload identity.

You would also need the correct Key Vault roles, such as:

- Secrets User for read-only validation,
- Secrets Officer or Administrator for provisioning,
- and whatever least-privilege custom role set your security team approves.

### 6. Update the portal UI and backend endpoints

The UI can stay mostly the same from the user’s perspective, but the labels and result text need to stop saying 1Password if the backend now uses Key Vault.

Likely changes:

- rename `Validate 1Password` to `Validate Key Vault` or `Validate Secrets`,
- rename `Create & Populate 1Password Section` to a Key Vault bootstrap action,
- update the blocked-state guidance,
- and update the detailed results formatting if secret names replace 1Password references.

The backend API can stay stable if you keep the same endpoint contract and only swap the provider implementation.

### 7. Update reference extraction logic

The current parser discovers references by scanning deployment files for 1Password and env-style references.

A Key Vault migration would need to decide whether to keep those same reference syntaxes or move to a new one.

If you keep them, the parser only needs a different resolver.

If you change them, you must update:

- file scanning,
- reference normalization,
- placeholder detection,
- field categorization,
- and any tests that assert current reference formats.

### 8. Plan the migration path

The cleanest cutover would be:

1. Keep the current 1Password flow working.
2. Add a Key Vault-backed readiness/provisioning provider.
3. Dual-check both providers for a short transition period.
4. Migrate secrets into Key Vault.
5. Flip the wizard and backend to Key Vault as the default.
6. Remove 1Password-specific code after validation.

If you want a hard replacement instead of a transition, then the secret migration step must happen before the backend switch.

## Practical Implementation Checklist

To fully replace 1Password with Azure Key Vault, expect to touch:

- `plugins/deployment-control-plane-backend/src/services/onePasswordSecretReadinessService.ts`
- `plugins/deployment-control-plane-backend/src/services/deploymentPortalService.ts`
- `.github/workflows/copy-1password-section.yml`
- `.github/workflows/onepassword-readiness.yml`
- `.github/scripts/onepassword-readiness.mjs`
- `plugins/platform-home/src/components/DeploymentWizard.tsx`
- deployment-related tests for readiness and provisioning
- environment variable configuration in `.env.example`, app config, and workflow secrets

You will also need a documented secret-naming standard and a migration plan for existing customer items.

## Recommendation

If the goal is to keep the current behavior stable while moving away from 1Password, do not try to make Key Vault mimic 1Password one-for-one at the storage layer.

Instead:

- keep the current logical deployment-secret model,
- add a provider abstraction,
- and translate that model into Key Vault naming and RBAC.

That keeps the user-facing workflow intact while making the backend portable.

## Bottom Line

Today, this repository already knows how to:

- retrieve deployment/runtime secrets from Azure Key Vault in the Helm workflow,
- validate and provision deployment-readiness secrets in 1Password,
- and gate deployment based on those readiness checks.

What it does not yet have is a Key Vault replacement for the 1Password readiness/provisioning path.

To replace 1Password completely, you need a new Azure-backed provider, a new secure-runner provisioning workflow, a secret-name translation strategy, Azure RBAC/authentication, and a migration plan for existing secrets.