import fs from 'fs';
import nodePath from 'path';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { PortalDeploymentApplicationOption, PortalDeploymentInstance } from '../types';
import { listCatalogVersions } from './releaseCatalogService';
import { deploymentRepository } from './deploymentPipeline';

interface RepositoryEntry { type: 'file' | 'dir'; name: string; path: string; }
interface RepositoryContent { type: 'file'; encoding?: string; content?: string; }

const APP_LIST_START = /^APP_LIST=\($/;
const APP_LIST_END = /^\)$/;
const APP_NAME = /^[a-z0-9][a-z0-9-]*$/;

const APP_ROOTS = ['apps', 'scp/apps'];

const FALLBACK_APP_LIST = [
  'ai-store',
  'common-res',
  'edb-common-res',
  'datadog',
  'dxv',
  'detectionhub',
  'flows',
  'invhub',
  'netreveal',
  'netrevealv95',
  'netrevealv96',
  'edb-netrevealv96',
  'sales-genie',
  'sensaai-sanctions',
  'tailscale',
  'velero',
  'istio-service-entry',
  'hybrid-manager',
];

export class ScriptsApplicationCatalogService {
  constructor(private readonly logger: LoggerService) {}

  private invalidCatalogStructureError(): Error {
    return new Error(
      `Repository ${this.repositoryLabel()} has no usable deployment catalog. Expected either task.bash with APP_LIST or application directories under apps/ or scp/apps/.`,
    );
  }

  private repositoryLabel(): string {
    return this.repository();
  }

  private repository(): string {
    return deploymentRepository();
  }

  private token(): string {
    const token =
      process.env.GITHUB_PAT?.trim() ||
      process.env.GITHUB_ACTIONS_TOKEN?.trim() ||
      process.env.CLOUDHUB_GITHUB_TOKEN?.trim() ||
      process.env.GITHUB_TOKEN?.trim();
    if (!token) throw new Error('A GitHub token is required for scripts catalog access.');
    return token;
  }

  private async get(path: string, optional = false): Promise<unknown | null> {
    const ref = process.env.SYMPHONYFS_WORKFLOW_REF?.trim() || 'main';
    const repository = this.repositoryLabel();
    const response = await fetch(`https://api.github.com/repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${this.token()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) {
      if (optional && response.status === 404) {
        return null;
      }
      throw new Error(`Unable to read ${repository}/${path} (${response.status}).`);
    }
    return response.json();
  }

  private decode(content: RepositoryContent): string {
    if (content.encoding !== 'base64' || !content.content) throw new Error('Unsupported GitHub repository content encoding.');
    return Buffer.from(content.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }

  async readTextIfExists(path: string): Promise<string | null> {
    const content = (await this.get(path, true)) as RepositoryContent | null;
    if (!content || content.type !== 'file') {
      return null;
    }
    return this.decode(content);
  }

  private async readAppListFromDirectory(): Promise<string[]> {
    const applications = new Set<string>();
    for (const root of APP_ROOTS) {
      const entries = (await this.get(root, true)) as RepositoryEntry[] | null;
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const name = entry.name.trim();
        if (entry.type === 'dir' && APP_NAME.test(name)) applications.add(name);
      }
    }
    if (applications.size === 0) {
      throw this.invalidCatalogStructureError();
    }
    return [...applications];
  }

  private readAppListLocalFallback(): string[] {
    const apps = new Set<string>();
    const baseDirs = [
      process.cwd(),
      nodePath.resolve(process.cwd(), '..'),
      '/app',
    ];
    for (const base of baseDirs) {
      for (const root of APP_ROOTS) {
        const fullDir = nodePath.resolve(base, root);
        if (fs.existsSync(fullDir)) {
          try {
            const entries = fs.readdirSync(fullDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory() && APP_NAME.test(entry.name)) {
                apps.add(entry.name);
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }
    if (apps.size > 0) {
      return Array.from(apps);
    }
    return [...FALLBACK_APP_LIST];
  }

  private async readAppList(): Promise<string[]> {
    try {
      const taskFile = (await this.get('task.bash', true)) as RepositoryContent | null;
      if (!taskFile || taskFile.type !== 'file') {
        this.logger.warn(
          `[control-plane] task.bash not found in ${this.repositoryLabel()}, falling back to apps/ directory discovery.`,
        );
        return await this.readAppListFromDirectory();
      }
      const source = this.decode(taskFile);
      const lines = source.split(/\r?\n/);
      const start = lines.findIndex(line => APP_LIST_START.test(line.trim()));
      if (start < 0) {
        this.logger.warn(
          `[control-plane] APP_LIST was not found in task.bash for ${this.repositoryLabel()}, falling back to apps/ directory discovery.`,
        );
        return await this.readAppListFromDirectory();
      }
      const applications: string[] = [];
      for (const line of lines.slice(start + 1)) {
        const value = line.trim();
        if (APP_LIST_END.test(value)) break;
        if (value && APP_NAME.test(value)) applications.push(value);
      }
      if (applications.length === 0) {
        this.logger.warn(
          `[control-plane] APP_LIST in task.bash is empty for ${this.repositoryLabel()}, falling back to apps/ directory discovery.`,
        );
        return await this.readAppListFromDirectory();
      }
      return applications;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('has no usable deployment catalog')
      ) {
        throw error;
      }
      this.logger.warn(
        `[control-plane] Failed to read APP_LIST from GitHub (${error instanceof Error ? error.message : String(error)}), falling back to local apps/ catalog.`,
      );
      return this.readAppListLocalFallback();
    }
  }

  async listApplications(): Promise<PortalDeploymentApplicationOption[]> {
    return (await this.readAppList()).map(appName => ({
      id: appName,
      appName,
      displayName: appName,
      description: `Deploy ${appName} through the SymphonyFS scripts pipeline.`,
      chartVersions: listCatalogVersions(appName),
      supportsAiStoreIntegration: false,
    }));
  }

  async listInstances(application?: string): Promise<PortalDeploymentInstance[]> {
    const applications = application ? [application] : await this.readAppList();
    const instances: PortalDeploymentInstance[] = [];
    const authoritative = await this.readAppList();
    for (const appName of applications) {
      if (!authoritative.includes(appName)) continue;
      // scp/apps-only applications have no per-instance folders under apps/.
      const entries = ((await this.get(`apps/${appName}`, true)) as RepositoryEntry[] | null) ?? [];
      for (const entry of entries.filter(item => item.type === 'dir')) {
        const helmfilePath = `apps/${appName}/${entry.name}/helmfile.yaml`;
        try {
          const metadata = this.readMetadata(this.decode((await this.get(helmfilePath)) as RepositoryContent));
          instances.push({ appName, appInstance: entry.name, helmfilePath, metadata });
        } catch (error) {
          this.logger.debug(`Skipping invalid scripts instance ${helmfilePath}: ${String(error)}`);
        }
      }
    }
    return instances;
  }

  private readMetadata(source: string): Record<string, string> {
    const metadata: Record<string, string> = {};
    for (const key of ['kubeContext', 'namespace', 'owners', 'client_facing', 'applicationPrefix', 'clientSubDomain', 'envType']) {
      const match = source.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n]+)`, 'm'));
      if (match?.[1]) metadata[key] = match[1].trim();
    }
    return metadata;
  }
}
