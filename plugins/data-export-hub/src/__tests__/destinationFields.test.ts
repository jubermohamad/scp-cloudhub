import {
  CREATABLE_DESTINATION_TYPES,
  DESTINATION_FIELDS,
  destinationConfigProblems,
  destinationsForTenant,
  destinationTypeLabel,
  initialDestinationConfig,
  normaliseDestinationConfig,
  usableDestinations,
} from '../destinationFields';
import type { Destination } from '../types';

describe('destination fields', () => {
  it('only creates ADLS Gen2 and SFTP destinations', () => {
    expect(CREATABLE_DESTINATION_TYPES).toEqual(['ADLS_GEN2', 'SFTP']);
    expect(DESTINATION_FIELDS.ADLS_GEN2.map(field => field.key)).toEqual([
      'accountName',
      'fileSystem',
      'path',
    ]);
    expect(DESTINATION_FIELDS.SFTP.map(field => field.key)).toEqual([
      'host',
      'port',
      'username',
      'remotePath',
      'secretRef',
      'hostKeyFingerprint',
    ]);
  });

  it('labels legacy types with their raw code', () => {
    expect(destinationTypeLabel('ADLS_GEN2')).toBe('ADLS Gen2');
    expect(destinationTypeLabel('AWS_S3')).toBe('AWS_S3');
    expect(destinationTypeLabel(null)).toBe('—');
  });

  it('pre-fills the ADLS file system', () => {
    expect(initialDestinationConfig('ADLS_GEN2')).toEqual({
      fileSystem: 'data-export-hub',
    });
    expect(initialDestinationConfig('SFTP')).toEqual({});
  });

  it('reports missing and malformed values', () => {
    expect(
      destinationConfigProblems(
        'ADLS_GEN2',
        initialDestinationConfig('ADLS_GEN2'),
      ),
    ).toEqual(['Storage account is required.']);
    expect(
      destinationConfigProblems('ADLS_GEN2', {
        accountName: 'Bad-Name',
        fileSystem: 'x',
      }),
    ).toEqual(['Storage account: 3–24 lower-case letters and digits.']);
    const sftp = {
      host: 'h',
      username: 'u',
      remotePath: '/r',
      secretRef: 'kv://vault/secret',
      hostKeyFingerprint: 'SHA256:AAAA',
    };
    expect(destinationConfigProblems('SFTP', sftp)).toEqual([]);
    expect(
      destinationConfigProblems('SFTP', { ...sftp, port: '70000' }),
    ).toHaveLength(1);
    expect(
      destinationConfigProblems('SFTP', { ...sftp, port: '2222' }),
    ).toEqual([]);
    expect(
      destinationConfigProblems('SFTP', {
        ...sftp,
        hostKeyFingerprint: 'MD5:aa',
      }),
    ).toEqual(['Host key fingerprint: Use the OpenSSH form SHA256:<base64>.']);
  });

  it('normalises values for the API', () => {
    expect(
      normaliseDestinationConfig('SFTP', {
        host: ' h ',
        port: '',
        username: 'u',
        stray: 'ignored',
      }),
    ).toEqual({ host: 'h', username: 'u' });
  });

  it('offers shared and tenant destinations that are enabled and deliverable', () => {
    const destinations = [
      { id: '1', tenantId: null, enabled: true, type: 'SFTP' },
      { id: '2', tenantId: 'visa', enabled: true, type: 'ADLS_GEN2' },
      { id: '3', tenantId: 'tabcorp', enabled: true, type: 'SFTP' },
      { id: '4', tenantId: 'visa', enabled: false, type: 'SFTP' },
      { id: '5', tenantId: 'visa', enabled: true, type: 'AWS_S3' },
    ] as Destination[];
    expect(destinationsForTenant(destinations, 'visa').map(d => d.id)).toEqual([
      '1',
      '2',
      '4',
      '5',
    ]);
    expect(usableDestinations(destinations, 'visa').map(d => d.id)).toEqual([
      '1',
      '2',
    ]);
  });
});
