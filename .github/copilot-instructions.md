# GitHub Copilot Workspace Instructions

## Environment Safety Rules

This repository is authorized to interact ONLY with the following AKS cluster:

- aks-scp-dev-sdc-st-cms

## Kubernetes Restrictions

Before proposing, generating, or executing any kubectl, helm, az aks, or Kubernetes-related command:

1. Verify the current context.
2. Confirm the target cluster is:
   aks-scp-dev-sdc-st-cms
3. If the context is different, stop and warn the user.

Never:

- Switch Kubernetes contexts automatically.
- Access production clusters.
- Access staging clusters.
- Access any AKS cluster other than aks-scp-dev-sdc-st-cms.
- Generate commands that modify resources in any other cluster.

## Required Validation

Always run and display:

```bash
kubectl config current-context
```

Expected output:

```text
aks-scp-dev-sdc-st-cms
```

If any other context is active:

- Do not proceed.
- Explain the risk.
- Ask the user to switch back to aks-scp-dev-sdc-st-cms.

## Azure Commands

For any AKS operation:

- Use only the AKS cluster aks-scp-dev-sdc-st-cms.
- Do not retrieve credentials for any other cluster.
- Do not generate Azure CLI commands targeting other AKS clusters.

## Destructive Operations

Before proposing or executing any command involving:

- delete
- apply
- replace
- patch
- scale
- upgrade
- restart

Require confirmation that the current context is:

aks-scp-dev-sdc-st-cms

## Examples

Allowed:

```bash
kubectl config current-context
kubectl get pods -A
kubectl get nodes
```

Only if context equals:

```text
aks-scp-dev-sdc-st-cms
```

Not Allowed:

```bash
kubectl config use-context aks-prod-*
az aks get-credentials --name aks-prod-*
kubectl delete *
```

against any cluster other than:

```text
aks-scp-dev-sdc-st-cms
```
