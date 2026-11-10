import { getHelmfileConsoleContent, mergeDeploymentEvents } from './deploymentEventUtils';

describe('mergeDeploymentEvents', () => {
  it('deduplicates and sorts new events by timestamp', () => {
    const existing = [
      { id: 'b', createdAt: '2024-01-01T00:02:00.000Z' },
      { id: 'a', createdAt: '2024-01-01T00:01:00.000Z' },
    ];

    const merged = mergeDeploymentEvents(existing, [
      { id: 'c', createdAt: '2024-01-01T00:03:00.000Z' },
      { id: 'a', createdAt: '2024-01-01T00:01:00.000Z' },
      { id: 'd', createdAt: '2024-01-01T00:00:50.000Z' },
    ]);

    expect(merged.map(item => item.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('prefers the preview Helmfile content when it is available for the console', () => {
    expect(
      getHelmfileConsoleContent(
        'releases:\n  - name: demo',
        'fallback content',
      ),
    ).toBe('releases:\n  - name: demo');
  });

  it('falls back to the persisted deployment content when preview content is missing', () => {
    expect(getHelmfileConsoleContent('', 'persisted helmfile')).toBe(
      'persisted helmfile',
    );
  });
});
