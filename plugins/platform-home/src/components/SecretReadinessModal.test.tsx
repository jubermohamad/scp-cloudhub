import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';
import { SecretReadinessModal } from './SecretReadinessModal';
import { ProvisioningFeedbackModal } from './ProvisioningFeedbackModal';
import { isEffectivelyReady } from './DeploymentWizard';
import type { PortalSecretFieldInfo, PortalSecretProvisionStatusView } from './deploymentPortalTypes';

const muiTheme = (lightTheme as any).getTheme ? (lightTheme as any).getTheme('v5') : lightTheme;

const renderWithTheme = (ui: React.ReactElement) => render(<ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>);

const field: PortalSecretFieldInfo = {
  reference: 'op://Customers/sri/pipeline_refs/invhub-dt-poc__helm_chart_version',
  normalizedReference: 'op://Customers/sri/pipeline_refs/invhub-dt-poc__helm_chart_version',
  vault: 'Customers',
  item: 'sri',
  section: 'pipeline_refs',
  field: 'invhub-dt-poc__helm_chart_version',
  status: 'MISSING',
  message: '',
  sources: [],
  type: 'pipeline_ref',
};

function renderModal(
  fieldValues: Record<string, string>,
  onSaveField = jest.fn(),
  onRevalidate = jest.fn(),
) {
  render(
    <SecretReadinessModal
      open
      customer="sri"
      loading={false}
      report={null}
      error={null}
      fields={[field]}
      fieldValues={fieldValues}
      updatingFieldReference={null}
      onFieldValueChange={jest.fn()}
      onSaveField={onSaveField}
      onRevalidate={onRevalidate}
      onProvision={jest.fn()}
      onOpenChange={jest.fn()}
      suggestedValueFor={() => '1.411.0'}
    />,
  );
  return { onSaveField, onRevalidate };
}

