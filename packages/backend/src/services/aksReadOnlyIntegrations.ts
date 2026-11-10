/**
 * Credential selection for AKS execution tracking and submission preflight.
 *
 * Read-only credentials are kept separate from write-capable ones:
 *  - Tracking and the address-space inventory read GitHub only with
 *    CLOUDHUB_AKS_GITHUB_READ_TOKEN. There is no fallback to the token CloudHub
 *    writes PRs with (GITHUB_ACTIONS_TOKEN / GITHUB_TOKEN).
 *  - Terraform Cloud is read only with CLOUDHUB_AKS_TFC_READ_TOKEN, never with
 *    CLOUDHUB_TFC_TOKEN (which can start runs for other CloudHub features).
 *  - Azure is read only with the canonical AZURE_* platform identity.
 *  - A "read" token whose value equals a write token is refused, because it
 *    would carry write permissions.
 * The write tokens are used for exactly one read each: the github_permissions
 * gate checks, with a GET, that the token each writer uses can push to its
 * repository (infrastructure PR: GITHUB_ACTIONS_TOKEN, else GITHUB_TOKEN;
 * Tailscale PR: GITHUB_TOKEN, which index.ts fills from CLOUDHUB_GITHUB_TOKEN).
 * Every client returned here is a ReadOnlyHttpClient.
 */

import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import { GithubReader, TerraformCloudReader } from './aksExternalReaders';
import { AzureReader } from './aksSubmissionGates';

export interface ReadOnlyIntegrations {
  /** Tracking + inventory (read token only). */
  github: GithubReader | null;
  /** github_permissions gate only: repository-metadata GETs with each writer's token. */
  githubWriteProbes: {
    infra: GithubReader | null;
    tailscale: GithubReader | null;
  };
  tfc: TerraformCloudReader | null;
  azure: AzureReader | null;
  azureManagementGroup?: string;
  /** Configuration problems, logged at startup. */
  problems: string[];
}

export function buildReadOnlyIntegrations(
  env: NodeJS.ProcessEnv = process.env,
  makeAzureCredential: (
    tenant: string,
    client: string,
    secret: string,
  ) => { getToken(scope: string): Promise<{ token: string } | null> } = (
    tenant,
    client,
    secret,
  ) =>
    createCloudHubAzureCredential(undefined, {
      AZURE_TENANT_ID: tenant,
      AZURE_CLIENT_ID: client,
      AZURE_CLIENT_SECRET: secret,
    }),
): ReadOnlyIntegrations {
  const problems: string[] = [];
  const writeTokens = [
    env.GITHUB_ACTIONS_TOKEN,
    env.GITHUB_TOKEN,
    env.CLOUDHUB_GITHUB_TOKEN,
  ].filter((token): token is string => Boolean(token));

  let github: GithubReader | null = null;
  const githubRead = env.CLOUDHUB_AKS_GITHUB_READ_TOKEN;
  if (!githubRead) {
    problems.push(
      'CLOUDHUB_AKS_GITHUB_READ_TOKEN is not set: execution tracking and the repository address-space check are disabled',
    );
  } else if (writeTokens.includes(githubRead)) {
    problems.push(
      'CLOUDHUB_AKS_GITHUB_READ_TOKEN equals the GitHub write token; refusing to use it for read-only tracking',
    );
  } else {
    github = GithubReader.create({ token: githubRead });
  }

  // Mirror the writers' own token resolution exactly.
  const infraWriteToken = env.GITHUB_ACTIONS_TOKEN || env.GITHUB_TOKEN;
  const tailscaleWriteToken = env.GITHUB_TOKEN;
  const githubWriteProbes = {
    infra: infraWriteToken
      ? GithubReader.create({ token: infraWriteToken })
      : null,
    tailscale: tailscaleWriteToken
      ? GithubReader.create({ token: tailscaleWriteToken })
      : null,
  };

  let tfc: TerraformCloudReader | null = null;
  const tfcRead = env.CLOUDHUB_AKS_TFC_READ_TOKEN;
  if (!tfcRead) {
    problems.push(
      'CLOUDHUB_AKS_TFC_READ_TOKEN is not set: Terraform Cloud tracking is disabled',
    );
  } else if (env.CLOUDHUB_TFC_TOKEN && tfcRead === env.CLOUDHUB_TFC_TOKEN) {
    problems.push(
      'CLOUDHUB_AKS_TFC_READ_TOKEN equals CLOUDHUB_TFC_TOKEN (write-capable); refusing to use it',
    );
  } else {
    tfc = TerraformCloudReader.create({ token: tfcRead });
  }

  let azure: AzureReader | null = null;
  const tenant = env.AZURE_TENANT_ID;
  const client = env.AZURE_CLIENT_ID;
  const secret = env.AZURE_CLIENT_SECRET;
  if (tenant && client && secret) {
    const credential = makeAzureCredential(tenant, client, secret);
    azure = AzureReader.create({
      getToken: async () => {
        const token = await credential.getToken(
          'https://management.azure.com/.default',
        );
        if (!token) throw new Error('Azure returned no access token');
        return token.token;
      },
    });
  } else {
    problems.push(
      'AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET are not all set: the Azure address-space and quota checks cannot be verified',
    );
  }

  return {
    github,
    githubWriteProbes,
    tfc,
    azure,
    azureManagementGroup: env.CLOUDHUB_AKS_AZURE_MANAGEMENT_GROUP || undefined,
    problems,
  };
}
