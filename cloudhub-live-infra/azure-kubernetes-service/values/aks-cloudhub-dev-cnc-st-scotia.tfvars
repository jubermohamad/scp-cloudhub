#------------------------------------------------------------------------------
# ENVIRONMENT AND LOCATION INFORMATION
#------------------------------------------------------------------------------
env         = "dev"
region_code = "cnc"
tenancy     = "st"
tenant_id   = "scotia"
location    = "canadacentral"

#------------------------------------------------------------------------------
# RESOURCE GROUP
#------------------------------------------------------------------------------
create_resource_group = true
resource_group_name   = "rg-cloudhub-dev-cnc-st-scotia"

#------------------------------------------------------------------------------
# STORAGE
#------------------------------------------------------------------------------
create_storage_account = false
storage_account_name   = ""
storage_container_name = ""

create_velero_storage_account = false

#------------------------------------------------------------------------------
# NETWORK
#------------------------------------------------------------------------------
create_vnet                       = true
vnet_name                         = ""
address_space                     = ["10.109.0.0/16"]
subnet_address_prefixes           = ["10.109.0.0/18"]
private_endpoint_network_policies = "Disabled"
dns_prefix                        = "aks-cloudhub-de-rg-cloudhub-dev-cnc-s-b07990"

enable_vnet_flow_logs = false

network_plugin    = "azure"
network_policy    = "calico"
load_balancer_sku = "standard"
outbound_type     = "loadBalancer"

load_balancer_managed_outbound_ip_count = 2

private_cluster_enabled             = false
private_cluster_public_fqdn_enabled = false

http_proxy_config = null

#------------------------------------------------------------------------------
# KUBERNETES CLUSTER
#------------------------------------------------------------------------------
node_os_channel_upgrade     = "NodeImage"
sku_tier                    = "Standard"
service_cidr                = "172.16.0.0/16"
dns_service_ip              = "172.16.0.10"
kubernetes_version          = "1.32.6"
enable_authorized_ip_ranges = false

identity_type = "UserAssigned"
identity_ids  = ["/subscriptions/b0799078-b42a-4b59-9e70-22cd09a20ee2/resourceGroups/rg-cloudhub-dev-cnc-st-scotia/providers/Microsoft.ManagedIdentity/userAssignedIdentities/uami-ctrl-cloudhub-dev-cnc-st-scotia"]

disk_encryption_set_id = "/subscriptions/b0799078-b42a-4b59-9e70-22cd09a20ee2/resourceGroups/RG-CloudHub-DEV-CNC-ST-SCOTIA/providers/Microsoft.Compute/diskEncryptionSets/des-cloudhub-dev-cnc-st-scotia"

azure_policy_enabled   = true
cost_analysis_enabled  = true
local_account_disabled = false

#------------------------------------------------------------------------------
# DEFAULT NODE POOL
#------------------------------------------------------------------------------
default_node_pool = {
  name                         = "nodepool1"
  vm_size                      = "Standard_E16ds_v4"
  node_count                   = 1
  os_disk_size_gb              = 400
  auto_scaling_enabled         = true
  min_count                    = 1
  max_count                    = 10
  max_pods                     = 250
  availability_zones           = []
  orchestrator_version         = "1.32.6"
  fips_enabled                 = false
  vnet_subnet_id               = "/subscriptions/b0799078-b42a-4b59-9e70-22cd09a20ee2/resourceGroups/rg-cloudhub-dev-cnc-st-scotia/providers/Microsoft.Network/virtualNetworks/vnet-cloudhub-dev-cnc-st-scotia/subnets/snet-cloudhub-dev-cnc-st-scotia"
  host_encryption_enabled      = false
  kubelet_disk_type            = "OS"
  node_labels                  = {}
  node_public_ip_enabled       = false
  only_critical_addons_enabled = false
  os_disk_type                 = "Ephemeral"
  tags                         = {}
  os_sku                       = "Ubuntu"
  upgrade_settings = {
    drain_timeout_in_minutes      = 0
    node_soak_duration_in_minutes = 0
    max_surge                     = "10%"
  }
}

#------------------------------------------------------------------------------
# TAGS
#------------------------------------------------------------------------------
tags = {
  "created"   = "2025-09-12_09:44"
  "customer"  = "scotia"
  "terraform" = "false"
}

#------------------------------------------------------------------------------
# AUTO SCALER PROFILE
#------------------------------------------------------------------------------
enable_auto_scaler_profile = true

auto_scaler_profile = {
  balance_similar_node_groups                   = false
  daemonset_eviction_for_empty_nodes_enabled    = false
  daemonset_eviction_for_occupied_nodes_enabled = true
  empty_bulk_delete_max                         = "10"
  expander                                      = "random"
  ignore_daemonsets_utilization_enabled         = false
  max_graceful_termination_sec                  = "600"
  max_node_provisioning_time                    = "15m"
  max_unready_nodes                             = 3
  max_unready_percentage                        = 45
  new_pod_scale_up_delay                        = "0s"
  scale_down_delay_after_add                    = "10m"
  scale_down_delay_after_delete                 = "10s"
  scale_down_delay_after_failure                = "3m"
  scale_down_unneeded                           = "10m"
  scale_down_unready                            = "20m"
  scale_down_utilization_threshold              = "0.5"
  scan_interval                                 = "10s"
  skip_nodes_with_local_storage                 = false
  skip_nodes_with_system_pods                   = true
}

#------------------------------------------------------------------------------
# NETAPP
#------------------------------------------------------------------------------
create_netapp_acccount         = false
netapp_subnet_address_prefixes = ""
service_level                  = "Ultra"
pool_size_in_tb                = 8

#------------------------------------------------------------------------------
# JUMPBOX VM
#------------------------------------------------------------------------------
create_jumpbox_vm = true
vm_size           = "Standard_B2s"
admin_username    = "azureuser"

use_existing_ssh_key  = true
existing_ssh_key_name = "azure_ssh_key"
existing_ssh_key_rg   = "production-devops"

join_entra_id = false

os_disk_caching              = "ReadWrite"
os_disk_storage_account_type = "Premium_LRS"
os_disk_size_gb              = 64

image_publisher = "Canonical"
image_offer     = "0001-com-ubuntu-server-jammy"
image_sku       = "22_04-lts-gen2"
image_version   = "latest"

create_nsg = true

#------------------------------------------------------------------------------
# TAILSCALE
#------------------------------------------------------------------------------
enable_tailscale = true
tailscale_tags   = ["tag:dev", "tag:jumpbox"]

#------------------------------------------------------------------------------
# ROLE
#------------------------------------------------------------------------------
create_network_contributor_role = false
