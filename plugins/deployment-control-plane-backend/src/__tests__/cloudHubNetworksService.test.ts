import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  CloudHubNetworksService,
  buildSubnetId,
} from '../services/cloudHubNetworksService';

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis() as any,
};

// The exact shape documented in .env.example and
// docs/gpu-compute-network-onboarding.md, and set as the production
// CLOUDHUB_NETWORKS_JSON environment variable. GpuComputeService selects
// profiles by the prefix `gpu-<sku>`, so the profile NAMES here are load
// bearing: rename them and the GPU create form silently shows no VNets.
const NETWORKS_JSON = JSON.stringify({
  'gpu-a100-primary': {
    subscriptionId: 'sub-123',
    resourceGroup: 'fr-napoleon-rg',
    vnetName: 'fr-napoleon-vnet',
    subnetName: 'fr-napoleon-subnet',
    region: 'FranceCentral',
  },
  'gpu-h100-primary': {
    subscriptionId: 'sub-123',
    resourceGroup: 'fr-napoleon-rg',
    vnetName: 'fr-napoleon-vnet',
    subnetName: 'fr-napoleon-subnet',
    region: 'francecentral',
  },
  testvm: {
    subscriptionId: 'sub-123',
    resourceGroup: 'rg-network',
    vnetName: 'vnet-platform',
    subnetName: 'snet-testvm',
    region: 'swedencentral',
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.CLOUDHUB_NETWORKS_JSON;
});

afterEach(() => {
  delete process.env.CLOUDHUB_NETWORKS_JSON;
});

const build = () => new CloudHubNetworksService({ logger: mockLogger });

describe('CloudHubNetworksService', () => {
  it('is empty when nothing is configured', () => {
    // This is the state that made GPU create unusable: no error, no profiles.
    expect(build().getAll()).toEqual({});
    expect(build().listByPrefix('gpu-a100')).toEqual([]);
  });

  it('loads profiles from CLOUDHUB_NETWORKS_JSON', () => {
    process.env.CLOUDHUB_NETWORKS_JSON = NETWORKS_JSON;

    expect(Object.keys(build().getAll()).sort()).toEqual([
      'gpu-a100-primary',
      'gpu-h100-primary',
      'testvm',
    ]);
  });

  it('matches GPU profiles by the gpu-<sku> prefix GpuComputeService uses', () => {
    process.env.CLOUDHUB_NETWORKS_JSON = NETWORKS_JSON;
    const service = build();

    expect(service.listByPrefix('gpu-a100').map(p => p.name)).toEqual([
      'gpu-a100-primary',
    ]);
    expect(service.listByPrefix('gpu-h100').map(p => p.name)).toEqual([
      'gpu-h100-primary',
    ]);
    // The generic 'gpu-' fallback sees both, and never the VM profile.
    expect(service.listByPrefix('gpu-').map(p => p.name).sort()).toEqual([
      'gpu-a100-primary',
      'gpu-h100-primary',
    ]);
  });

  it("exposes the exact 'testvm' profile name TestVmService requires", () => {
    process.env.CLOUDHUB_NETWORKS_JSON = NETWORKS_JSON;

    // TestVmService calls hasProfile('testvm')/subnetIdFor('testvm') with this
    // literal name and has no fallback to CLOUDHUB_TEST_VM_SUBNET_ID. Without
    // the profile the Test VM card renders "Provisioning is not configured"
    // and creation is refused -- so the name is part of the contract.
    expect(build().hasProfile('testvm')).toBe(true);
    expect(build().subnetIdFor('testvm')).toBe(
      '/subscriptions/sub-123/resourceGroups/rg-network/providers/' +
        'Microsoft.Network/virtualNetworks/vnet-platform/subnets/snet-testvm',
    );
  });

  it('does not let GPU profiles satisfy the Test VM profile, or vice versa', () => {
    process.env.CLOUDHUB_NETWORKS_JSON = JSON.stringify({
      'gpu-a100-primary': {
        subscriptionId: 'sub-123',
        resourceGroup: 'fr-napoleon-rg',
        vnetName: 'fr-napoleon-vnet',
        subnetName: 'fr-napoleon-subnet',
        region: 'francecentral',
      },
    });

    // Configuring only GPU profiles is what silently disabled the Test VM card.
    expect(build().hasProfile('testvm')).toBe(false);
    expect(build().listByPrefix('gpu-a100')).toHaveLength(1);
  });
  it('lowercases regions so VNet/region equality checks hold', () => {
    process.env.CLOUDHUB_NETWORKS_JSON = NETWORKS_JSON;

    // GpuComputeService compares `item.region === input.region.toLowerCase()`,
    // so a mixed-case region in config must be normalised on the way in.
    expect(build().getNetworkProfile('gpu-a100-primary').region).toBe(
      'francecentral',
    );
  });

  it('rejects a profile that is missing a required field', () => {
    process.env.CLOUDHUB_NETWORKS_JSON = JSON.stringify({
      'gpu-a100-primary': {
        subscriptionId: 'sub-123',
        resourceGroup: 'fr-napoleon-rg',
        vnetName: 'fr-napoleon-vnet',
        // subnetName omitted -- this is exactly what the legacy
        // GPU_ONBOARDED_VNETS_JSON entries looked like.
        region: 'francecentral',
      },
    });

    expect(() => build()).toThrow(/subnetName/);
  });

  it('rejects a JSON array, which the legacy setting used', () => {
    process.env.CLOUDHUB_NETWORKS_JSON = JSON.stringify([
      { subscriptionId: 'sub-123' },
    ]);

    expect(() => build()).toThrow(/JSON object keyed by profile name/);
  });

  it('builds the ARM subnet id Terraform is handed', () => {
    process.env.CLOUDHUB_NETWORKS_JSON = NETWORKS_JSON;

    expect(buildSubnetId(build().getNetworkProfile('gpu-a100-primary'))).toBe(
      '/subscriptions/sub-123/resourceGroups/fr-napoleon-rg/providers/' +
        'Microsoft.Network/virtualNetworks/fr-napoleon-vnet/subnets/' +
        'fr-napoleon-subnet',
    );
  });

  it('reports an unconfigured profile by name', () => {
    expect(() => build().getNetworkProfile('gpu-a100-primary')).toThrow(
      /CLOUDHUB_NETWORKS_JSON/,
    );
  });
});
