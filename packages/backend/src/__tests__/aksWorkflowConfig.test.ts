/**
 * Effective configuration guards for the AKS workflow. Production runs with
 * `--config app-config.yaml --config app-config.production.yaml`
 * (packages/backend/Dockerfile, docker/Dockerfile.backend).
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {
  INFRA_REPOSITORY,
  InfrastructureProvisioningService,
} from '../services/InfrastructureProvisioningService';
import { JumpboxAccessProvisioningService } from '../services/JumpboxAccessProvisioningService';

const root = path.resolve(__dirname, '../../../..');
const load = (file: string) =>
  (yaml.load(fs.readFileSync(path.join(root, file), 'utf8')) ?? {}) as any;

function merge(base: any, override: any): any {
  if (typeof base !== 'object' || base === null) return override ?? base;
  const out: any = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    out[key] =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? merge(base[key], value)
        : value;
  }
  return out;
}

const configFiles = fs
  .readdirSync(root)
  .filter(file => /^app-config.*\.ya?ml$/.test(file));
const effective = {
  development: load('app-config.yaml'),
  production: merge(
    load('app-config.yaml'),
    load('app-config.production.yaml'),
  ),
};

describe('AKS workflow configuration', () => {
  it('never enables production AKS submissions in any config file', () => {
    for (const file of configFiles) {
      expect(
        load(file)?.provisioning?.aks?.productionSubmissions?.enabled,
      ).not.toBe(true);
    }
    for (const config of Object.values(effective)) {
      expect(config.provisioning.aks.productionSubmissions.enabled).toBe(false);
    }
  });

  it('targets the repositories identified by the audit', () => {
    expect(INFRA_REPOSITORY).toBe('SymphonySensa/scp-infra-as-code');
    for (const config of Object.values(effective)) {
      expect(config.provisioning.tailscale).toMatchObject({
        owner: 'SymphonyFS',
        repo: 'tailscale',
        baseBranch: 'main',
      });
    }
    // Code default when neither configuration nor env is supplied.
    const saved = process.env.TAILSCALE_REPO_OWNER;
    delete process.env.TAILSCALE_REPO_OWNER;
    try {
      const service = new JumpboxAccessProvisioningService({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn(),
      } as any);
      expect(`${service.repo.owner}/${service.repo.repo}`).toBe(
        'SymphonyFS/tailscale',
      );
    } finally {
      if (saved !== undefined) process.env.TAILSCALE_REPO_OWNER = saved;
    }
  });

  it('keeps auto-merge off for every PR CloudHub opens, in every environment', () => {
    // Tailscale PR: config-controlled; must be off (merge is maintainer-controlled
    // and SymphonyFS/tailscale disallows auto-merge). Infrastructure PR: no code path.
    for (const file of configFiles) {
      expect(load(file)?.provisioning?.github?.autoMerge?.enabled).not.toBe(
        true,
      );
    }
    for (const config of Object.values(effective)) {
      expect(config.provisioning.github.autoMerge.enabled).toBe(false);
    }
    const workflows = fs
      .readdirSync(path.join(root, '.github/workflows'))
      .map(file =>
        fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'),
      )
      .join('\n');
    expect(workflows).not.toMatch(
      /CLOUDHUB_AUTO_MERGE_ENABLED\s*[:=]\s*['"]?true/,
    );
    expect(workflows).not.toMatch(/APP_CONFIG_provisioning_github_autoMerge/);
    const plugin = fs.readFileSync(
      path.resolve(__dirname, '../provisioningPlugin.ts'),
      'utf8',
    );
    expect(plugin).toMatch(
      /new InfrastructureProvisioningService\(\s*logger,?\s*\)/,
    );
    const infra = fs.readFileSync(
      path.resolve(
        __dirname,
        '../services/InfrastructureProvisioningService.ts',
      ),
      'utf8',
    );
    expect(infra).not.toMatch(
      /autoMerge|AUTO_MERGE|enablePullRequestAutoMerge|pulls\.merge/,
    );
  });

  it('does not wire read-only tracking variables to write-capable secrets in deploy workflows', () => {
    const workflows = fs
      .readdirSync(path.join(root, '.github/workflows'))
      .map(file =>
        fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'),
      )
      .join('\n');
    const lines = workflows.split('\n');
    const tfcReadLines = lines.filter(line =>
      /CLOUDHUB_AKS_TFC_READ_TOKEN\s*[:=]/.test(line),
    );
    const githubReadLines = lines.filter(line =>
      /CLOUDHUB_AKS_GITHUB_READ_TOKEN\s*[:=]/.test(line),
    );
    expect(
      tfcReadLines.filter(line => /CLOUDHUB_TFC_TOKEN\b/.test(line)),
    ).toEqual([]);
    expect(
      githubReadLines.filter(line =>
        /GITHUB_ACTIONS_TOKEN|GITHUB_TOKEN\b/.test(line),
      ),
    ).toEqual([]);
  });

  it('ignores the GitHub API URL override in production', () => {
    const saved = { ...process.env };
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as any;
    try {
      process.env.GITHUB_TOKEN = 'x';
      process.env.CLOUDHUB_GITHUB_API_URL = 'http://127.0.0.1:1/stub';
      (process.env as any).NODE_ENV = 'production';
      const prod = new InfrastructureProvisioningService(logger) as any;
      expect(prod.octokit.request.endpoint.DEFAULTS.baseUrl).toBe(
        'https://api.github.com',
      );
      (process.env as any).NODE_ENV = 'development';
      const dev = new InfrastructureProvisioningService(logger) as any;
      expect(dev.octokit.request.endpoint.DEFAULTS.baseUrl).toBe(
        'http://127.0.0.1:1/stub',
      );
    } finally {
      process.env = saved;
    }
  });
});
