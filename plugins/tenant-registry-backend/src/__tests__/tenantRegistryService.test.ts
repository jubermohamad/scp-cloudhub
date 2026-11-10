import { TenantRegistryService } from '../services/tenantRegistryService';

describe('TenantRegistryService list queries', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as any;

  it('applies pagination, search and sorting for tenants', async () => {
    const query = jest.fn(async (...args: any[]) => {
      const sql = String(args[0] ?? '');
      if (sql.includes('COUNT(*)::text AS count FROM tenants')) {
        return [{ count: '2' }];
      }
      return [
        {
          id: 't1',
          tenantName: 'Visa',
          businessUnit: 'BU',
          cloudProvider: 'Azure',
          subscriptionId: 'sub1',
          regions: ['eastus'],
          environments: ['dev'],
          clusterCount: 3,
          createdAt: new Date().toISOString(),
        },
      ];
    });

    const db = { query } as any;
    const service = new TenantRegistryService(db, logger);

    const result = await service.listTenants({
      page: 1,
      pageSize: 10,
      search: 'visa',
      sortBy: 'tenantName',
      sortOrder: 'asc',
    });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);

    const listSql = query.mock.calls[1][0] as string;
    const listParams = query.mock.calls[1][1] as unknown[];
    expect(listSql).toContain('ORDER BY tenant_name ASC');
    expect(listSql).toContain('LIMIT $2');
    expect(listSql).toContain('OFFSET $3');
    expect(listParams).toEqual(['%visa%', 10, 10]);
  });

  it('falls back to safe defaults for invalid cluster sort input', async () => {
    const query = jest.fn(async (...args: any[]) => {
      const sql = String(args[0] ?? '');
      if (sql.includes('COUNT(*)::text AS count FROM clusters')) {
        return [{ count: '0' }];
      }
      return [];
    });

    const db = { query } as any;
    const service = new TenantRegistryService(db, logger);

    const result = await service.listClusters({
      page: 0,
      pageSize: 25,
      sortBy: 'DROP TABLE clusters',
      sortOrder: 'desc',
    });

    expect(result.total).toBe(0);
    const listSql = query.mock.calls[1][0] as string;
    expect(listSql).toContain('ORDER BY created_at DESC');
  });
});
