import { TestVmService, TestVmError } from '../services/testVmService';

const dispatch = jest.fn();
const audit = jest.fn().mockResolvedValue(undefined);

const mockLogger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

const terraform: any = {
  dispatch,
  runStatus: jest.fn(),
  repository: () => 'SymphonySensa/scp-azure-terraform-modules',
  branch: () => 'feature/juber-ai-vm',
  configured: () => true,
};

const azure: any = {
  discoverGpuSubnets: jest.fn(),
};

const networks: any = {
  hasProfile: jest.fn(),
  getNetworkProfile: jest.fn(),
  subnetIdFor: jest.fn(),
};

const SUBNET = '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/v/subnets/snet';

function build() {
  return new TestVmService({
    logger: mockLogger,
    getPool: () => null,
    terraform,
    azure,
    networks,
    audit,
  });
}

const actor = { actorRef: 'user:default/jane', role: 'platform-admin' as any };

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  networks.hasProfile.mockReturnValue(true);
  networks.getNetworkProfile.mockReturnValue({
    subscriptionId: 'sub-test',
    resourceGroup: 'rg-network',
    vnetName: 'vnet-shared',
    subnetName: 'snet-testvm',
    region: 'swedencentral',
  });
  networks.subnetIdFor.mockReturnValue(SUBNET);
  azure.discoverGpuSubnets.mockResolvedValue([
    {
      id: SUBNET,
      name: 'snet-testvm',
      addressRange: '10.0.1.0/24',
      totalAddresses: 256,
      usedAddresses: 20,
      availableIpAddresses: 231,
      location: 'swedencentral',
    },
  ]);
  dispatch.mockResolvedValue({
    mode: 'terraform-cloud',
    repository: 'SymphonySensa/scp-azure-terraform-modules',
    branch: 'feature/juber-ai-vm',
    workflowId: 'vm-x',
    runId: 'run-1',
    status: 'queued',
    conclusion: null,
    htmlUrl: 'https://app.terraform.io/run-1',
  });
});

describe('TestVmService', () => {
  it('rejects names that break the Azure naming rule', async () => {
    await expect(
      build().create({ name: 'Bad_Name', ...actor }),
    ).rejects.toBeInstanceOf(TestVmError);
  });

  it('rejects a vmSize outside the low-cost allow-list', async () => {
    await expect(
      build().create({ name: 'vm-test-01', vmSize: 'Standard_D64s_v5', ...actor }),
    ).rejects.toThrow(/vmSize must be one of/);
  });

  it('defaults to Standard_B1s and dispatches an apply', async () => {
    const record = await build().create({ name: 'vm-test-01', ...actor });

    expect(record.vmSize).toBe('Standard_B1s');
    expect(record.status).toBe('PROVISIONING');
    expect(record.workflowRunId).toBe('run-1');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apply', vmName: 'vm-test-01' }),
    );
  });

  it('tags the VM env=dev so it is eligible for start/stop', async () => {
    await build().create({ name: 'vm-test-01', ...actor });

    const tfvars = JSON.parse(dispatch.mock.calls[0][0].tfvarsJson);
    expect(tfvars.tags.env).toBe('dev');
    expect(tfvars.env).toBe('dev');
    expect(tfvars.vm_size).toBe('Standard_B1s');
    expect(tfvars.subnet_id).toBe(SUBNET);
  });

  it('resolves the dedicated subnet from the testvm network profile', async () => {
    const record = await build().create({ name: 'vm-test-11', ...actor });

    expect(record.subnetId).toBe(SUBNET);
    expect(azure.discoverGpuSubnets).toHaveBeenCalledWith({
      subscriptionId: 'sub-test',
      resourceGroup: 'rg-network',
      vnetName: 'vnet-shared',
      region: 'swedencentral',
    });

    const tfvars = JSON.parse(dispatch.mock.calls[0][0].tfvarsJson);
    expect(tfvars.subnet_id).toBe(SUBNET);
  });

  it('falls back to the configured testvm subnet when Azure discovery returns none', async () => {
    azure.discoverGpuSubnets.mockResolvedValue([]);
    const record = await build().create({ name: 'vm-test-13', ...actor });
    expect(record.subnetId).toBe(
      '/subscriptions/sub-test/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-shared/subnets/snet-testvm',
    );
  });

  it('fails when testvm network profile is missing', async () => {
    networks.getNetworkProfile.mockImplementation(() => {
      throw new Error(
        "Network profile 'testvm' is not configured under cloudhub.networks or CLOUDHUB_NETWORKS_JSON",
      );
    });
    await expect(build().create({ name: 'vm-test-12', ...actor })).rejects.toThrow(
      /Network profile 'testvm'/,
    );
  });

  it('rejects a duplicate name', async () => {
    const service = build();
    await service.create({ name: 'vm-test-01', ...actor });

    await expect(
      service.create({ name: 'vm-test-01', ...actor }),
    ).rejects.toThrow(/already exists/);
  });

  it('fails create when dispatch throws', async () => {
    dispatch.mockRejectedValue(new Error('tfc exploded'));

    await expect(
      build().create({ name: 'vm-test-02', ...actor }),
    ).rejects.toThrow(/tfc exploded/);
  });

  it('dispatches a destroy on delete', async () => {
    const service = build();
    const created = await service.create({ name: 'vm-test-03', ...actor });

    const removed = await service.remove({ id: created.id, ...actor });

    expect(removed.status).toBe('DELETING');
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'destroy', vmName: 'vm-test-03' }),
    );
  });

  it('audits create and delete', async () => {
    const service = build();
    const created = await service.create({ name: 'vm-test-04', ...actor });
    await service.remove({ id: created.id, ...actor });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'test-vm.create' }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'test-vm.delete' }),
    );
  });
});
