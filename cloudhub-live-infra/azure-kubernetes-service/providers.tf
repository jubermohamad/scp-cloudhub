provider "azurerm" {
  features {}
  # Auth via OIDC: workflows export ARM_USE_OIDC=true and ARM_CLIENT_ID /
  # ARM_TENANT_ID / ARM_SUBSCRIPTION_ID. Terraform Cloud workspaces may also
  # supply these via a variable set.
}
