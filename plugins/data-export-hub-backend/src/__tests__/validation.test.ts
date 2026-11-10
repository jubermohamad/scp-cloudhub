import {
  destinationConfigProblems,
  resolveSchedule,
  validateAgentInput,
  validateClusterInput,
  validateDatasetInput,
  validateDatasetPatch,
  validateDestinationInput,
  validateExportInput,
  ValidationError,
} from '../validation';
import { canManageTenant, canViewTenant, isMemberOf, resolveRoles, visibleTenants } from '../access';
import { healthFromHeartbeat, healthSql } from '../health';
import { parseListQuery, ListSpec } from '../listQuery';
import { likePattern } from '../sql';
import { outputPrefixes, profileSlug } from '../services/agentGateway';
import { isAks, mapEnvironment, tenantSlug } from '../services/clusterSync';
import { nextRunAt } from '../services/exportService';
import { NETREVEAL_TEST_DATASETS } from './fixtures';

const DEST_ID = '6f1c2a3e-1b2c-4d5e-8f90-123456789abc';
const DATASET_ID = '7a2b3c4d-2b3c-4e5f-9012-23456789abcd';
const CLUSTER_ID = '8b3c4d5e-3c4d-4f60-a123-3456789abcde';
const FINGERPRINT = 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8';

const validExport = {
  name: 'Visa nightly cases',
  tenantId: 'visa',
  environment: 'PRODUCTION',
  clusterId: CLUSTER_ID,
  namespace: 'netreveal',
  schedule: 'DAILY',
  fileFormat: 'PARQUET',
  destinationId: DEST_ID,
  datasetIds: [DATASET_ID],
};

const sftp = {
  host: 'sftp.metrobank.example',
  username: 'netreveal',
  remotePath: '/outbound',
  secretRef: 'kv://kv-dxh-prod/sftp-metrobank-key',
  hostKeyFingerprint: FINGERPRINT,
};

function detailsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationError) return error.details;
    throw error;
  }
  return [];
}

describe('schedules', () => {
  it('expands presets and validates custom cron', () => {
    expect(resolveSchedule('HOURLY')).toEqual({ cronExpression: '0 * * * *' });
    expect(resolveSchedule('CUSTOM_CRON', '  */15   1-5 * * 1-5 ')).toEqual({ cronExpression: '*/15 1-5 * * 1-5' });
    expect(() => resolveSchedule('CUSTOM_CRON', '0 2 * *')).toThrow(ValidationError);
    expect(() => resolveSchedule('YEARLY')).toThrow(ValidationError);
  });

  it('computes the next run in UTC', () => {
    expect(nextRunAt('0 2 * * *', new Date('2026-10-20T03:00:00Z'))).toBe('2026-10-21T02:00:00.000Z');
    expect(nextRunAt('bad')).toBeNull();
  });
});

describe('export profiles', () => {
  it('defaults to FULL Parquet with Snappy and no watermark strategy', () => {
    expect(validateExportInput(validExport)).toMatchObject({
      exportMode: 'FULL',
      fileFormat: 'PARQUET',
      compression: 'SNAPPY',
      watermarkStrategy: null,
      retentionDays: null,
      cronExpression: '0 2 * * *',
    });
  });

  it('defaults CSV to gzip and rejects Snappy outside Parquet', () => {
    expect(validateExportInput({ ...validExport, fileFormat: 'CSV' }).compression).toBe('GZIP');
    expect(() => validateExportInput({ ...validExport, fileFormat: 'CSV', compression: 'SNAPPY' })).toThrow(
      /only available for PARQUET/,
    );
  });

  it('applies a watermark strategy only to incremental exports', () => {
    expect(validateExportInput({ ...validExport, exportMode: 'INCREMENTAL' }).watermarkStrategy).toBe('GREATER_THAN');
    expect(
      validateExportInput({ ...validExport, exportMode: 'INCREMENTAL', watermarkStrategy: 'GREATER_OR_EQUAL' })
        .watermarkStrategy,
    ).toBe('GREATER_OR_EQUAL');
    expect(validateExportInput({ ...validExport, watermarkStrategy: 'GREATER_OR_EQUAL' }).watermarkStrategy).toBeNull();
  });

  it('validates retention, mode and placement together', () => {
    const details = detailsOf(() =>
      validateExportInput({ ...validExport, retentionDays: 0, exportMode: 'DELTA', tenantId: 'Visa Inc', clusterId: 'x' }),
    );
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('retentionDays'),
        expect.stringContaining('exportMode'),
        expect.stringContaining('tenantId'),
        expect.stringContaining('clusterId'),
      ]),
    );
  });

  it('de-duplicates and caps datasets', () => {
    expect(validateExportInput({ ...validExport, datasetIds: [DATASET_ID, DATASET_ID] }).datasetIds).toEqual([DATASET_ID]);
    expect(() => validateExportInput({ ...validExport, datasetIds: Array(51).fill(DATASET_ID) })).toThrow(/at most 50/);
  });
});

