import {
  listCatalogVersions,
  resolveReleasePointers,
} from '../services/releaseCatalogService';

describe('releaseCatalogService', () => {
  it('resolves scripts app ids to their catalog entry', () => {
    expect(resolveReleasePointers('invhub', '1.411.0').valuesFileCommitSha).toBe(
      'e441c092bb83011a09dc281903498acbd12048aa',
    );
  });

  it('falls back to the newest catalogued release for unknown versions', () => {
    expect(resolveReleasePointers('invhub', 'latest').helmChartVersion).toBe('1.415.0');
    expect(listCatalogVersions('invhub')).toEqual(['1.415.0', '1.411.0', '1.408.0']);
  });

  it('catalogues DetectionHub versions and falls back to the newest release for unknown versions', () => {
    const pointers = resolveReleasePointers('detectionhub', '2.0.14');
    expect(pointers.helmChartVersion).toBe('1.4.0');
    expect(pointers.valuesFileCommitSha).toBe('main');
    expect(listCatalogVersions('detectionhub')).toEqual(['1.4.0', '1.3.2', '1.2.0']);
  });

  it('catalogues common-res versions with latest 2.1.3 first', () => {
    const versions = listCatalogVersions('common-res');
    expect(versions).toContain('2.1.3');
    expect(versions[0]).toBe('2.1.3');
    expect(resolveReleasePointers('common-res', '2.1.3').helmChartVersion).toBe('2.1.3');
    expect(resolveReleasePointers('common-res', 'latest').helmChartVersion).toBe('2.1.3');
  });

  it('aliases edb-common-res to common-res', () => {
    const versions = listCatalogVersions('edb-common-res');
    expect(versions).toContain('2.1.3');
    expect(versions[0]).toBe('2.1.3');
  });
});
