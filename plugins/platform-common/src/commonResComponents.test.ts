import {
  COMMON_RES_COMPONENTS,
  buildCommonResOverrides,
  buildDefaultCommonResSelection,
} from './commonResComponents';

describe('common-res component catalog', () => {
  it('gives every component a non-empty helm key', () => {
    COMMON_RES_COMPONENTS.forEach(component => {
      expect(component.helmKey.trim()).not.toBe('');
      expect(component.id.trim()).not.toBe('');
    });
  });

  it('builds a default selection from defaultEnabled flags', () => {
    const selection = buildDefaultCommonResSelection();
    COMMON_RES_COMPONENTS.forEach(component => {
      expect(selection[component.id]).toBe(component.defaultEnabled);
    });
  });

  it('emits an override for every distinct helm key', () => {
    const overrides = buildCommonResOverrides([]);
    const keys = overrides.split(';').map(pair => pair.split('=')[0]);
    const distinctKeys = new Set(
      COMMON_RES_COMPONENTS.map(component => component.helmKey),
    );
    expect(new Set(keys)).toEqual(distinctKeys);
  });

  it('sets selected components to true and the rest to false', () => {
    const overrides = buildCommonResOverrides(['cert-manager']);
    const parsed = Object.fromEntries(
      overrides.split(';').map(pair => pair.split('=')),
    );
    expect(parsed['cert-manager.enabled']).toBe('true');
    expect(parsed['ingress-nginx.enabled']).toBe('false');
  });

  it('OR-combines components that share a helm key', () => {
    // opentelemetry-operator and jaeger-operator both map to tags.traces.
    const withOtel = Object.fromEntries(
      buildCommonResOverrides(['opentelemetry-operator'])
        .split(';')
        .map(pair => pair.split('=')),
    );
    const withJaeger = Object.fromEntries(
      buildCommonResOverrides(['jaeger-operator'])
        .split(';')
        .map(pair => pair.split('=')),
    );
    const withNeither = Object.fromEntries(
      buildCommonResOverrides([])
        .split(';')
        .map(pair => pair.split('=')),
    );

    expect(withOtel['tags.traces']).toBe('true');
    expect(withJaeger['tags.traces']).toBe('true');
    expect(withNeither['tags.traces']).toBe('false');
  });

  it('does not emit duplicate keys for shared toggles', () => {
    const overrides = buildCommonResOverrides([
      'opentelemetry-operator',
      'jaeger-operator',
    ]);
    const keys = overrides.split(';').map(pair => pair.split('=')[0]);
    expect(keys.filter(key => key === 'tags.traces')).toHaveLength(1);
  });
});