describe('data catalog', () => {
  const dataset = { datasetId: 'NR_V_CASES', displayName: 'NetReveal Cases', category: 'CASES' };

  it('applies catalog defaults', () => {
    expect(validateDatasetInput(dataset)).toMatchObject({
      sourceProduct: 'NETREVEAL',
      classification: 'INTERNAL',
      containsPii: false,
      supportsIncremental: false,
      columnMetadata: [],
      dependsOn: [],
      enabled: true,
    });
  });

  it('validates business metadata', () => {
    const details = detailsOf(() =>
      validateDatasetInput({
        ...dataset,
        sourceProduct: 'ORACLE',
        classification: 'SECRET',
        supportEmail: 'not-an-email',
        estimatedDailyVolume: -1,
        sampleSchema: ['x'],
        dependsOn: ['NR_CUSTOMERS'],
      }),
    );
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('sourceProduct'),
        expect.stringContaining('classification'),
        expect.stringContaining('supportEmail'),
        expect.stringContaining('estimatedDailyVolume'),
        expect.stringContaining('sampleSchema'),
        expect.stringContaining('dependsOn'),
      ]),
    );
  });

  it('enforces cross-field rules', () => {
    expect(() => validateDatasetInput({ ...dataset, supportsIncremental: true })).toThrow(/watermarkColumn/);
    expect(() => validateDatasetInput({ ...dataset, containsPii: true, classification: 'PUBLIC' })).toThrow(/PII/);
  });

  it('accepts rich column metadata and a single SELECT or WITH template', () => {
    const columnMetadata = [{ name: 'CASE_ID', type: 'NUMBER', nullable: false, pii: false }];
    expect(validateDatasetInput({ ...dataset, columnMetadata }).columnMetadata).toEqual(columnMetadata);
    expect(validateDatasetInput({ ...dataset, sqlTemplate: 'WITH c AS (SELECT 1) SELECT * FROM c' }).sqlTemplate).toBeTruthy();
    expect(() => validateDatasetInput({ ...dataset, sqlTemplate: 'SELECT 1; DROP TABLE x' })).toThrow(/single SELECT/);
    expect(() => validateDatasetInput({ ...dataset, columnMetadata: [{ name: 'a b' }] })).toThrow(/columnMetadata\[0\]/);
  });

  it('forbids changing the catalog key in an update', () => {
    expect(() => validateDatasetPatch({ datasetId: 'NR_OTHER' })).toThrow(/cannot be changed/);
    expect(validateDatasetPatch({ retentionDays: 30, ownerTeam: 'AML Platform' })).toEqual({
      retentionDays: 30,
      ownerTeam: 'AML Platform',
    });
  });

  it('validates NetReveal test fixture identifiers', () => {
    for (const fixture of NETREVEAL_TEST_DATASETS) {
      expect(() => validateDatasetInput(fixture)).not.toThrow();
    }
  });
});

