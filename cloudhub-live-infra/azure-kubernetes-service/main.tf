# azure-kubernetes-service wrapper.
#
# Responsibilities:
#   1. Optionally create the resource group and VNet/subnet for the cluster.
#   2. Call the AKS module from cloudhub-azure-terraform-modules.
#
# Storage / NetApp / jumpbox / NSG / Tailscale / role bindings are intentionally
# NOT created here in this minimal scaffold — they live in their own
# wrapper modules in cloudhub-infra-as-code. The variables for them are declared so
# the tfvars files validate; wiring them up is straightforward (call each
# module from this file using the existing inputs).

#------------------------------------------------------------------------------
# Resource Group
#------------------------------------------------------------------------------
resource "azurerm_resource_group" "this" {
  count    = var.create_resource_group ? 1 : 0
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

data "azurerm_resource_group" "existing" {
  count = var.create_resource_group ? 0 : 1
  name  = var.resource_group_name
}

locals {
  resource_group_name = var.create_resource_group ? azurerm_resource_group.this[0].name : data.azurerm_resource_group.existing[0].name
}

#------------------------------------------------------------------------------
# VNet + AKS subnet (only when create_vnet = true).
# When false, var.default_node_pool.vnet_subnet_id must already point at an
# existing subnet — that is the case for the seed tfvars.
#------------------------------------------------------------------------------
resource "azurerm_virtual_network" "this" {
  count               = var.create_vnet ? 1 : 0
  name                = coalesce(var.vnet_name, "vnet-${var.tenant_id}-${var.env}-${var.region_code}")
  resource_group_name = local.resource_group_name
  location            = var.location
  address_space       = var.address_space
  tags                = var.tags
}

resource "azurerm_subnet" "aks" {
  count                                         = var.create_vnet ? 1 : 0
  name                                          = "snet-aks"
  resource_group_name                           = local.resource_group_name
  virtual_network_name                          = azurerm_virtual_network.this[0].name
  address_prefixes                              = var.subnet_address_prefixes
  private_endpoint_network_policies             = var.private_endpoint_network_policies
}

locals {
  # Node pool subnet ID: prefer wrapper-created subnet, otherwise trust tfvars.
  default_node_pool_subnet_id = var.create_vnet ? azurerm_subnet.aks[0].id : var.default_node_pool.vnet_subnet_id

  # Translate tfvars boolean → list. If user wants authorized IP ranges they
  # populate api_server_authorized_ip_ranges directly.
  api_server_authorized_ip_ranges = var.enable_authorized_ip_ranges ? var.api_server_authorized_ip_ranges : []

  # Ensure the default node pool object always references the right subnet.
  default_node_pool = merge(
    var.default_node_pool,
    { vnet_subnet_id = local.default_node_pool_subnet_id }
  )
}

#------------------------------------------------------------------------------
# AKS module call
#------------------------------------------------------------------------------
module "aks" {
  source  = "app.terraform.io/sensa-cloud-platform/aks/azurerm"
  version = "~> 1.0"

  # Naming inputs (cluster name is derived inside the module).
  env         = var.env
  region_code = var.region_code
  tenancy     = var.tenancy
  tenant_id   = var.tenant_id
  seq2        = var.seq2

  cluster_name_override = var.cluster_name_override

  location            = var.location
  resource_group_name = local.resource_group_name
  dns_prefix          = var.dns_prefix
  tags                = var.tags

  # Cluster
  kubernetes_version           = var.kubernetes_version
  sku_tier                     = var.sku_tier
  node_os_channel_upgrade      = var.node_os_channel_upgrade
  azure_policy_enabled         = var.azure_policy_enabled
  cost_analysis_enabled        = var.cost_analysis_enabled
  local_account_disabled       = var.local_account_disabled
  image_cleaner_interval_hours = var.image_cleaner_interval_hours
  disk_encryption_set_id       = var.disk_encryption_set_id

  # API server
  api_server_authorized_ip_ranges = local.api_server_authorized_ip_ranges

  # Identity
  identity_type = var.identity_type
  identity_ids  = var.identity_ids

  # Network profile
  network_plugin           = var.network_plugin
  network_policy           = var.network_policy
  load_balancer_sku        = var.load_balancer_sku
  outbound_type            = var.outbound_type
  service_cidr             = var.service_cidr
  dns_service_ip           = var.dns_service_ip
  use_managed_outbound_ips = length(var.outbound_ip_prefix_ids) == 0
  managed_outbound_ip_count = var.load_balancer_managed_outbound_ip_count
  outbound_ip_prefix_ids    = var.outbound_ip_prefix_ids

  private_cluster_enabled             = var.private_cluster_enabled
  private_cluster_public_fqdn_enabled = var.private_cluster_public_fqdn_enabled
  private_dns_zone_id                 = var.private_dns_zone_id

  # Service mesh
  enable_istio   = var.enable_istio
  istio_revision = var.istio_revision

  # Proxy
  http_proxy_config = var.http_proxy_config

  # Default + additional node pools
  default_node_pool = local.default_node_pool
  node_pools        = var.node_pools

  # Auto-scaler
  enable_auto_scaler_profile = var.enable_auto_scaler_profile
  auto_scaler_profile        = var.auto_scaler_profile
}

#------------------------------------------------------------------------------
# Outputs
#------------------------------------------------------------------------------
output "cluster_name" {
  value = try(module.aks.cluster_name, null)
}

output "cluster_id" {
  value = try(module.aks.cluster_id, null)
}

output "node_resource_group" {
  value = try(module.aks.node_resource_group, null)
}

output "oidc_issuer_url" {
  value = try(module.aks.oidc_issuer_url, null)
}

output "kube_config_raw" {
  value     = try(module.aks.kube_config_raw, null)
  sensitive = true
}
