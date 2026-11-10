#------------------------------------------------------------------------------
# ENVIRONMENT AND LOCATION (consumed by the naming module)
#------------------------------------------------------------------------------
variable "env"         { type = string }
variable "region_code" { type = string }
variable "tenancy"     { type = string }
variable "tenant_id"   { type = string }
variable "cluster_profile" {
  type        = string
  default     = "single-region"
  description = "CloudHub profile used to pre-populate AKS defaults (free, demo, single-region, active-passive, active-active)."
}
variable "location"    { type = string }
variable "seq2" {
  description = "Optional name suffix used by the naming module."
  type        = string
  default     = null
}
variable "cluster_name_override" {
  type    = string
  default = null
}

#------------------------------------------------------------------------------
# RESOURCE GROUP
#------------------------------------------------------------------------------
variable "create_resource_group" { type = bool   default = true }
variable "resource_group_name"   { type = string }

#------------------------------------------------------------------------------
# STORAGE / VELERO / NETAPP / JUMPBOX / TAILSCALE / NSG / ROLE
# These are consumed by the wider cloudhub-infra-as-code/azure-kubernetes-service
# wrapper modules (storage, jumpbox, etc). Declared here so the tfvars file
# parses; not all are wired in this minimal scaffold.
#------------------------------------------------------------------------------
variable "create_storage_account"        { type = bool   default = false }
variable "storage_account_name"          { type = string default = "" }
variable "storage_container_name"        { type = string default = "" }
variable "create_velero_storage_account" { type = bool   default = false }

variable "create_netapp_acccount"        { type = bool   default = false }
variable "netapp_subnet_address_prefixes" { type = string default = "" }
variable "service_level"                 { type = string default = "Ultra" }
variable "pool_size_in_tb"               { type = number default = 8 }

variable "create_jumpbox_vm"            { type = bool   default = false }
variable "vm_size"                      { type = string default = "Standard_B2s" }
variable "admin_username"               { type = string default = "azureuser" }
variable "use_existing_ssh_key"         { type = bool   default = true }
variable "existing_ssh_key_name"        { type = string default = "" }
variable "existing_ssh_key_rg"          { type = string default = "" }
variable "join_entra_id"                { type = bool   default = false }
variable "os_disk_caching"              { type = string default = "ReadWrite" }
variable "os_disk_storage_account_type" { type = string default = "Premium_LRS" }
variable "os_disk_size_gb"              { type = number default = 64 }
variable "image_publisher"              { type = string default = "Canonical" }
variable "image_offer"                  { type = string default = "0001-com-ubuntu-server-jammy" }
variable "image_sku"                    { type = string default = "22_04-lts-gen2" }
variable "image_version"                { type = string default = "latest" }
variable "create_nsg"                   { type = bool   default = true }

variable "enable_tailscale" { type = bool         default = false }
variable "tailscale_tags"   { type = list(string) default = [] }

variable "create_network_contributor_role" { type = bool default = false }

#------------------------------------------------------------------------------
# NETWORK (wrapper-managed VNet)
#------------------------------------------------------------------------------
variable "create_vnet"                       { type = bool          default = true }
variable "vnet_name"                         { type = string        default = "" }
variable "address_space"                     { type = list(string) }
variable "subnet_address_prefixes"           { type = list(string) }
variable "private_endpoint_network_policies" { type = string        default = "Disabled" }
variable "enable_vnet_flow_logs"             { type = bool          default = false }

#------------------------------------------------------------------------------
# AKS NETWORK PROFILE
#------------------------------------------------------------------------------
variable "dns_prefix"        { type = string }
variable "network_plugin"    { type = string default = "azure" }
variable "network_policy"    { type = string default = "calico" }
variable "load_balancer_sku" { type = string default = "standard" }
variable "outbound_type"     { type = string default = "loadBalancer" }

# Tfvars uses `load_balancer_managed_outbound_ip_count`; module uses
# `managed_outbound_ip_count`. We translate in main.tf.
variable "load_balancer_managed_outbound_ip_count" {
  type    = number
  default = 2
}
variable "outbound_ip_prefix_ids" {
  type    = list(string)
  default = []
}

variable "private_cluster_enabled"             { type = bool   default = false }
variable "private_cluster_public_fqdn_enabled" { type = bool   default = false }
variable "private_dns_zone_id" {
  type    = string
  default = null
}

variable "http_proxy_config" {
  type    = any
  default = null
}

#------------------------------------------------------------------------------
# CLUSTER
#------------------------------------------------------------------------------
variable "node_os_channel_upgrade"     { type = string default = "NodeImage" }
variable "sku_tier"                    { type = string default = "Standard" }
variable "service_cidr"                { type = string }
variable "dns_service_ip"              { type = string }
variable "kubernetes_version"          { type = string }
variable "image_cleaner_interval_hours" {
  type    = number
  default = 168
}

# Tfvars boolean toggle. Real list of CIDRs goes via api_server_authorized_ip_ranges.
variable "enable_authorized_ip_ranges" { type = bool default = false }
variable "api_server_authorized_ip_ranges" {
  type    = list(string)
  default = []
}

variable "identity_type" { type = string default = "UserAssigned" }
variable "identity_ids"  { type = list(string) }

variable "disk_encryption_set_id" {
  type    = string
  default = null
}

variable "azure_policy_enabled"   { type = bool default = true }
variable "cost_analysis_enabled"  { type = bool default = true }
variable "local_account_disabled" { type = bool default = false }

# Service mesh
variable "enable_istio"   { type = bool   default = false }
variable "istio_revision" { type = string default = "asm-1-21" }

#------------------------------------------------------------------------------
# DEFAULT NODE POOL
#------------------------------------------------------------------------------
variable "default_node_pool" {
  description = "Default (system) node pool — mirrors azurerm_kubernetes_cluster.default_node_pool"
  type = object({
    name                         = string
    vm_size                      = string
    node_count                   = number
    os_disk_size_gb              = number
    auto_scaling_enabled         = bool
    min_count                    = number
    max_count                    = number
    max_pods                     = number
    availability_zones           = list(string)
    orchestrator_version         = string
    fips_enabled                 = bool
    vnet_subnet_id               = string
    host_encryption_enabled      = bool
    kubelet_disk_type            = string
    node_labels                  = map(string)
    node_public_ip_enabled       = bool
    only_critical_addons_enabled = bool
    os_disk_type                 = string
    tags                         = map(string)
    os_sku                       = string
    upgrade_settings = object({
      drain_timeout_in_minutes      = number
      node_soak_duration_in_minutes = number
      max_surge                     = string
    })
  })
}

#------------------------------------------------------------------------------
# ADDITIONAL NODE POOLS (passed through to azurerm_kubernetes_cluster_node_pool)
#------------------------------------------------------------------------------
variable "node_pools" {
  type    = any
  default = {}
}

#------------------------------------------------------------------------------
# AUTO SCALER PROFILE
# Permissive type: tfvars carries extra fields the module ignores (unready,
# daemonset eviction, etc). `any` keeps that working without churn.
#------------------------------------------------------------------------------
variable "enable_auto_scaler_profile" { type = bool default = true }
variable "auto_scaler_profile"        { type = any  default = null }

#------------------------------------------------------------------------------
# TAGS
#------------------------------------------------------------------------------
variable "tags" {
  type    = map(string)
  default = {}
}