describe('destinations', () => {
  it('accepts a pinned SFTP destination that references Key Vault', () => {
    expect(destinationConfigProblems('SFTP', sftp)).toEqual([]);
  });

  it('requires host key pinning and a Key Vault reference for SFTP', () => {
    expect(destinationConfigProblems('SFTP', { ...sftp, hostKeyFingerprint: undefined })).toEqual([
      'configuration.hostKeyFingerprint is required for SFTP',
    ]);
    expect(destinationConfigProblems('SFTP', { ...sftp, hostKeyFingerprint: 'abc', secretRef: 'vault/key' })).toEqual([
      expect.stringContaining('secretRef'),
      expect.stringContaining('hostKeyFingerprint'),
    ]);
  });

  it('refuses inline credentials of any kind', () => {
    expect(destinationConfigProblems('ADLS_GEN2', { accountName: 'dxhprod', fileSystem: 'data-export-hub', sasKey: 'x' })).toEqual([
      expect.stringContaining('sasKey looks like a credential'),
    ]);
  });

  it('validates ADLS names and defaults the file system', () => {
    expect(destinationConfigProblems('ADLS_GEN2', { accountName: 'Bad_Name', fileSystem: 'Bad--fs' })).toHaveLength(2);
    expect(
      validateDestinationInput({ type: 'ADLS_GEN2', name: 'lake', configuration: { accountName: 'dxhprod', fileSystem: '' } }),
    ).toBeDefined();
  });

  it('only creates destinations that have a delivery provider', () => {
    expect(() =>
      validateDestinationInput({ type: 'AWS_S3', name: 's3', configuration: { bucket: 'b' } }),
    ).toThrow(/type must be one of ADLS_GEN2, SFTP/);
    expect(destinationConfigProblems('SNOWFLAKE_STAGE', {})).toEqual([expect.stringContaining('no delivery provider')]);
  });
});

describe('clusters and agents', () => {
  it('validates cluster registration', () => {
    expect(
      validateClusterInput({ clusterName: 'aks-visa-prod-01', environment: 'PRODUCTION', tenantId: 'visa' }),
    ).toMatchObject({ clusterName: 'aks-visa-prod-01', subscriptionId: null });
    expect(() => validateClusterInput({ clusterName: '-x', environment: 'PRODUCTION', tenantId: 'visa' })).toThrow(
      /clusterName/,
    );
  });

  it('identifies agents by the GUID of their workload identity', () => {
    expect(validateAgentInput({ identitySubject: 'AAAAAAAA-1111-4111-8111-111111111111' })).toEqual({
      identitySubject: 'aaaaaaaa-1111-4111-8111-111111111111',
    });
    expect(() => validateAgentInput({ identitySubject: 'my-agent' })).toThrow(/identitySubject/);
    expect(validateAgentInput({ agentName: 'renamed' }, true)).toEqual({ agentName: 'renamed' });
  });
});

describe('roles', () => {
  it('derives platform, tenant admin and tenant user roles', () => {
    const caller = resolveRoles('user:default/jane', [
      'group:default/CloudHub.DataExport.Tenant.visa.Admin',
      'group:default/cloudhub.dataexport.tenant.tabcorp.user',
    ]);
    expect(caller).toMatchObject({ isPlatformAdmin: false, tenantAdminOf: ['visa'], tenantMemberOf: ['tabcorp', 'visa'] });
    expect(canViewTenant(caller, 'tabcorp')).toBe(true);
    expect(canManageTenant(caller, 'tabcorp')).toBe(false);
    expect(visibleTenants(resolveRoles('ops', ['group:default/cloudhub.dataexport.admin']))).toBeNull();
    expect(
      resolveRoles('export-user', [
        'group:default/grp-cloudhub-data-export',
      ]).isPlatformAdmin,
    ).toBe(true);
    expect(
      resolveRoles('platform-owner', [
        'group:default/cloudhubplatformowners',
      ]).isPlatformAdmin,
    ).toBe(true);
    expect(isMemberOf(['CloudHub.DataExport.Admin'], ['cloudhub.dataexport.admin'])).toBe(true);
  });
});

