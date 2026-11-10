import { buildReadOnlyIntegrations } from '../services/aksReadOnlyIntegrations';
import { ReadOnlyHttpClient } from '../services/readOnlyHttp';

const fakeCredential = () => ({
  getToken: jest.fn(async () => ({ token: 'arm-token' })),
});

describe('buildReadOnlyIntegrations (credential separation)', () => {
  it('builds every client on the read-only transport from read-only credentials', () => {
    const integrations = buildReadOnlyIntegrations(
      {
        CLOUDHUB_AKS_GITHUB_READ_TOKEN: 'gh-read',
        GITHUB_ACTIONS_TOKEN: 'gh-write',
        CLOUDHUB_AKS_TFC_READ_TOKEN: 'tfc-read',
        CLOUDHUB_TFC_TOKEN: 'tfc-write',
        AZURE_TENANT_ID: 'd0fec9dd-9219-4514-a1d8-1a872244bf6e',
        AZURE_CLIENT_ID: '73b2043b-6230-480a-8a9a-fd37f68af1b2',
        AZURE_CLIENT_SECRET: 's',
      },
      fakeCredential,
    );
    expect(integrations.problems).toEqual([]);
    for (const reader of [
      integrations.github,
      integrations.githubWriteProbes.infra,
      integrations.tfc,
      integrations.azure,
    ]) {
      expect(reader!.client).toBeInstanceOf(ReadOnlyHttpClient);
    }
  });

  it('never falls back to the GitHub write token for tracking', () => {
    const integrations = buildReadOnlyIntegrations(
      { GITHUB_ACTIONS_TOKEN: 'gh-write', GITHUB_TOKEN: 'gh-write-2' },
      fakeCredential,
    );
    expect(integrations.github).toBeNull();
    expect(integrations.problems.join(' ')).toMatch(
      /CLOUDHUB_AKS_GITHUB_READ_TOKEN is not set/,
    );
  });

  it.each([
    ['GITHUB_ACTIONS_TOKEN', { GITHUB_ACTIONS_TOKEN: 'same' }],
    ['GITHUB_TOKEN', { GITHUB_TOKEN: 'same' }],
  ])('refuses a GitHub read token equal to %s', (_name, env) => {
    const integrations = buildReadOnlyIntegrations(
      { CLOUDHUB_AKS_GITHUB_READ_TOKEN: 'same', ...env },
      fakeCredential,
    );
    expect(integrations.github).toBeNull();
    expect(integrations.problems.join(' ')).toMatch(
      /equals the GitHub write token/,
    );
  });

  it('never uses the write-capable CLOUDHUB_TFC_TOKEN', () => {
    let integrations = buildReadOnlyIntegrations(
      { CLOUDHUB_TFC_TOKEN: 'tfc-write' },
      fakeCredential,
    );
    expect(integrations.tfc).toBeNull();
    integrations = buildReadOnlyIntegrations(
      { CLOUDHUB_TFC_TOKEN: 'same', CLOUDHUB_AKS_TFC_READ_TOKEN: 'same' },
      fakeCredential,
    );
    expect(integrations.tfc).toBeNull();
    expect(integrations.problems.join(' ')).toMatch(
      /equals CLOUDHUB_TFC_TOKEN/,
    );
  });

  it('uses only the canonical AZURE_* platform identity', async () => {
    const credential = fakeCredential();
    const make = jest.fn(() => credential);
    let integrations = buildReadOnlyIntegrations(
      {
        AZURE_TENANT_ID: 'd0fec9dd-9219-4514-a1d8-1a872244bf6e',
        AZURE_CLIENT_ID: '73b2043b-6230-480a-8a9a-fd37f68af1b2',
        AZURE_CLIENT_SECRET: 's',
      },
      make,
    );
    expect(integrations.azure).not.toBeNull();
    expect(make).toHaveBeenCalledWith(
      'd0fec9dd-9219-4514-a1d8-1a872244bf6e',
      '73b2043b-6230-480a-8a9a-fd37f68af1b2',
      's',
    );

    make.mockClear();
    integrations = buildReadOnlyIntegrations(
      {
        CLOUDHUB_AKS_AZURE_TENANT_ID: 't',
        CLOUDHUB_AKS_AZURE_CLIENT_ID: 'c',
        CLOUDHUB_AKS_AZURE_CLIENT_SECRET: 's',
      },
      make,
    );
    expect(make).not.toHaveBeenCalled();
    expect(integrations.azure).toBeNull();
  });
});
