import type { LoggerService } from '@backstage/backend-plugin-api';

const mockResources = jest.fn();
const mockGraphClient = jest.fn();

jest.mock('@azure/arm-resourcegraph', () => ({
  ResourceGraphClient: jest.fn().mockImplementation(() => {
    mockGraphClient();
    return { resources: mockResources };
  }),
}));

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn().mockImplementation(() => ({})),
}));

import { AzureProvider } from '../providers/azureProvider';

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis() as any,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AZURE_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
  process.env.AZURE_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
  process.env.AZURE_CLIENT_SECRET = 'secret-123';
});

afterEach(() => {
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_CLIENT_SECRET;
});

describe('AzureProvider.discoverResourceGroups', () => {
  it('returns resource groups filtered by search term', async () => {
    mockResources.mockResolvedValueOnce({
      data: [
        { resourceGroup: 'rg-sri-dev' },
        { resourceGroup: 'rg-sri-prod' },
        { resourceGroup: 'rg-shared' },
      ],
    });

    const provider = new AzureProvider(mockLogger);
    const result = await provider.discoverResourceGroups({
      subscriptionId: 'sub-123',
      search: 'prod',
    });

    expect(result).toEqual(['rg-sri-dev', 'rg-sri-prod', 'rg-shared']);
    expect(mockGraphClient).toHaveBeenCalledTimes(1);
    expect(mockResources).toHaveBeenCalledTimes(1);

    const request = mockResources.mock.calls[0][0];
    expect(request.subscriptions).toEqual(['sub-123']);
    expect(request.query).toContain('ResourceContainers');
    expect(request.query).toContain(
      "type =~ 'microsoft.resources/subscriptions/resourcegroups'",
    );
    expect(request.query).toContain("tolower(name) contains tolower('prod')");
  });
});

describe('AzureProvider.discoverGpuSubnets', () => {
  // Mirrors a real Azure Resource Graph response for fr-napoleon-vnet.
  // The important detail: a NON-delegated subnet reports delegationCount 0,
  // and `used` comes back null when the subnet has no ipConfigurations.
  const graphRows = [
    {
      id: '/subscriptions/sub-123/…/subnets/fr-napoleon-subnet',
      name: 'fr-napoleon-subnet',
      addressRange: '10.82.0.0/18',
      used: 380,
      delegationCount: 0,
      platformReserved: '',
    },
    {
      id: '/subscriptions/sub-123/…/subnets/internal-lb',
      name: 'internal-lb',
      addressRange: '10.82.64.0/28',
      used: 2,
      delegationCount: 0,
      platformReserved: '',
    },
    {
      id: '/subscriptions/sub-123/…/subnets/GatewaySubnet',
      name: 'GatewaySubnet',
      addressRange: '10.82.65.0/27',
      used: 3,
      delegationCount: 0,
      platformReserved: '',
    },
    {
      id: '/subscriptions/sub-123/…/subnets/snet-db-fr-napoleon',
      name: 'snet-db-fr-napoleon',
      addressRange: '10.82.66.0/24',
      used: null,
      delegationCount: 1,
      platformReserved: '',
    },
    {
      id: '/subscriptions/sub-123/…/subnets/snet-reserved',
      name: 'snet-reserved',
      addressRange: '10.82.67.0/24',
      used: 0,
      delegationCount: 0,
      platformReserved: 'true',
    },
  ];

  const discover = () =>
    new AzureProvider(mockLogger).discoverGpuSubnets({
      subscriptionId: 'sub-123',
      resourceGroup: 'fr-napoleon-rg',
      vnetName: 'fr-napoleon-vnet',
      region: 'francecentral',
    });

  it('keeps non-delegated subnets and drops delegated/reserved ones', async () => {
    mockResources.mockResolvedValueOnce({ data: graphRows });

    const result = await discover();

    // The regression this guards: Azure returns `delegations: []` for a
    // non-delegated subnet. The old query stringified it, and tostring([])
    // is the truthy "[]", so every subnet was filtered out and the picker
    // was always empty.
    expect(result.map(subnet => subnet.name)).toEqual([
      'fr-napoleon-subnet',
      'internal-lb',
    ]);
  });

  it('projects delegations as a count, never as a string', async () => {
    mockResources.mockResolvedValueOnce({ data: graphRows });
    await discover();

    const { query } = mockResources.mock.calls[0][0];
    expect(query).toContain(
      'delegationCount=coalesce(array_length(subnet.properties.delegations), 0)',
    );
    expect(query).toContain(
      'used=coalesce(array_length(subnet.properties.ipConfigurations), 0)',
    );
    expect(query).not.toContain('tostring(subnet.properties.delegations)');
  });

  it('computes usable capacity from the CIDR minus Azure reserved addresses', async () => {
    mockResources.mockResolvedValueOnce({ data: graphRows });

    const [primary] = await discover();

    // /18 => 16384 addresses, minus 5 Azure-reserved, minus 380 in use.
    expect(primary.totalAddresses).toBe(16384);
    expect(primary.usedAddresses).toBe(380);
    expect(primary.availableIpAddresses).toBe(16384 - 5 - 380);
  });

  it('returns an empty list when the VNet has no eligible subnets', async () => {
    mockResources.mockResolvedValueOnce({
      data: graphRows.filter(row => row.delegationCount > 0),
    });

    await expect(discover()).resolves.toEqual([]);
  });
});