describe('list queries', () => {
  const spec: ListSpec = {
    sortable: { name: 'x.name', createdAt: 'x.created_at' },
    defaultSort: { field: 'createdAt', order: 'desc' },
    filters: ['tenantId', 'clusterId', 'from'],
  };

  it('applies defaults and a stable tiebreaker', () => {
    expect(parseListQuery({}, spec, 'x.id')).toMatchObject({
      page: 0,
      pageSize: 25,
      offset: 0,
      orderBy: 'x.created_at DESC NULLS LAST, x.id DESC',
      filters: {},
    });
  });

  it('only sorts by whitelisted fields', () => {
    expect(() => parseListQuery({ sortBy: 'name; DROP TABLE x' }, spec)).toThrow(/sortBy must be one of/);
    expect(parseListQuery({ sortBy: 'name', page: '2', pageSize: '50' }, spec)).toMatchObject({
      offset: 100,
      orderBy: 'x.name ASC NULLS LAST, id ASC',
    });
  });

  it('validates filter values and ignores unknown filters', () => {
    expect(() => parseListQuery({ clusterId: 'abc' }, spec)).toThrow(/clusterId must be a UUID/);
    expect(() => parseListQuery({ from: 'yesterday' }, spec)).toThrow(/ISO date/);
    expect(() => parseListQuery({ pageSize: '500' }, spec)).toThrow(/pageSize/);
    expect(parseListQuery({ tenantId: 'visa', owner: 'x' }, spec).filters).toEqual({ tenantId: 'visa' });
  });

  it('escapes LIKE wildcards in search', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('health', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000);

  it('follows the heartbeat-age thresholds', () => {
    expect(healthFromHeartbeat(ago(1), 'ONLINE', now)).toBe('HEALTHY');
    expect(healthFromHeartbeat(ago(1), 'DEGRADED', now)).toBe('WARNING');
    expect(healthFromHeartbeat(ago(7), 'ONLINE', now)).toBe('WARNING');
    expect(healthFromHeartbeat(ago(12), 'ONLINE', now)).toBe('CRITICAL');
    expect(healthFromHeartbeat(ago(16), 'ONLINE', now)).toBe('OFFLINE');
    expect(healthFromHeartbeat(null, null, now)).toBe('OFFLINE');
    expect(healthFromHeartbeat(ago(1), 'OFFLINE', now)).toBe('OFFLINE');
  });

  it('expresses the same thresholds in SQL', () => {
    expect(healthSql('a.last_seen', 'a.status')).toContain("INTERVAL '15 minutes'");
  });
});

describe('agent output layout', () => {
  it('builds tenant-scoped, dated, per-job prefixes', () => {
    expect(
      outputPrefixes(
        'metrobank',
        'Daily Cases',
        '1234abcd-0000-4000-8000-000000000000',
        new Date('2026-03-07T02:00:00Z'),
        'job-1',
      ),
    ).toEqual({
      profilePrefix: 'tenant/metrobank/exports/daily-cases-1234abcd',
      outputPrefix: 'tenant/metrobank/exports/daily-cases-1234abcd/2026/03/07/job-1',
    });
    expect(
      outputPrefixes(
        'metrobank',
        'Workflow Actions, Notes & Audit Trail',
        '1234abcd-0000-4000-8000-000000000000',
        new Date('2026-03-07T02:00:00Z'),
        'job-1',
        'workflow-audit',
      ),
    ).toEqual({
      profilePrefix: 'exports/2026/03/07/workflow-audit',
      outputPrefix: 'exports/2026/03/07/workflow-audit',
    });
    expect(profileSlug('!!!', 'abcdef12-0000')).toBe('export-abcdef12');
  });
});

describe('cluster discovery mapping', () => {
  it('maps Platform Registry codes and environments', () => {
    expect(tenantSlug(' Metro Bank ')).toBe('metro-bank');
    expect(mapEnvironment('prod', 'prod')).toBe('PRODUCTION');
    expect(mapEnvironment('uat', 'non-prod')).toBe('STAGING');
    expect(mapEnvironment('qa', 'non-prod')).toBe('SIT');
    expect(mapEnvironment('dev', 'non-prod')).toBe('DEVELOPMENT');
    expect(mapEnvironment('perf', 'non-prod')).toBeNull();
    expect(mapEnvironment('blue', 'prod')).toBe('PRODUCTION');
  });

  it('only discovers AKS clusters', () => {
    expect(isAks({ clusterType: 'AKS', provider: 'AZURE' })).toBe(true);
    expect(isAks({ clusterType: 'EKS', provider: 'AWS' })).toBe(false);
  });
});
