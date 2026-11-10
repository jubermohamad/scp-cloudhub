import {
  buildExportInput,
  defaultCompression,
  firstInvalidStep,
  initialWizardForm,
  retentionChoiceFor,
  stepProblem,
  WizardForm,
  withFormat,
} from '../exportWizardModel';
import type { ExportProfile } from '../types';

const valid: WizardForm = {
  ...initialWizardForm(undefined, ['metrobank']),
  name: 'Metro Bank - Alerting & Detection',
  customerName: 'Metro Bank',
  tenantId: 'metrobank',
  clusterId: 'c1',
  clusterLabel: 'aks-metro-prd-weu',
  packageCode: 'alerting-detection',
  packageCodes: ['alerting-detection'],
  packageName: 'Alerting & Detection',
  destinationId: 'dest1',
};

describe('initial wizard form', () => {
  it('defaults to no preselected export package', () => {
    const form = initialWizardForm(undefined, ['metrobank']);
    expect(form).toMatchObject({
      tenantId: 'metrobank',
      fileFormat: 'TSV',
      compression: 'NONE',
      schedule: 'DAILY',
      exportMode: 'FULL',
      retention: '30',
      packageCode: '',
      packageCodes: [],
    });
    expect(initialWizardForm(undefined, ['a', 'b']).tenantId).toBe('');
  });

  it('loads an existing profile', () => {
    const profile = {
      name: 'P',
      tenantId: 'metrobank',
      customerName: 'Metro Bank',
      environment: 'PRODUCTION',
      clusterId: 'c1',
      clusterName: 'aks-metro-prd-weu',
      packageCode: 'workflow-audit',
      packageName: 'Workflow Actions, Notes & Audit Trail',
      namespace: 'nrod',
      schedule: 'CUSTOM_CRON',
      cronExpression: '0 3 * * 1',
      exportMode: 'FULL',
      fileFormat: 'TSV',
      compression: 'NONE',
      retentionDays: 14,
      destinationId: 'dest1',
      destinationName: 'Azure Blob Storage',
      datasets: [],
    } as unknown as ExportProfile;
    expect(initialWizardForm(profile, [])).toMatchObject({
      environment: 'PRODUCTION',
      cronExpression: '0 3 * * 1',
      packageCode: 'workflow-audit',
      packageCodes: ['workflow-audit'],
      retention: 'CUSTOM',
      customRetentionDays: '14',
      clusterLabel: 'aks-metro-prd-weu',
    });
  });
});

describe('wizard step gating', () => {
  it('accepts a complete form', () => {
    expect(firstInvalidStep(valid)).toBeNull();
  });

  it('requires a customer, production cluster, and at least one package', () => {
    expect(stepProblem(0, { ...valid, tenantId: '' })).toMatch(/customer/);
    expect(stepProblem(1, { ...valid, clusterId: '' })).toMatch(/production AKS cluster/);
    expect(stepProblem(2, { ...valid, packageCodes: [] })).toMatch(/export package/);
  });

  it('validates custom cron expressions', () => {
    expect(
      stepProblem(3, {
        ...valid,
        schedule: 'CUSTOM_CRON',
        cronExpression: '0 2 *',
      }),
    ).toMatch(/5-field/);
    expect(
      stepProblem(3, {
        ...valid,
        schedule: 'CUSTOM_CRON',
        cronExpression: '0 2 * * *',
      }),
    ).toBeNull();
  });
});

describe('format and compression', () => {
  it('defaults compression by format', () => {
    expect(defaultCompression('PARQUET')).toBe('SNAPPY');
    expect(defaultCompression('TSV')).toBe('NONE');
  });

  it('resets compression only when the new format cannot use it', () => {
    expect(
      withFormat({ ...valid, compression: 'SNAPPY' }, 'TSV').compression,
    ).toBe('NONE');
  });

  it('maps retention days to choices', () => {
    expect(retentionChoiceFor(null)).toBe('NONE');
    expect(retentionChoiceFor(90)).toBe('90');
    expect(retentionChoiceFor(45)).toBe('CUSTOM');
  });
});

describe('building the request', () => {
  it('builds ExportInput with TSV format and customer-centric metadata', () => {
    expect(buildExportInput(valid, 'dest1', true)).toEqual({
      name: 'Metro Bank - Alerting & Detection',
      tenantId: 'metrobank',
      customerName: 'Metro Bank',
      packageCode: 'alerting-detection',
      packageCodes: ['alerting-detection'],
      packageName: 'Alerting & Detection',
      environment: 'PRODUCTION',
      clusterId: 'c1',
      namespace: 'nrod',
      schedule: 'DAILY',
      cronExpression: undefined,
      exportMode: 'FULL',
      fileFormat: 'TSV',
      compression: 'NONE',
      watermarkStrategy: null,
      retentionDays: 30,
      destinationId: 'dest1',
      datasetIds: [],
      enabled: true,
    });
  });
});
