import {
  deriveAksNames,
  validateAksClusterRequest,
} from '@internal/plugin-platform-common';
import {
  createInitialAksWizardForm,
  toAksClusterRequest,
  type AksWizardForm,
} from './aksWizardRequest';

function filledForm(overrides: Partial<AksWizardForm> = {}): AksWizardForm {
  return {
    ...createInitialAksWizardForm(),
    customer: 'Contoso',
    businessUnit: 'Retail',
    owner: 'Owner@Example.com',
    costCentre: 'P64358',
    changeTicket: 'scp-1234',
    tenantId: 'contoso',
    addressSpace: '10.230.0.0/16',
    ...overrides,
  };
}

describe('toAksClusterRequest', () => {
  it('maps a filled default form onto a valid canonical request', () => {
    const request = toAksClusterRequest(filledForm());

    expect(validateAksClusterRequest(request)).toEqual({});
    expect(request.env).toBe('dev');
    expect(request.location).toBe('australiaeast');
    expect(request.tenancy).toBe('st');
    expect(request.kubernetesVersion).toBe('1.36.2');
    expect(request.owner).toBe('owner@example.com');
    expect(request.changeTicket).toBe('SCP-1234');
    expect(deriveAksNames(request).clusterName).toBe(
      'aks-scp-dev-ae-st-contoso',
    );
    expect(deriveAksNames(request).resourceGroupName).toBe(
      'rg-scp-dev-ae-st-contoso',
    );
  });

  it('writes a null user pool when the user pool is disabled', () => {
    const request = toAksClusterRequest(filledForm({ userPoolEnabled: false }));

    expect(request.userPool).toBeNull();
    expect(validateAksClusterRequest(request)).toEqual({});
  });

  it('takes the system pool from the small flavor preset', () => {
    const request = toAksClusterRequest(
      filledForm({ nodeSizeFlavor: 'small' }),
    );

    expect(request.systemPool).toEqual({
      vmSize: 'Standard_B2s',
      minCount: 1,
      maxCount: 2,
      priority: 'Regular',
    });
    expect(request.userPool).toEqual({
      vmSize: 'Standard_B2s',
      minCount: 0,
      maxCount: 2,
      priority: 'Regular',
    });
  });

  it('parses user pool counts and priority from the form', () => {
    const request = toAksClusterRequest(
      filledForm({
        nodeSizeFlavor: 'medium',
        userMinNodes: '3',
        userMaxNodes: '12',
        nodePriority: 'Spot',
      }),
    );

    expect(request.userPool).toEqual({
      vmSize: 'Standard_E16ds_v5',
      minCount: 3,
      maxCount: 12,
      priority: 'Spot',
    });
    expect(validateAksClusterRequest(request)).toEqual({});
    expect(
      validateAksClusterRequest(
        toAksClusterRequest(filledForm({ env: 'prd', nodePriority: 'Spot' })),
      ).userPool,
    ).toMatch(/Spot/);
  });

  it('attaches cluster administrators only when given', () => {
    expect(toAksClusterRequest(filledForm())).not.toHaveProperty(
      'clusterAdministrators',
    );
    expect(
      toAksClusterRequest(filledForm(), ['octocat']).clusterAdministrators,
    ).toEqual(['octocat']);
  });
});