describe('SecretReadinessModal', () => {
  it('treats pipeline-control refs as effectively ready when they are the only remaining blockers', () => {
    const report = {
      ready: false,
      checkedAt: '2026-10-27T00:00:00.000Z',
      cached: false,
      cacheExpiresAt: '2026-10-27T00:05:00.000Z',
      application: 'invhub',
      instanceName: 'dt-test',
      includePipelineRefs: true,
      filesScanned: ['apps/invhub/dt-test/overrides.yaml'],
      referencesDiscovered: 1,
      findings: [
        {
          reference: 'op://Customers/sri/invhub-dt-test/pipeline_refs/invhub-dt-test__helm_chart_version',
          normalizedReference: 'op://Customers/sri/invhub-dt-test/pipeline_refs/invhub-dt-test__helm_chart_version',
          vault: 'Customers',
          item: 'sri',
          section: 'pipeline_refs',
          field: 'invhub-dt-test__helm_chart_version',
          status: 'MISSING' as const,
          message: 'Field is missing.',
          sources: [],
        },
      ],
      missing: [
        {
          reference: 'op://Customers/sri/invhub-dt-test/pipeline_refs/invhub-dt-test__helm_chart_version',
          normalizedReference: 'op://Customers/sri/invhub-dt-test/pipeline_refs/invhub-dt-test__helm_chart_version',
          vault: 'Customers',
          item: 'sri',
          section: 'pipeline_refs',
          field: 'invhub-dt-test__helm_chart_version',
          status: 'MISSING' as const,
          message: 'Field is missing.',
          sources: [],
        },
      ],
      placeholders: [],
      filePlaceholders: [],
      summary: '1 pipeline-controlled field is still missing.',
    };

    expect(isEffectivelyReady(report)).toBe(true);
  });

  it('prefills an untouched field with the suggested value and saves it', () => {
    const { onSaveField } = renderModal({});
    expect(screen.getByDisplayValue('1.411.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaveField).toHaveBeenCalledWith(field, '1.411.0');
  });

  it('saves pending field edits before revalidating', async () => {
    const onSaveField = jest.fn().mockResolvedValue(undefined);
    const onRevalidate = jest.fn();
    renderModal({ [field.reference]: '2.0.14' }, onSaveField, onRevalidate);

    fireEvent.click(screen.getByRole('button', { name: 'Save & Validate' }));

    await waitFor(() => {
      expect(onSaveField).toHaveBeenCalledWith(field, '2.0.14');
      expect(onRevalidate).toHaveBeenCalledTimes(1);
    });
  });

  it('labels auto-provisioning as generate, save, and validate', () => {
    const onProvision = jest.fn();
    render(
      <SecretReadinessModal
        open
        customer="sri"
        loading={false}
        report={null}
        error={null}
        fields={[field]}
        fieldValues={{}}
        updatingFieldReference={null}
        onFieldValueChange={jest.fn()}
        onSaveField={jest.fn()}
        onRevalidate={jest.fn()}
        onProvision={onProvision}
        onOpenChange={jest.fn()}
        suggestedValueFor={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Generate, Save & Validate' }),
    );
    expect(onProvision).toHaveBeenCalledTimes(1);
  });

  it('lets the user clear the suggestion instead of refilling it', () => {
    renderModal({ [field.reference]: '' });
    expect(screen.queryByDisplayValue('1.411.0')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ProvisioningFeedbackModal', () => {
  it('counts missing secret fields as action required after a failed generation', () => {
    const report: PortalSecretProvisionStatusView = {
      operationId: 'op-1',
      application: 'invhub',
      instanceName: 'dt-juber-poc03',
      customer: 'sri',
      workflowRepository: 'repo',
      workflowId: 'workflow',
      workflowRef: 'service-account',
      workflowRunId: null,
      workflowRunUrl: null,
      status: 'completed',
      conclusion: 'success',
      message: 'Direct 1Password updates completed, but readiness still has blocked entries.',
      sections: ['invhub-dt-juber-poc03'],
      fieldsGenerated: ['dockerconfigjson', 'regcred_acr__dockerconfigjson'],
      requestedAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
      completedAt: '2026-09-28T10:00:00.000Z',
      readiness: {
        ready: false,
        checkedAt: '2026-09-28T10:00:00.000Z',
        cached: false,
        cacheExpiresAt: '2026-09-28T10:05:00.000Z',
        application: 'invhub',
        instanceName: 'dt-juber-poc03',
        includePipelineRefs: true,
        filesScanned: ['apps/invhub/dt-juber-poc03/overrides.gotmpl'],
        referencesDiscovered: 2,
        findings: [
          {
            reference: 'op://Customers/sri/invhub-dt-juber-poc03/dockerconfigjson',
            normalizedReference: 'op://Customers/sri/invhub-dt-juber-poc03/dockerconfigjson',
            vault: 'Customers',
            item: 'sri',
            section: 'invhub-dt-juber-poc03',
            field: 'dockerconfigjson',
            status: 'MISSING',
            message: 'Field is missing.',
            sources: [],
          },
          {
            reference: 'op://Customers/sri/invhub-dt-juber-poc03/regcred_acr__dockerconfigjson',
            normalizedReference: 'op://Customers/sri/invhub-dt-juber-poc03/regcred_acr__dockerconfigjson',
            vault: 'Customers',
            item: 'sri',
            section: 'invhub-dt-juber-poc03',
            field: 'regcred_acr__dockerconfigjson',
            status: 'MISSING',
            message: 'Field is missing.',
            sources: [],
          },
        ],
        missing: [
          {
            reference: 'op://Customers/sri/invhub-dt-juber-poc03/dockerconfigjson',
            normalizedReference: 'op://Customers/sri/invhub-dt-juber-poc03/dockerconfigjson',
            vault: 'Customers',
            item: 'sri',
            section: 'invhub-dt-juber-poc03',
            field: 'dockerconfigjson',
            status: 'MISSING',
            message: 'Field is missing.',
            sources: [],
          },
          {
            reference: 'op://Customers/sri/invhub-dt-juber-poc03/regcred_acr__dockerconfigjson',
            normalizedReference: 'op://Customers/sri/invhub-dt-juber-poc03/regcred_acr__dockerconfigjson',
            vault: 'Customers',
            item: 'sri',
            section: 'invhub-dt-juber-poc03',
            field: 'regcred_acr__dockerconfigjson',
            status: 'MISSING',
            message: 'Field is missing.',
            sources: [],
          },
        ],
        placeholders: [],
        filePlaceholders: [],
        summary: '2 secret reference(s) are missing from 1Password.',
      },
      verifiedFields: [],
    };

    renderWithTheme(
      <ProvisioningFeedbackModal
        open
        isLoading={false}
        logs={[]}
        report={report}
        error={null}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Action Required')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });
});
