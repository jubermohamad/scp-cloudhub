import { createPlatformRegistryApi } from './api';

describe('Platform Registry API', () => {
  it('bypasses browser caching for live Registry requests', async () => {
    const backendFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0 }),
    });
    const api = createPlatformRegistryApi(backendFetch);

    await api.listOnboardedClusters();

    expect(backendFetch).toHaveBeenCalledWith(
      'platform-registry',
      '/clusters/onboarded',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ 'Cache-Control': 'no-cache' }),
      }),
    );
  });
});
