CREATE TABLE IF NOT EXISTS control_plane_tenants (
    id UUID PRIMARY KEY,
    tenant_name VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane_clusters (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES control_plane_tenants(id),
    cluster_name VARCHAR(255),
    environment VARCHAR(100),
    region VARCHAR(100),
    subscription_id VARCHAR(255),
    cloud_provider VARCHAR(50),
    kubernetes_version VARCHAR(50),
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE control_plane_clusters ADD COLUMN IF NOT EXISTS status VARCHAR(50);

CREATE TABLE IF NOT EXISTS control_plane_node_pools (
    id UUID PRIMARY KEY,
    cluster_id UUID REFERENCES control_plane_clusters(id),
    nodepool_name VARCHAR(255),
    vm_size VARCHAR(100),
    node_count INT,
    mode VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS control_plane_platform_deployments (
    id UUID PRIMARY KEY,
    cluster_id VARCHAR(255),
    platform_version VARCHAR(100),
    deployment_status VARCHAR(50),
    deployed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane_tenant_overlays (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES control_plane_tenants(id),
    cluster_id VARCHAR(255),
    overlay_version VARCHAR(100),
    deployment_status VARCHAR(50),
    deployed_by VARCHAR(255),
    deployed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane_audit_logs (
    id UUID PRIMARY KEY,
    actor_ref VARCHAR(255) NOT NULL,
    persona VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id VARCHAR(255),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW()
);
