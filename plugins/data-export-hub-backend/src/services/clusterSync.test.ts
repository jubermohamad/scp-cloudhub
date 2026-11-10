import { ClusterSyncService } from './clusterSync';
import { ServiceUnavailableError } from '../errors';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as any;

describe('ClusterSyncService', () => {
  it('reports missing Platform Registry tables as unavailable', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            pr_clusters: 'pr_clusters',
            pr_platforms: null,
            pr_environments: 'pr_environments',
            pr_cloud_accounts: 'pr_cloud_accounts',
          },
        ],
      }),
      transaction: jest.fn(),
    } as any;

    await expect(new ClusterSyncService(db, logger).run('user:default/admin')).rejects.toThrow(
      new ServiceUnavailableError(
        'Platform Registry is unavailable: missing pr_platforms. Ensure both plugins use the same PostgreSQL database and restart CloudHub.',
      ),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not retire previously synced clusters when Platform Registry is empty', async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              pr_clusters: 'pr_clusters',
              pr_platforms: 'pr_platforms',
              pr_environments: 'pr_environments',
              pr_cloud_accounts: 'pr_cloud_accounts',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
      transaction: jest.fn(),
    } as any;

    const result = await new ClusterSyncService(db, logger).run('user:default/admin');

    expect(result).toMatchObject({
      created: 0,
      updated: 0,
      retired: 0,
      restored: 0,
      skipped: [
        {
          clusterName: '*',
          reason:
            'Platform Registry has no active clusters to sync; no changes were applied',
        },
      ],
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
