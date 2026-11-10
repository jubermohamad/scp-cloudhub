import { AzureVmService } from '../azureVmService';

const listAll = jest.fn();
const list = jest.fn();
const instanceView = jest.fn();

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn(),
}));

jest.mock('@azure/arm-compute', () => ({
  ComputeManagementClient: jest.fn().mockImplementation(() => ({
    virtualMachines: { listAll, list, instanceView },
  })),
}));

const mockLogger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

function vm(name: string, tags: Record<string, string> | undefined) {
  return {
    name,
    id: `/subscriptions/s/resourceGroups/rg-${name}/providers/Microsoft.Compute/virtualMachines/${name}`,
    location: 'swedencentral',
    tags,
    hardwareProfile: { vmSize: 'Standard_B1s' },
    instanceView: { statuses: [{ code: 'PowerState/running' }] },
  };
}

function seed(vms: any[]) {
  const toIterator = async function* gen() {
    for (const v of vms) yield v;
  };
  listAll.mockImplementation(toIterator);
  list.mockImplementation(toIterator);
  instanceView.mockResolvedValue({
    statuses: [{ code: 'PowerState/running' }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.CLOUDHUB_VM_ALLOWED_ENV;
  process.env.AZURE_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
  process.env.AZURE_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
  process.env.AZURE_CLIENT_SECRET = 'test-secret';
  // Avoid live retail-price calls.
  global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
});

describe('AzureVmService environment filtering', () => {
  it('returns only VMs tagged env=dev', async () => {
    seed([
      vm('dev-01', { env: 'dev' }),
      vm('prod-01', { env: 'prd' }),
      vm('prod-02', { env: 'prod' }),
    ]);

    const result = await new AzureVmService(mockLogger).listVms('sub');

    expect(result.map(r => r.vmName)).toEqual(['dev-01']);
  });

  it('excludes untagged VMs and VMs with an empty env tag', async () => {
    seed([
      vm('no-tags', undefined),
      vm('empty-env', { env: '' }),
      vm('dev-01', { env: 'dev' }),
    ]);

    const result = await new AzureVmService(mockLogger).listVms('sub');

    expect(result.map(r => r.vmName)).toEqual(['dev-01']);
  });

  it('matches the env tag case-insensitively and accepts "environment"', async () => {
    seed([
      vm('upper', { ENV: 'DEV' }),
      vm('alt-key', { Environment: 'dev' }),
      vm('prod', { Environment: 'PRD' }),
    ]);

    const result = await new AzureVmService(mockLogger).listVms('sub');

    expect(result.map(r => r.vmName).sort()).toEqual(['alt-key', 'upper']);
  });

  it('honours CLOUDHUB_VM_ALLOWED_ENV', async () => {
    process.env.CLOUDHUB_VM_ALLOWED_ENV = 'qa';
    seed([vm('dev-01', { env: 'dev' }), vm('qa-01', { env: 'qa' })]);

    const result = await new AzureVmService(mockLogger).listVms('sub');

    expect(result.map(r => r.vmName)).toEqual(['qa-01']);
  });

  it('reports the resolved resource group and environment', async () => {
    seed([vm('dev-01', { env: 'dev' })]);

    const [record] = await new AzureVmService(mockLogger).listVms('sub');

    expect(record.resourceGroupName).toBe('rg-dev-01');
    expect(record.environment).toBe('dev');
    expect(record.currentState).toBe('Running');
  });

  it('lists all VMs in the selected resource group when scoped mode is enabled', async () => {
    seed([
      vm('dev-01', { env: 'dev' }),
      {
        ...vm('prod-01', { env: 'prod' }),
        id: '/subscriptions/s/resourceGroups/rg-dev-01/providers/Microsoft.Compute/virtualMachines/prod-01',
      },
      {
        ...vm('untagged-01', undefined),
        id: '/subscriptions/s/resourceGroups/rg-dev-01/providers/Microsoft.Compute/virtualMachines/untagged-01',
      },
      {
        ...vm('other-rg-01', { env: 'dev' }),
        id: '/subscriptions/s/resourceGroups/rg-other/providers/Microsoft.Compute/virtualMachines/other-rg-01',
      },
    ]);

    const result = await new AzureVmService(mockLogger).listVms('sub', {
      resourceGroupName: 'rg-dev-01',
      includeAllInResourceGroup: true,
    });

    expect(result.map(r => r.vmName).sort()).toEqual([
      'dev-01',
      'prod-01',
      'untagged-01',
    ]);
    expect(list).toHaveBeenCalledWith('rg-dev-01');
    expect(instanceView).toHaveBeenCalledTimes(3);
    expect(listAll).not.toHaveBeenCalled();
  });
});
