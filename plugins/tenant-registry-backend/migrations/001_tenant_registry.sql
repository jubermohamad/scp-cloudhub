CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY,
    tenant_name VARCHAR(255) UNIQUE NOT NULL,
    business_unit VARCHAR(255),
    cloud_provider VARCHAR(50) NOT NULL,
    subscription_id VARCHAR(255) NOT NULL,
    regions TEXT[] NOT NULL DEFAULT '{}',
    environments TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY,
    subscription_id VARCHAR(255) UNIQUE,
    subscription_name VARCHAR(255),
    cloud_provider VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS clusters (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    cluster_name VARCHAR(255),
    subscription_id VARCHAR(255),
    resource_group VARCHAR(255),
    region VARCHAR(100),
    environment VARCHAR(100),
    kubernetes_version VARCHAR(50),
    provisioning_state VARCHAR(50),
    cloud_provider VARCHAR(50),
    onboarded BOOLEAN DEFAULT FALSE,
    onboarding_state VARCHAR(50) DEFAULT 'pending',
    tags JSONB DEFAULT '{}'::jsonb,
    catalog_entity_ref VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (cluster_name, subscription_id)
);

CREATE TABLE IF NOT EXISTS environments (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    environment_name VARCHAR(100) NOT NULL,
    region VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (tenant_id, environment_name, region)
);

CREATE TABLE IF NOT EXISTS node_pools (
    id UUID PRIMARY KEY,
    cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE,
    nodepool_name VARCHAR(255),
    vm_size VARCHAR(100),
    node_count INT,
    mode VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS onboarding_audit_logs (
    id UUID PRIMARY KEY,
    actor_ref VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id VARCHAR(255),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_history (
    id UUID PRIMARY KEY,
    cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
