# ─────────────────────────────────────────────────────────────────────────────
# CloudHub workspace registry
#
# One entry per provisioned resource, keyed by Terraform module. CloudHub's
# AKS provisioning flow (InfrastructureProvisioningService) appends a new
# cluster entry under "azure-kubernetes-service-standard" on every approved
# request, on a feature branch that is PR'd back into main.
#
# Do not hand-edit entries the portal manages; add manual workspaces in a
# separate module block.
# ─────────────────────────────────────────────────────────────────────────────

"azure-kubernetes-service-standard" = {
}
