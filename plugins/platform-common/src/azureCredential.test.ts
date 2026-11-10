const mockCredential = { getToken: jest.fn() };

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn().mockImplementation(() => mockCredential),
}));

import { ClientSecretCredential } from '@azure/identity';
import {
  CLOUDHUB_AZURE_CLIENT_ID,
  CLOUDHUB_AZURE_TENANT_ID,
  createCloudHubAzureCredential,
} from './azureCredential';

describe('createCloudHubAzureCredential', () => {
  const env = {
    AZURE_TENANT_ID: CLOUDHUB_AZURE_TENANT_ID,
    AZURE_CLIENT_ID: CLOUDHUB_AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: 'test-secret',
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates only the approved service principal and logs non-secret metadata', () => {
    const logger = jest.fn();

    expect(createCloudHubAzureCredential(logger, env)).toBe(mockCredential);
    expect(ClientSecretCredential).toHaveBeenCalledWith(
      CLOUDHUB_AZURE_TENANT_ID,
      CLOUDHUB_AZURE_CLIENT_ID,
      'test-secret',
      { disableInstanceDiscovery: true },
    );
    expect(logger).toHaveBeenCalledWith('Azure credential selected', {
      credentialType: 'ClientSecretCredential',
      clientId: CLOUDHUB_AZURE_CLIENT_ID,
      tenantId: CLOUDHUB_AZURE_TENANT_ID,
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('test-secret');
  });

  it('rejects the retired or any other client ID before constructing a credential', () => {
    expect(() =>
      createCloudHubAzureCredential(undefined, {
        ...env,
        AZURE_CLIENT_ID: 'not-the-platform-service-principal',
      }),
    ).toThrow(/require AZURE_CLIENT_ID/);
    expect(ClientSecretCredential).not.toHaveBeenCalled();
  });

  it('requires complete Azure credentials and does not fall back to ambient identity', () => {
    expect(() =>
      createCloudHubAzureCredential(undefined, {
        AZURE_TENANT_ID: CLOUDHUB_AZURE_TENANT_ID,
        AZURE_CLIENT_ID: CLOUDHUB_AZURE_CLIENT_ID,
      }),
    ).toThrow(/AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET/);
    expect(ClientSecretCredential).not.toHaveBeenCalled();
  });
});
