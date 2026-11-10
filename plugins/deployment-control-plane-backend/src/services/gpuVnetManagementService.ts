import type { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { GpuOnboardedVnet, GpuSkuId } from '../types';

export interface GpuVnetRecord {
  id: string;
  subscriptionId: string;
  resourceGroup: string;
  vnetName: string;
  region: string;
  gpuSkus: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateGpuVnetInput {
  subscriptionId: string;
  resourceGroup: string;
  vnetName: string;
  region: string;
  gpuSkus?: ('a100' | 'h100')[];
}

export interface UpdateGpuVnetInput {
  gpuSkus?: ('a100' | 'h100')[];
}

export class GpuVnetManagementService {
  constructor(
    private readonly getPool: () => Pool | null,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Create a new GPU VNet entry or update if already exists
   */
  async createOrUpdateVnet(input: CreateGpuVnetInput): Promise<GpuVnetRecord> {
    const pool = this.getPool();
    if (!pool) {
      throw new Error('Database pool is not available');
    }

    this.validate(input);

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Upsert VNet
        const vnetResult = await client.query(
          `INSERT INTO control_plane_gpu_vnets (subscription_id, resource_group, vnet_name, region, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (subscription_id, resource_group, vnet_name, region) DO UPDATE SET updated_at = NOW()
           RETURNING id, subscription_id, resource_group, vnet_name, region, created_at, updated_at`,
          [input.subscriptionId, input.resourceGroup, input.vnetName, input.region],
        );

        const vnetId = vnetResult.rows[0].id;

        // Clear existing SKUs and add new ones
        await client.query(
          'DELETE FROM control_plane_gpu_vnet_skus WHERE vnet_id = $1',
          [vnetId],
        );

        const skus = input.gpuSkus || ['a100', 'h100'];
        for (const sku of skus) {
          await client.query(
            `INSERT INTO control_plane_gpu_vnet_skus (vnet_id, gpu_sku)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [vnetId, sku],
          );
        }

        await client.query('COMMIT');

        return this.recordToVnet(vnetResult.rows[0], skus);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      this.logger.error(
        `Failed to create/update GPU VNet: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get all VNets, optionally filtered by SKU
   */
  async listVnets(gpuSku?: GpuSkuId): Promise<GpuVnetRecord[]> {
    const pool = this.getPool();
    if (!pool) {
      return [];
    }

    try {
      let query = `
        SELECT DISTINCT
          v.id,
          v.subscription_id,
          v.resource_group,
          v.vnet_name,
          v.region,
          v.created_at,
          v.updated_at,
          COALESCE(array_agg(s.gpu_sku ORDER BY s.gpu_sku), '{}') as gpu_skus
        FROM control_plane_gpu_vnets v
        LEFT JOIN control_plane_gpu_vnet_skus s ON v.id = s.vnet_id
      `;

      let params: string[] = [];
      if (gpuSku) {
        query += ` WHERE s.gpu_sku = $1 OR s.gpu_sku IS NULL`;
        params = [gpuSku];
      }

      query += ` GROUP BY v.id, v.subscription_id, v.resource_group, v.vnet_name, v.region, v.created_at, v.updated_at
                 ORDER BY v.region, v.vnet_name`;

      const result = await pool.query(query, params);
      return result.rows.map(row => this.recordToVnet(row, row.gpu_skus || []));
    } catch (error) {
      this.logger.error(
        `Failed to list GPU VNets: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get a specific VNet by ID
   */
  async getVnetById(id: string): Promise<GpuVnetRecord | null> {
    const pool = this.getPool();
    if (!pool) {
      return null;
    }

    try {
      const result = await pool.query(
        `SELECT 
          v.id,
          v.subscription_id,
          v.resource_group,
          v.vnet_name,
          v.region,
          v.created_at,
          v.updated_at,
          COALESCE(array_agg(s.gpu_sku ORDER BY s.gpu_sku), '{}') as gpu_skus
         FROM control_plane_gpu_vnets v
         LEFT JOIN control_plane_gpu_vnet_skus s ON v.id = s.vnet_id
         WHERE v.id = $1
         GROUP BY v.id, v.subscription_id, v.resource_group, v.vnet_name, v.region, v.created_at, v.updated_at`,
        [id],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.recordToVnet(result.rows[0], result.rows[0].gpu_skus || []);
    } catch (error) {
      this.logger.error(
        `Failed to get GPU VNet: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Update GPU SKUs for a VNet
   */
  async updateVnetSkus(id: string, gpuSkus: GpuSkuId[]): Promise<GpuVnetRecord> {
    const pool = this.getPool();
    if (!pool) {
      throw new Error('Database pool is not available');
    }

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Verify VNet exists
        const vnetResult = await client.query(
          'SELECT * FROM control_plane_gpu_vnets WHERE id = $1',
          [id],
        );

        if (vnetResult.rows.length === 0) {
          throw new Error('VNet not found');
        }

        // Update SKUs
        await client.query('DELETE FROM control_plane_gpu_vnet_skus WHERE vnet_id = $1', [id]);

        for (const sku of gpuSkus) {
          await client.query(
            'INSERT INTO control_plane_gpu_vnet_skus (vnet_id, gpu_sku) VALUES ($1, $2)',
            [id, sku],
          );
        }

        await client.query('COMMIT');

        const updated = await this.getVnetById(id);
        if (!updated) {
          throw new Error('Failed to retrieve updated VNet');
        }

        return updated;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      this.logger.error(
        `Failed to update GPU VNet SKUs: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Delete a VNet
   */
  async deleteVnet(id: string): Promise<void> {
    const pool = this.getPool();
    if (!pool) {
      throw new Error('Database pool is not available');
    }

    try {
      await pool.query('DELETE FROM control_plane_gpu_vnets WHERE id = $1', [id]);
    } catch (error) {
      this.logger.error(
        `Failed to delete GPU VNet: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get available VNets for GPU creation (respecting SKU constraints)
   */
  async getVnetsForGpuCreation(gpuSku: GpuSkuId): Promise<GpuOnboardedVnet[]> {
    const pool = this.getPool();
    if (!pool) {
      return [];
    }

    try {
      const result = await pool.query(
        `SELECT subscription_id, resource_group, vnet_name, region
         FROM control_plane_gpu_vnets v
         WHERE EXISTS (
           SELECT 1 FROM control_plane_gpu_vnet_skus s
           WHERE s.vnet_id = v.id AND s.gpu_sku = $1
         )
         ORDER BY region, vnet_name`,
        [gpuSku],
      );

      return result.rows.map(row => ({
        subscriptionId: row.subscription_id,
        resourceGroup: row.resource_group,
        vnetName: row.vnet_name,
        region: row.region,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get VNets for GPU creation: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private validate(input: CreateGpuVnetInput): void {
    const errors: string[] = [];

    if (!input.subscriptionId?.trim()) errors.push('subscriptionId');
    if (!input.resourceGroup?.trim()) errors.push('resourceGroup');
    if (!input.vnetName?.trim()) errors.push('vnetName');
    if (!input.region?.trim()) errors.push('region');

    if (errors.length > 0) {
      throw new Error(`Missing required fields: ${errors.join(', ')}`);
    }
  }

  private recordToVnet(row: any, skus: string[]): GpuVnetRecord {
    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      resourceGroup: row.resource_group,
      vnetName: row.vnet_name,
      region: row.region,
      gpuSkus: skus && skus.length > 0 ? skus : ['a100', 'h100'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
