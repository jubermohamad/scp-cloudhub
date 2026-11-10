env         = "${{ values.environment }}"
region_code = "${{ values.primaryRegionCode }}"
tenancy     = "st"
tenant_id   = "${{ values.customer }}"
location    = "${{ values.location }}"

create_resource_group = true
resource_group_name   = "${{ values.resourceGroupName }}"

create_vnet             = true
address_space           = ["10.109.0.0/16"]
subnet_address_prefixes = ["10.109.0.0/18"]
dns_prefix              = "${{ values.clusterName }}"

kubernetes_version = "${{ values.kubernetesVersion }}"
service_cidr       = "172.16.0.0/16"
dns_service_ip     = "172.16.0.10"

identity_ids = ["${{ values.identityId }}"]

default_node_pool = {
  name                 = "nodepool1"
  vm_size              = "${{ values.nodeSizeOption }}"
  node_count           = 1
  auto_scaling_enabled = true
  min_count            = 1
  max_count            = 3
}

tags = {
  customer = "${{ values.customer }}"
}
