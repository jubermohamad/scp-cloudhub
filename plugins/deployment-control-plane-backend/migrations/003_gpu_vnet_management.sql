-- Migration: Add GPU VNet onboarding management tables
-- Allows admins to manage which VNets are available for GPU instance creation

CREATE TABLE IF NOT EXISTS control_plane_gpu_vnets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id VARCHAR(255) NOT NULL,
    resource_group VARCHAR(255) NOT NULL,
    vnet_name VARCHAR(255) NOT NULL,
    region VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(subscription_id, resource_group, vnet_name, region)
);

CREATE TABLE IF NOT EXISTS control_plane_gpu_vnet_skus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vnet_id UUID NOT NULL REFERENCES control_plane_gpu_vnets(id) ON DELETE CASCADE,
    gpu_sku VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(vnet_id, gpu_sku)
);

CREATE INDEX idx_gpu_vnets_region ON control_plane_gpu_vnets(region);
CREATE INDEX idx_gpu_vnets_sku ON control_plane_gpu_vnet_skus(gpu_sku);
