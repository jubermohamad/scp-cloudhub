import crypto from 'crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LoggerService } from '@backstage/backend-plugin-api';
import sdk from '@1password/sdk';
import type {
  PortalFilePlaceholderFinding,
  PortalSecretProvisionStatusView,
  PortalSecretReadinessReport,
  PortalSecretRefFinding,
  PortalSecretRefSource,
  PortalSecretUpdateRequest,
  PortalSecretUpdateResult,
  PersonaRole,
} from '../types';
import {
  isPipelineRefField,
  extractNamespaceFromField,
  resolveReleasePointers,
} from './releaseCatalogService';
import { ScriptsApplicationCatalogService } from './scriptsApplicationCatalogService';

export interface ProvisionProgressEvent {
  step: string;
  status: 'INFO' | 'SUCCESS' | 'FAILED' | 'WARNING';
  detail: string;
  timestamp: string;
}

const DEFAULT_CACHE_SECONDS = 300;
const OP_REF_RE = /(?:ref\+)?op:\/\/[^\s'"`\)\]}>,]+/g;
const ENV_REF_RE =
  /\b(?:env|requiredEnv)\s+["']((?:CLOUDHUB|ENV)_[A-Z0-9_]+)["']/gi;
const FETCH_SECRET_VALUE_RE =
  /\bfetchSecretValue\s*\(?\s*["']([^"']+)["']\s*\)?/gi;
const SECRET_ENV_KEY_RE = /^(?:CLOUDHUB|ENV)_[A-Z0-9_]+$/i;
const UPDATE_ME_RE = /\bUPDATE_ME[A-Z0-9_-]*\b/g;
const AUTOMATIC_UPDATE_ME_FIELDS = new Set([
  'UPDATE_ME_NC_SUFFIX',
  'UPDATE_ME_OWNERS',
  'UPDATE_ME_CLIENT_FACING',
  'UPDATE_ME_CLIENT_SUBDOMAIN',
  'UPDATE_ME_ENV_TYPE',
  'UPDATE_ME_NAMESPACE',
]);
const BASE64_FIELD_RE = /__base64__$/i;
const PIPELINE_CONTROL_FIELDS = new Set([
  'helm_chart_version',
  'helm_chart_values_file_ref',
  'project_overlay_files_ref',
  'project_overlay_branch',
  'deployment_branch',
  'entity_resolution_chart_version',
]);
const CONVENTION_FALLBACK_APPS = new Set([
  'investigation',
  'invhub',
  'netreveal',
  'netrevealv95',
  'netrevealv96',
  'sensaai-sanctions',
]);
const CONVENTION_ENVIRONMENTS = new Set([
  'dev',
  'qa',
  'uat',
  'prod',
  'sandbox',
  'test',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type OptionalTextReader = (absolutePath: string) => Promise<string | null>;

interface ParsedReference {
  normalizedReference: string;
  vault: string;
  item: string;
  section: string | null;
  field: string;
}

interface SecretReadinessInput {
  application: string;
  instanceName: string;
  customer: string;
  vault?: string;
  clusterName?: string;
  includePipelineRefs?: boolean;
  forceRefresh?: boolean;
}

interface SourceFile {
  path: string;
  content: string;
}

type ReferenceMap = Map<
  string,
  { parsed: ParsedReference; sources: PortalSecretRefSource[] }
>;

interface CacheEntry {
  expiresAtMs: number;
  report: PortalSecretReadinessReport;
}

interface OnePasswordSecretReadinessDeps {
  logger: LoggerService;
  catalog: ScriptsApplicationCatalogService;
  config?: {
    getOptionalString: (key: string) => string | undefined;
  };
  readLocalTextFile?: OptionalTextReader;
  now?: () => number;
  createClient?: () => Promise<any>;
}

interface OnePasswordConnectionStatus {
  ready: boolean;
  message: string;
}

interface BootstrapCustomerStructureResult {
  vault: string;
  item: string;
  sections: string[];
}

export class OnePasswordSecretReadinessService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly logger: LoggerService;
  private readonly catalog: ScriptsApplicationCatalogService;
  private readonly config?: {
    getOptionalString: (key: string) => string | undefined;
  };
  private readonly readLocalTextFile: OptionalTextReader;
  private readonly now: () => number;
  private readonly createClient: () => Promise<any>;
  private clientPromise: Promise<any> | null = null;

  constructor(deps: OnePasswordSecretReadinessDeps) {
    this.logger = deps.logger;
    this.catalog = deps.catalog;
    this.config = deps.config;
    this.readLocalTextFile = deps.readLocalTextFile ?? this.defaultLocalReader;
    this.now = deps.now ?? (() => Date.now());
    this.createClient =
      deps.createClient ??
      (async () =>
        sdk.createClient({
          auth: this.serviceAccountToken(),
          integrationName: 'CloudHub-Deployment-Engine',
          integrationVersion: 'v1.0.0',
        }));
  }

  isConfigured(): boolean {
    if (process.env.CLOUDHUB_1PASSWORD_DISABLED === 'true') {
      return false;
    }
    try {
      const token = this.serviceAccountToken();
      return Boolean(token && token.trim().length > 0 && !token.includes('${'));
    } catch {
      return false;
    }
  }

  private serviceAccountToken(): string {
    let token: string | undefined;

    // Try config paths first
    try {
      token = this.config
        ?.getOptionalString(
          'deploymentControlPlane.onePassword.serviceAccountToken',
        )
        ?.trim();
      if (token && !token.includes('${')) {
        return token;
      }
    } catch {
      // Ignore config schema errors when env var is empty string
    }

    try {
      token = this.config
        ?.getOptionalString('onePassword.serviceAccountToken')
        ?.trim();
      if (token && !token.includes('${')) {
        return token;
      }
    } catch {
      // Ignore config schema errors
    }

    // If config had unexpanded ${...}, or is missing, read from environment
    token = process.env.OP_SERVICE_ACCOUNT_TOKEN?.trim();
    if (!token) {
      const pathHint =
        'Set OP_SERVICE_ACCOUNT_TOKEN environment variable or add to app-config.yaml:\n' +
        'deploymentControlPlane:\n' +
        '  onePassword:\n' +
        '    serviceAccountToken: ${OP_SERVICE_ACCOUNT_TOKEN}';
      throw new Error(
        `Missing 1Password service-account token in backend config or OP_SERVICE_ACCOUNT_TOKEN environment variable.\n${pathHint}`,
      );
    }
    return token;
  }

  private async getClient(): Promise<any> {
    this.serviceAccountToken();
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    return this.clientPromise;
  }

  private async listVaults(): Promise<any[]> {
    const client = await this.getClient();
    const vaults = await client.vaults.list({ decryptDetails: true });
    return Array.isArray(vaults) ? vaults : Array.from(vaults ?? []);
  }

  async listVaultNames(): Promise<string[]> {
    const vaults = await this.listVaults();
    return Array.from(
      new Set(
        vaults
          .map((vault: any) =>
            String(vault?.title ?? vault?.name ?? vault?.id ?? '').trim(),
          )
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  async resolveVaultId(vaultName: string): Promise<string> {
    const normalized = vaultName.trim();
    if (!normalized) {
      throw new Error('vault name is required');
    }

    const vaults = await this.listVaults();
    const match = vaults.find(
      (vault: any) => vault.id === normalized || vault.title === normalized,
    );
    if (match?.id) {
      return String(match.id);
    }

    // Allow callers to provide a raw vault ID directly when it wasn't
    // included in the list response, but avoid passing plain names as IDs.
    if (/^[A-Za-z0-9_-]{20,}$/.test(normalized)) {
      return normalized;
    }

    throw new Error(`Unable to resolve 1Password vault '${vaultName}'.`);
  }

  private async listItems(vaultId: string): Promise<any[]> {
    const client = await this.getClient();
    const items = await client.items.list(vaultId);
    return Array.isArray(items) ? items : Array.from(items ?? []);
  }

  async getItemByTitleOrId(vaultId: string, item: string): Promise<any | null> {
    const items = await this.listItems(vaultId);
    const overview = items.find(
      (candidate: any) => candidate.id === item || candidate.title === item,
    );
    if (!overview?.id) {
      return null;
    }
    const client = await this.getClient();
    return client.items.get(vaultId, overview.id);
  }

  private async saveItem(item: any): Promise<any> {
    const client = await this.getClient();
    return client.items.put(item);
  }

  private inferFieldType(field: string): any {
    const lowerField = field.toLowerCase();
    if (lowerField.includes('password') || lowerField.includes('secret')) {
      return 'Concealed';
    }
    return 'Text';
  }

  private async upsertItemField(input: {
    vaultId: string;
    itemTitleOrId: string;
    section: string | null;
    field: string;
    value: string | Record<string, unknown> | null | undefined;
  }): Promise<void> {
    const vaultId = input.vaultId.trim();
    const itemTitleOrId = input.itemTitleOrId.trim();
    const field = input.field.trim();
    const normalized =
      input.value === null || input.value === undefined
        ? ''
        : typeof input.value === 'string'
        ? input.value
        : JSON.stringify(input.value);
    const value = normalized.replace(/\r?\n/g, '');
    const section = input.section?.trim() || null;

    let item = await this.getItemByTitleOrId(vaultId, itemTitleOrId);
    if (!item) {
      throw new Error(
        `1Password item '${itemTitleOrId}' does not exist in the selected vault. CloudHub will not create missing customer items automatically.`,
      );
    }

    item.sections = Array.isArray(item.sections) ? [...item.sections] : [];
    const sectionExists =
      !section ||
      item.sections.some(
        (entry: any) => entry.id === section || entry.title === section,
      );
    if (section && !sectionExists) {
      item.sections.push({ id: section, title: section });
      // Some 1Password SDK versions validate a field's sectionId against the
      // sections already persisted on the item, not ones introduced in the
      // same PUT payload. Commit the new section on its own first so the
      // field write below always links to a section the server already
      // knows about — otherwise it's rejected with "no section with this id
      // exists" even though the section is right there in the same request.
      item = await this.saveItem(item);
      item.sections = Array.isArray(item.sections) ? [...item.sections] : [];
    }

    // Re-resolve the section's id from what the server actually stored,
    // in case it normalized or reassigned it — never trust the id we asked
    // for over the one the server confirmed.
    const resolvedSectionId = section
      ? item.sections.find(
          (entry: any) => entry.id === section || entry.title === section,
        )?.id ?? section
      : undefined;

    item.fields = Array.isArray(item.fields) ? [...item.fields] : [];
    // The same field name legitimately exists in several namespace sections
    // (e.g. db_password), so a match must also agree on the section.
    const fieldIndex = item.fields.findIndex(
      (entry: any) =>
        (entry.id === field || entry.title === field) &&
        fieldInSection(item, entry, section),
    );
    const existing = fieldIndex >= 0 ? item.fields[fieldIndex] : undefined;
    const idTaken = item.fields.some((entry: any) => entry.id === field);
    const nextField = {
      ...(existing ?? {}),
      id: existing?.id ?? (idTaken ? crypto.randomUUID() : field),
      title: field,
      fieldType:
        fieldIndex >= 0 && item.fields[fieldIndex]?.fieldType
          ? item.fields[fieldIndex].fieldType
          : this.inferFieldType(field),
      value,
      sectionId: resolvedSectionId,
    };
    if (fieldIndex >= 0) {
      item.fields[fieldIndex] = nextField;
    } else {
      item.fields.push(nextField);
    }

    await this.saveItem(item);
  }

  /**
   * Reads the current value of a pipeline-controlled field (e.g.
   * "<namespace>__helm_chart_version") straight from the pipeline_refs
   * section, without writing anything. Returns null if the customer item,
   * section, or field doesn't exist yet — used by deployment mode detection
   * to tell a fresh install apart from an upgrade/rollback.
   */
  async getPipelineRefValue(input: {
    customer: string;
    namespace: string;
    field: string;
    vault?: string;
  }): Promise<string | null> {
    const customer = input.customer.trim();
    const namespace = input.namespace.trim();
    const field = input.field.trim();
    if (!customer || !namespace || !field) {
      return null;
    }

    const selectedVault = this.resolveSelectedVault(input.vault);
    const vaultId = await this.resolveVaultId(selectedVault);
    const item = await this.getItemByTitleOrId(vaultId, customer);
    if (!item) {
      return null;
    }

    const section = this.pipelineRefSection();
    const fullFieldName = `${namespace}__${field}`;
    const matched = (item.fields ?? []).find((entry: any) => {
      const matchesLabel =
        entry.id === fullFieldName || entry.title === fullFieldName;
      if (!matchesLabel) return false;
      return !fieldSectionRef(entry) || fieldInSection(item, entry, section);
    });

    const value = matched?.value ? String(matched.value).trim() : '';
    return value || null;
  }

  async check(
    input: SecretReadinessInput,
  ): Promise<PortalSecretReadinessReport> {
    const application = input.application.trim();
    const instanceName = input.instanceName.trim();
    const customer = input.customer.trim();
    const selectedVault = this.resolveSelectedVault(input.vault);
    const includePipelineRefs = input.includePipelineRefs ?? true;

    if (!customer) {
      const nowMs = this.now();
      const cacheExpiresAt = new Date(
        nowMs + this.cacheSeconds() * 1000,
      ).toISOString();
      return {
        ready: false,
        checkedAt: new Date(nowMs).toISOString(),
        cached: false,
        cacheExpiresAt,
        application,
        instanceName,
        clusterName: input.clusterName,
        includePipelineRefs,
        filesScanned: [],
        referencesDiscovered: 0,
        findings: [],
        missing: [],
        placeholders: [],
        filePlaceholders: [],
        summary: 'Select a customer to validate 1Password readiness.',
      };
    }

    if (!application || !instanceName || !customer) {
      throw new Error(
        'application, instanceName, and customer are required for secret readiness checks.',
      );
    }

    const cacheSeconds = this.cacheSeconds();
    const cacheKey = this.cacheKey({
      application,
      instanceName,
      customer,
      vault: selectedVault,
      clusterName: input.clusterName,
      includePipelineRefs,
    });
    const nowMs = this.now();

    if (!input.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAtMs > nowMs) {
        return {
          ...cached.report,
          cached: true,
        };
      }
    }

    const files = await this.loadCandidateFiles(application, instanceName);
    const opRefs = this.extractReferences(files, {
      application,
      instanceName,
      customer,
      vault: selectedVault,
      includePipelineRefs,
    });
    const filePlaceholders = this.extractFilePlaceholders(files);
    const warnings: string[] = [];

    const findings: PortalSecretRefFinding[] = [];
    const missing: PortalSecretRefFinding[] = [];
    const placeholders: PortalSecretRefFinding[] = [];

    const opConnection = await this.verifyOnePasswordConnection(selectedVault);
    const opReady = opConnection.ready;

    const fallbackWarning = await this.applyConventionFallbackReferences({
      refs: opRefs,
      application,
      instanceName,
      customer,
      vault: selectedVault,
      opReady,
    });
    if (fallbackWarning) {
      warnings.push(fallbackWarning);
    }

    for (const { parsed, sources } of opRefs.values()) {
      const finding = await this.checkReference(parsed, sources, opReady);
      findings.push(finding);
      if (finding.status === 'MISSING' || finding.status === 'ERROR') {
        missing.push(finding);
      }
      if (finding.status === 'PLACEHOLDER' || finding.status === 'EMPTY') {
        placeholders.push(finding);
      }
    }

    const filesScanned = files.map(file => file.path);
    const referencesDiscovered = findings.length;
    const usesExternalSecretsModel = files.some(file =>
      isExternalSecretsManagedFile(file.content),
    );

    const noRefs = referencesDiscovered === 0;
    const noSourceFiles = files.length === 0;

    if (noSourceFiles) {
      warnings.push(
        'No instance override files were found to inspect (apps/* or scp/apps/*).',
      );
    }
    const requireReferencesConfigured =
      process.env.CLOUDHUB_1PASSWORD_REQUIRE_REFS !== 'false';
    const requireReferences =
      requireReferencesConfigured && !usesExternalSecretsModel;

    if (noRefs) {
      if (usesExternalSecretsModel) {
        warnings.push(
          'No inline op://, ref+op://, or env "CLOUDHUB_*"/"ENV_*" references were discovered, but this instance uses external-secrets; inline reference validation is not required.',
        );
      } else {
        warnings.push(
          'No op://, ref+op://, or env "CLOUDHUB_*"/"ENV_*" references were discovered in the scanned files.',
        );
      }
    }

    const ready =
      opReady &&
      missing.length === 0 &&
      placeholders.length === 0 &&
      filePlaceholders.length === 0 &&
      (!requireReferences || referencesDiscovered > 0);

    const summary = this.summary({
      ready,
      referencesDiscovered,
      missingCount: missing.length,
      placeholderCount: placeholders.length,
      filePlaceholderCount: filePlaceholders.length,
      requireReferences,
      opReady,
      connectionMessage: opConnection.message,
      warnings,
    });

    const checkedAt = new Date(nowMs).toISOString();
    const cacheExpiresAt = new Date(nowMs + cacheSeconds * 1000).toISOString();

    const report: PortalSecretReadinessReport = {
      ready,
      checkedAt,
      cached: false,
      cacheExpiresAt,
      application,
      instanceName,
      clusterName: input.clusterName,
      includePipelineRefs,
      filesScanned,
      referencesDiscovered,
      findings,
      missing,
      placeholders,
      filePlaceholders,
      summary,
    };

    this.cache.set(cacheKey, {
      expiresAtMs: nowMs + cacheSeconds * 1000,
      report,
    });

    return report;
  }

  async updateSecretFieldValue(
    input: PortalSecretUpdateRequest,
  ): Promise<PortalSecretUpdateResult> {
    const vault = input.vault.trim();
    const item = input.item.trim();
    const field = input.field.trim();
    const value = input.value;
    const section = input.section?.trim() || null;

    if (!vault || !item || !field) {
      throw new Error(
        'vault, item, and field are required to update a secret.',
      );
    }

    await this.ensureWriteAccess();
    const vaultId = await this.resolveVaultId(vault);
    await this.upsertItemField({
      vaultId,
      itemTitleOrId: item,
      section,
      field,
      value,
    });

    this.cache.clear();

    const readiness = await this.check({
      application: input.application,
      instanceName: input.instanceName,
      customer: input.customer,
      vault,
      forceRefresh: true,
    });

    return {
      success: true,
      reference: this.toReference({ vault, item, section, field }),
      message: 'Field value updated directly in 1Password.',
      readiness,
    };
  }

  async syncPipelineRefs(input: {
    vault: string;
    itemTitleOrId: string;
    namespace: string;
    helmChartVersion: string;
    overlayRef?: string;
    valuesFileRef?: string;
  }): Promise<void> {
    const trimmedVault = input.vault.trim();
    const trimmedItem = input.itemTitleOrId.trim();
    const trimmedNamespace = input.namespace.trim();
    const trimmedVersion = input.helmChartVersion.trim();
    const trimmedOverlayRef = input.overlayRef?.trim() || '';

    if (!trimmedVault || !trimmedItem || !trimmedNamespace || !trimmedVersion) {
      throw new Error(
        'vault, itemTitleOrId, namespace, and helmChartVersion are required to sync pipeline refs.',
      );
    }

    await this.ensureWriteAccess();
    const vaultId = await this.resolveVaultId(trimmedVault);

    const trimmedValuesRef = input.valuesFileRef?.trim() || '';

    const updates = [
      {
        label: `${trimmedNamespace}__helm_chart_version`,
        value: trimmedVersion,
      },
      ...(trimmedOverlayRef
        ? [
            {
              label: `${trimmedNamespace}__project_overlay_files_ref`,
              value: trimmedOverlayRef,
            },
          ]
        : []),
      ...(trimmedValuesRef
        ? [
            {
              label: `${trimmedNamespace}__helm_chart_values_file_ref`,
              value: trimmedValuesRef,
            },
          ]
        : []),
    ];

    for (const update of updates) {
      await this.upsertItemField({
        vaultId,
        itemTitleOrId: trimmedItem,
        section: this.pipelineRefSection(),
        field: update.label,
        value: update.value,
      });
    }

    this.cache.clear();
  }

  async provisionSecrets(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    applicationReleaseVersion?: string;
    actorRef: string;
    role?: string;
    entityResolutionChartVersion?: string;
    onProgress?: (event: ProvisionProgressEvent) => void;
  }): Promise<PortalSecretProvisionStatusView> {
    const application = input.application.trim();
    const instanceName = input.instanceName.trim();
    const customer = input.customer.trim();
    const selectedVault = this.resolveSelectedVault(input.vault);
    const clusterName = input.clusterName?.trim() || undefined;
    const applicationReleaseVersion =
      input.applicationReleaseVersion?.trim() || 'latest';
    const entityResolutionChartVersion =
      input.entityResolutionChartVersion?.trim() || undefined;

    const emit = (
      step: string,
      status: ProvisionProgressEvent['status'],
      detail: string,
    ) => {
      input.onProgress?.({
        step,
        status,
        detail,
        timestamp: new Date().toISOString(),
      });
    };

    if (!application || !instanceName || !customer) {
      throw new Error(
        'application, instanceName, and customer are required for 1Password provisioning.',
      );
    }

    emit(
      'Connect',
      'INFO',
      `Authenticating to 1Password with the CloudHub service account for customer '${customer}' in vault '${selectedVault}'.`,
    );
    await this.ensureWriteAccess();
    emit(
      'Connect',
      'SUCCESS',
      'Service account has write access to 1Password.',
    );

    if (entityResolutionChartVersion) {
      const namespace = this.deploymentNamespace(application, instanceName);
      const pipelineVaultName = selectedVault;
      const pipelineSection = this.pipelineRefSection();
      emit(
        'Set',
        'INFO',
        `Setting entity resolution chart version to '${entityResolutionChartVersion}' for namespace '${namespace}'.`,
      );
      const pipelineVaultId = await this.resolveVaultId(pipelineVaultName);
      await this.upsertItemField({
        vaultId: pipelineVaultId,
        itemTitleOrId: customer,
        section: pipelineSection,
        field: `${namespace}__entity_resolution_chart_version`,
        value: entityResolutionChartVersion,
      });
      emit(
        'Set',
        'SUCCESS',
        `Saved entity resolution chart version '${entityResolutionChartVersion}' to 1Password vault '${pipelineVaultName}', item '${customer}', section '${pipelineSection}'.`,
      );
    }

    emit(
      'Scan',
      'INFO',
      `Reading current secret readiness for ${application}/${instanceName} (cache bypassed).`,
    );
    const readiness = await this.check({
      application,
      instanceName,
      customer,
      vault: selectedVault,
      clusterName,
      includePipelineRefs: true,
      forceRefresh: true,
    });

    // Auto-generate only truly missing secrets. Existing placeholder or empty values
    // are intentionally left for manual review so users can replace placeholders like
    // UPDATE_ME without having CloudHub overwrite them during a bulk generation run.
    const actionableFindings = readiness.findings.filter(finding =>
      ['MISSING', 'ERROR'].includes(finding.status),
    );
    // Pipeline-control fields (helm_chart_version, helm_chart_values_file_ref, etc.)
    // must be seeded into 1Password during provisioning, not deferred to deploy time.
    // This is because helmfile diff (which runs BEFORE deploy time) must resolve
    // these ref+op://... paths from 1Password. generateProvisionValue() handles
    // these specially by populating them from the Release Catalog based on the
    // chart version, so they're safe to generate here without overwriting real values.
    const generatableFindings = actionableFindings;
    const deferredPipelineFindings = actionableFindings.filter(finding =>
      isPipelineControlField(finding.field),
    );
    const sections = Array.from(
      new Set(
        actionableFindings
          .map(
            finding =>
              finding.section ?? this.runtimeSection(application, instanceName),
          )
          .filter(Boolean),
      ),
    );
    const fieldsGenerated = Array.from(
      new Set(generatableFindings.map(finding => finding.field)),
    );

    emit(
      'Scan',
      'SUCCESS',
      `Found ${actionableFindings.length} field(s) needing a value out of ${readiness.referencesDiscovered} reference(s) discovered.`,
    );

    if (deferredPipelineFindings.length > 0) {
      emit(
        'Scan',
        'INFO',
        `${deferredPipelineFindings.length} field(s) (${deferredPipelineFindings
          .map(finding => finding.field)
          .join(
            ', ',
          )}) are pipeline-controlled (chart version/branch references) and will be seeded now from Release Catalog, then updated at deploy time.`,
      );
    }

    if (generatableFindings.length === 0) {
      emit(
        'Provision',
        'INFO',
        '1Password readiness is already green; no fields to generate.',
      );
      const now = new Date().toISOString();
      return {
        operationId: crypto.randomUUID(),
        application,
        instanceName,
        customer,
        clusterName,
        workflowRepository: '1password-direct',
        workflowId: 'direct-write',
        workflowRef: 'service-account',
        workflowRunId: null,
        workflowRunUrl: null,
        status: 'completed',
        conclusion: 'success',
        message:
          '1Password readiness is already green. No direct write was needed.',
        sections,
        fieldsGenerated,
        requestedAt: now,
        updatedAt: now,
        completedAt: now,
        readiness,
      };
    }

    const vaultName = selectedVault;
    const skippedFields = new Set<string>();

    for (const finding of generatableFindings) {
      const section =
        finding.section ?? this.runtimeSection(application, instanceName);
      const targetVault = finding.vault || vaultName;
      const targetItem = finding.item || customer;
      const generatedValue = await this.generateProvisionValue(finding.field, {
        application,
        applicationReleaseVersion,
        instanceName,
        customer,
      });
      if (generatedValue === null) {
        skippedFields.add(finding.field);
        emit(
          'Generate',
          'WARNING',
          `Cannot auto-generate '${finding.field}': set ACR_USERNAME and ACR_PASSWORD on the CloudHub backend, or enter the registry credentials manually.`,
        );
        continue;
      }
      emit(
        'Generate',
        'INFO',
        isPipelineControlField(finding.field)
          ? `Setting '${finding.field}' to '${generatedValue}' from the Release Catalog (section '${section}').`
          : `Generating a value for '${finding.field}' (section '${section}').`,
      );
      try {
        await this.upsertItemField({
          vaultId: await this.resolveVaultId(targetVault),
          itemTitleOrId: targetItem,
          section,
          field: finding.field,
          value: generatedValue,
        });
        emit(
          'Write',
          'SUCCESS',
          `Saved '${finding.field}' to 1Password vault '${targetVault}', item '${targetItem}', section '${section}'.`,
        );
      } catch (error) {
        emit(
          'Write',
          'FAILED',
          `Failed to save '${finding.field}' in section '${section}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    }

    emit(
      'Verify',
      'INFO',
      'Re-reading 1Password (cache bypassed) to confirm every generated field was actually saved.',
    );
    const updatedReadiness = await this.check({
      application,
      instanceName,
      customer,
      vault: selectedVault,
      clusterName,
      includePipelineRefs: true,
      forceRefresh: true,
    });

    const verifiedFields = generatableFindings
      .filter(finding => !skippedFields.has(finding.field))
      .map(finding => {
        const section =
          finding.section ?? this.runtimeSection(application, instanceName);
        const targetVault = finding.vault || vaultName;
        const targetItem = finding.item || customer;
        const confirmed = updatedReadiness.findings.find(
          candidate =>
            candidate.normalizedReference === finding.normalizedReference,
        );
        const verified = confirmed?.status === 'READY';
        emit(
          'Verify',
          verified ? 'SUCCESS' : 'WARNING',
          verified
            ? `Confirmed: '${finding.field}' now reads back as READY from 1Password vault '${targetVault}', item '${targetItem}', section '${section}'.`
            : `Wrote '${
                finding.field
              }' but the post-write read-back still reports '${
                confirmed?.status ?? 'ERROR'
              }' in section '${section}'. Review this field manually.`,
        );
        return {
          field: finding.field,
          section,
          vault: targetVault,
          item: targetItem,
          status: confirmed?.status ?? 'ERROR',
          verified,
        };
      });

    const remainingBlocked = [
      ...updatedReadiness.missing,
      ...updatedReadiness.placeholders,
    ];
    const onlyPipelineFieldsRemain =
      remainingBlocked.length > 0 &&
      remainingBlocked.every(finding => isPipelineControlField(finding.field));

    const completionMessage = updatedReadiness.ready
      ? '1Password sections were populated directly in CloudHub and readiness is now green.'
      : onlyPipelineFieldsRemain
      ? 'All generatable fields were populated. The remaining fields track the chart version/branch and will be set automatically when this app is deployed.'
      : 'Direct 1Password updates completed, but readiness still has blocked entries.';

    const now = new Date().toISOString();
    emit(
      'Complete',
      updatedReadiness.ready || onlyPipelineFieldsRemain
        ? 'SUCCESS'
        : 'WARNING',
      completionMessage,
    );

    return {
      operationId: crypto.randomUUID(),
      application,
      instanceName,
      customer,
      clusterName,
      workflowRepository: '1password-direct',
      workflowId: 'direct-write',
      workflowRef: 'service-account',
      workflowRunId: null,
      workflowRunUrl: null,
      status: 'completed',
      conclusion: 'success',
      message: completionMessage,
      sections,
      fieldsGenerated,
      requestedAt: now,
      updatedAt: now,
      completedAt: now,
      readiness: updatedReadiness,
      verifiedFields,
    };
  }

  async provision(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    applicationReleaseVersion?: string;
    actorRef: string;
    role: PersonaRole;
    entityResolutionChartVersion?: string;
    onProgress?: (event: ProvisionProgressEvent) => void;
  }): Promise<PortalSecretProvisionStatusView> {
    return this.provisionSecrets(input);
  }

  async bootstrapCustomerStructure(input: {
    customer: string;
    vault?: string;
  }): Promise<BootstrapCustomerStructureResult> {
    const customer = input.customer.trim();
    if (!customer) {
      throw new Error('customer is required for 1Password customer bootstrap.');
    }

    await this.ensureWriteAccess();

    const vault = this.resolveSelectedVault(input.vault);
    const sections = [
      `nr-${customer}-dev`,
      `nr-${customer}-qa`,
      `nr-${customer}-uat`,
      `nr-${customer}-prod`,
      this.pipelineRefSection(),
    ];

    const vaultId = await this.resolveVaultId(vault);
    for (const section of sections) {
      await this.upsertItemField({
        vaultId,
        itemTitleOrId: customer,
        section,
        field: 'bootstrap_marker',
        value: 'UPDATE_ME',
      });
    }

    return { vault, item: customer, sections };
  }

  async listCustomerCodesFromVaults(vaultNames: string[]): Promise<string[]> {
    const connection = await this.verifyOnePasswordConnection();
    if (!connection.ready) {
      throw new Error(connection.message);
    }

    const customerCodes = new Set<string>();

    for (const vaultName of vaultNames
      .map(vault => vault.trim())
      .filter(Boolean)) {
      const vaultId = await this.resolveVaultId(vaultName);
      const items = await this.listItems(vaultId);

      for (const item of items) {
        const title =
          typeof item === 'object' && item !== null && 'title' in item
            ? String((item as { title?: unknown }).title ?? '').trim()
            : '';
        if (!title) {
          continue;
        }

        const upper = title.toUpperCase();
        if (upper.startsWith('NR-') || upper.includes('TEMPLATE')) {
          continue;
        }

        customerCodes.add(title);
      }
    }

    return [...customerCodes].sort((left, right) => left.localeCompare(right));
  }

  private async ensureWriteAccess(): Promise<void> {
    if (!this || typeof this.verifyOnePasswordConnection !== 'function') {
      throw new Error(
        '1Password secret readiness service is not initialized or is missing its write-access check.',
      );
    }

    const connection = await this.verifyOnePasswordConnection();
    if (!connection.ready) {
      throw new Error(connection.message);
    }
  }

  private isRandomSecretField(field: string): boolean {
    const lowerField = field.toLowerCase();
    return (
      lowerField.includes('password') ||
      lowerField.includes('passwd') ||
      lowerField.includes('secret') ||
      lowerField.includes('token') ||
      lowerField.includes('api_key') ||
      lowerField.includes('apikey') ||
      lowerField.includes('client_secret') ||
      lowerField.includes('jwt') ||
      lowerField.includes('salt') ||
      lowerField.includes('credential') ||
      lowerField.includes('passphrase')
    );
  }

  private isTlsMaterialField(field: string): boolean {
    const lowerField = field.toLowerCase();
    return (
      lowerField.includes('__base64__') ||
      lowerField.includes('certificate') ||
      lowerField.includes('cert') ||
      lowerField.includes('crt') ||
      lowerField.includes('tls') ||
      lowerField.includes('pem') ||
      lowerField.includes('private_key') ||
      lowerField.includes('key')
    );
  }

  private isKeyLikeField(field: string): boolean {
    const lowerField = field.toLowerCase();
    return (
      lowerField.includes('private_key') ||
      (lowerField.includes('key') &&
        !lowerField.includes('certificate') &&
        !lowerField.includes('cert') &&
        !lowerField.includes('crt'))
    );
  }

  private generateSelfSignedDevTlsPair(commonName: string): {
    certBase64: string;
    keyBase64: string;
  } {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cloudhub-op-'));
    const keyPath = path.join(tempDir, 'tls.key');
    const certPath = path.join(tempDir, 'tls.crt');

    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          '365',
          '-nodes',
          '-subj',
          `/CN=${commonName}`,
        ],
        { stdio: 'pipe' },
      );

      const certPem = readFileSync(certPath, 'utf8');
      const keyPem = readFileSync(keyPath, 'utf8');

      return {
        certBase64: Buffer.from(certPem).toString('base64'),
        keyBase64: Buffer.from(keyPem).toString('base64'),
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private async generateProvisionValue(
    field: string,
    context?: {
      application?: string;
      applicationReleaseVersion?: string;
      instanceName?: string;
      customer?: string;
    },
  ): Promise<string | null> {
    const trimmed = field.trim();
    const lowerField = trimmed.toLowerCase();

    const synthesized = this.synthesizeCloudHubParameter(trimmed, context);
    if (synthesized !== null) {
      return synthesized;
    }

    if (isDockerConfigField(field)) {
      const config = dockerConfigJsonFromEnv();
      if (config && config !== '{}') {
        return isBase64Field(field)
          ? Buffer.from(config).toString('base64')
          : config;
      }

      const fallback = await autoResolveDockerConfigJsonFromTemplate(this);
      if (fallback && fallback !== '{}') {
        return isBase64Field(field)
          ? Buffer.from(fallback).toString('base64')
          : fallback;
      }

      return null;
    }

    if (this.isTlsMaterialField(field)) {
      const commonName =
        field.replace(/[_-]+/g, '.').replace(/\.+/g, '.') || 'poc.local';
      const material = this.generateSelfSignedDevTlsPair(commonName);
      return this.isKeyLikeField(field)
        ? material.keyBase64
        : material.certBase64;
    }

    if (this.isRandomSecretField(field)) {
      return crypto
        .randomBytes(48)
        .toString('base64')
        .replace(/[\r\n]+/g, '')
        .slice(0, 64);
    }

    // Auto-populate pipeline reference fields from Release Catalog
    if (
      isPipelineRefField(field) &&
      context?.application &&
      context?.applicationReleaseVersion
    ) {
      const namespace = extractNamespaceFromField(field);
      if (namespace) {
        const release = resolveReleasePointers(
          context.application,
          context.applicationReleaseVersion,
        );

        if (
          lowerField.endsWith('__helm_chart_version') ||
          lowerField.endsWith('_chart_version')
        ) {
          // When provisioning was invoked with an explicit application release
          // version, prefer that literal value for the helm chart version so
          // provisioning seeds pipeline refs with the requested release. For
          // 'latest' or when no explicit value is provided, fall back to the
          // catalog-resolved chart version.
          const requested = context.applicationReleaseVersion?.trim();
          if (requested && requested.toLowerCase() !== 'latest') {
            return requested;
          }
          return release.helmChartVersion;
        }

        if (
          lowerField.endsWith('__helm_chart_values_file_ref') ||
          lowerField.endsWith('_values_file_ref')
        ) {
          return release.valuesFileCommitSha;
        }

        if (
          lowerField.endsWith('__project_overlay_files_ref') ||
          lowerField.endsWith('_overlay_files_ref')
        ) {
          return release.defaultOverlayRef;
        }

        if (
          lowerField.endsWith('__entity_resolution_chart_version') ||
          lowerField.endsWith('_entity_resolution_chart_version')
        ) {
          return (
            release.subComponents.entity_resolution_chart_version ||
            release.helmChartVersion
          );
        }
      }
    }

    // Fallback for non-catalog fields
    if (
      lowerField.endsWith('_chart_version') ||
      lowerField.endsWith('chart_version')
    ) {
      return 'latest';
    }

    if (lowerField.endsWith('__version') || lowerField.endsWith('version')) {
      return 'main';
    }

    if (lowerField.endsWith('__branch') || lowerField.endsWith('branch')) {
      return 'main';
    }

    if (lowerField.endsWith('__ref') || lowerField.endsWith('ref')) {
      return 'main';
    }

    return 'set-by-cloudhub-provisioner';
  }

  private synthesizeCloudHubParameter(
    field: string,
    context?: {
      application?: string;
      instanceName?: string;
      customer?: string;
    },
  ): string | null {
    const normalized = field.trim();
    if (!AUTOMATIC_UPDATE_ME_FIELDS.has(normalized.toUpperCase())) {
      return null;
    }

    const instanceName = (context?.instanceName ?? '').trim();
    const application = (context?.application ?? '').trim();

    if (normalized.toUpperCase() === 'UPDATE_ME_NAMESPACE') {
      if (application && instanceName) {
        return instanceName.startsWith(`${application}-`)
          ? instanceName
          : `${application}-${instanceName}`;
      }
      return 'cloudhub';
    }

    if (normalized.toUpperCase() === 'UPDATE_ME_NC_SUFFIX') {
      const rawBase = instanceName
        .replace(new RegExp(`^${escapeRegExp(application || '')}-?`, 'i'), '')
        .replace(/^[-_]+|[-_]+$/g, '')
        .trim();

      const startsWithApplicationPrefix = instanceName
        .toLowerCase()
        .startsWith(`${(application || '').toLowerCase()}-`);

      const tokens = rawBase.split(/[-_]+/).filter(Boolean);
      const appAlias = new Set(['nr', 'ih', 'dt', 'dxv', 'app', 'apps']);

      const suffix = startsWithApplicationPrefix
        ? rawBase
        : tokens.length > 2 && appAlias.has(tokens[0]?.toLowerCase())
        ? tokens.slice(1).join('-')
        : rawBase;

      return suffix || 'dev';
    }

    if (normalized.toUpperCase() === 'UPDATE_ME_CLIENT_SUBDOMAIN') {
      const customer = (context as { customer?: string } | undefined)?.customer;
      if (customer && customer.trim()) {
        return customer.trim();
      }
      if (instanceName) {
        const match = instanceName.match(
          /(?:^|[-_])(sri|acme|demo|customer|test)(?:[-_]|$)/i,
        );
        return match?.[1]?.toLowerCase() ?? 'customer';
      }
      return 'customer';
    }

    if (normalized.toUpperCase() === 'UPDATE_ME_CLIENT_FACING') {
      return 'true';
    }

    if (normalized.toUpperCase() === 'UPDATE_ME_ENV_TYPE') {
      const env = instanceName.split(/[-_]/).pop()?.toLowerCase();
      return env &&
        ['dev', 'qa', 'uat', 'prod', 'sandbox', 'test'].includes(env)
        ? env
        : 'dev';
    }

    if (normalized.toUpperCase() === 'UPDATE_ME_OWNERS') {
      return 'cloudhub-platform,cloudhub-ops';
    }

    return null;
  }

  private toReference(input: {
    vault: string;
    item: string;
    section: string | null;
    field: string;
  }): string {
    return `op://${input.vault}/${input.item}/${
      input.section ? `${input.section}/` : ''
    }${input.field}`;
  }

  private async verifyOnePasswordConnection(
    selectedVault?: string,
  ): Promise<OnePasswordConnectionStatus> {
    if (!this.isConfigured()) {
      return {
        ready: false,
        message:
          '1Password service-account token is not configured (OP_SERVICE_ACCOUNT_TOKEN). Check configuration or bypass validation for dry-run.',
      };
    }
    try {
      const client = await this.getClient();
      const vaults = await this.listVaults();
      if (vaults.length === 0) {
        return {
          ready: false,
          message: '1Password SDK authenticated, but no vaults are visible.',
        };
      }

      const requiredVaults = selectedVault
        ? [this.resolveSelectedVault(selectedVault)]
        : [];
      for (const vault of requiredVaults) {
        await this.resolveVaultId(vault);
      }

      void client;
      return {
        ready: true,
        message:
          requiredVaults.length > 0
            ? `Validated 1Password service-account authentication and vault visibility for vault '${requiredVaults[0]}' via SDK.`
            : 'Validated 1Password service-account authentication and vault visibility via SDK.',
      };
    } catch (error) {
      const message = `1Password authentication check failed via SDK: ${toMessage(
        error,
      )}`;
      this.logger.warn(`[deployment-control-plane] ${message}`);
      return { ready: false, message };
    }
  }

  private defaultLocalReader: OptionalTextReader = async absolutePath => {
    try {
      return await readFile(absolutePath, 'utf8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  };

  private cacheSeconds(): number {
    const raw = Number(
      process.env.CLOUDHUB_1PASSWORD_CACHE_SECONDS ?? DEFAULT_CACHE_SECONDS,
    );
    if (!Number.isFinite(raw) || raw <= 0) {
      return DEFAULT_CACHE_SECONDS;
    }
    return Math.max(60, Math.min(3600, Math.floor(raw)));
  }

  private cacheKey(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault: string;
    clusterName?: string;
    includePipelineRefs: boolean;
  }): string {
    return [
      input.application,
      input.instanceName,
      input.customer,
      input.vault,
      input.clusterName ?? '',
      input.includePipelineRefs ? 'pipeline-refs:on' : 'pipeline-refs:off',
    ].join('|');
  }

  private async loadCandidateFiles(
    application: string,
    instanceName: string,
  ): Promise<SourceFile[]> {
    const candidatePaths = [
      `apps/${application}/${instanceName}/overrides.gotmpl`,
      `apps/${application}/${instanceName}/namespace.overrides.gotmpl`,
      `apps/${application}/${instanceName}/helmfile.yaml`,
      `apps/${application}/overrides.gotmpl`,
      `apps/${application}/namespace.overrides.gotmpl`,
      `apps/${application}/helmfile.yaml`,
      `scp/apps/${application}/${instanceName}/overrides.gotmpl`,
      `scp/apps/${application}/${instanceName}/namespace.overrides.gotmpl`,
      `scp/apps/${application}/${instanceName}/helmfile.yaml`,
      `scp/apps/${application}/overrides.gotmpl`,
      `scp/apps/${application}/namespace.overrides.gotmpl`,
      `scp/apps/${application}/helmfile.yaml`,
    ];

    const loaded: SourceFile[] = [];
    for (const candidate of candidatePaths) {
      const localPath = path.resolve(process.cwd(), candidate);
      const localContent = await this.readLocalTextFile(localPath);
      if (localContent !== null) {
        loaded.push({ path: candidate, content: localContent });
        continue;
      }

      try {
        const remoteContent = await this.catalog.readTextIfExists(candidate);
        if (remoteContent !== null) {
          loaded.push({ path: candidate, content: remoteContent });
        }
      } catch (error) {
        this.logger.debug(
          `[deployment-control-plane] skipped optional scripts file ${candidate}: ${toMessage(
            error,
          )}`,
        );
      }
    }

    return loaded;
  }

  private extractReferences(
    files: SourceFile[],
    options: {
      application: string;
      instanceName: string;
      customer: string;
      vault: string;
      includePipelineRefs: boolean;
    },
  ): ReferenceMap {
    const refs: ReferenceMap = new Map();

    for (const file of files) {
      const lines = file.content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (isCommentOnlyLine(line)) {
          return;
        }

        const source: PortalSecretRefSource = {
          path: file.path,
          line: index + 1,
        };

        const matches = line.match(OP_REF_RE);
        if (matches) {
          for (const match of matches) {
            const parsed = parseOpReference(match);
            if (!parsed) continue;
            if (!options.includePipelineRefs && this.isPipelineRef(parsed)) {
              continue;
            }
            this.addReference(refs, parsed, source);
          }
        }

        if (!options.includePipelineRefs) {
          return;
        }

        for (const envKey of extractEnvVarRefs(line)) {
          const parsed = this.buildEnvReference({
            application: options.application,
            instanceName: options.instanceName,
            customer: options.customer,
            vault: options.vault,
            envKey,
          });
          this.addReference(refs, parsed, source);
        }

        for (const fetchRef of extractFetchSecretValueRefs(line)) {
          const parsed = this.buildFetchSecretValueReference({
            application: options.application,
            instanceName: options.instanceName,
            customer: options.customer,
            vault: options.vault,
            fetchRef,
          });
          if (!parsed) {
            continue;
          }
          if (!options.includePipelineRefs && this.isPipelineRef(parsed)) {
            continue;
          }
          this.addReference(refs, parsed, source);
        }
      });
    }

    return refs;
  }

  private async applyConventionFallbackReferences(input: {
    refs: ReferenceMap;
    application: string;
    instanceName: string;
    customer: string;
    vault: string;
    opReady: boolean;
  }): Promise<string | null> {
    if (input.refs.size > 0) {
      return null;
    }

    const section = this.resolveConventionSection(
      input.application,
      input.instanceName,
      input.customer,
    );
    if (!section) {
      return null;
    }

    const vault = this.resolveSelectedVault(input.vault);
    if (!input.opReady) {
      return `No inline op:// or ref+op:// references were found; CloudHub would validate convention section '${section}' in vault '${vault}', but 1Password authentication is not ready.`;
    }

    try {
      const vaultId = await this.resolveVaultId(vault);
      const item = await this.getItemByTitleOrId(vaultId, input.customer);
      if (!item) {
        return `No inline op:// or ref+op:// references were found; fallback convention item '${input.customer}' is missing in vault '${vault}'.`;
      }

      const fields = Array.isArray(item.fields) ? item.fields : [];
      const sectionFields: string[] = Array.from(
        new Set<string>(
          fields
            .filter((field: any) => fieldInSection(item, field, section))
            .map((field: any) => String(field.title ?? field.id ?? '').trim())
            .filter(Boolean),
        ),
      );

      for (const field of sectionFields) {
        const parsed: ParsedReference = {
          normalizedReference: `op://${encodeSegment(vault)}/${encodeSegment(
            input.customer,
          )}/${encodeSegment(section)}/${encodeSegment(field)}`,
          vault,
          item: input.customer,
          section,
          field,
        };
        this.addReference(input.refs, parsed, {
          path: `convention://${input.application}`,
          line: 1,
        });
      }

      if (sectionFields.length === 0) {
        return `No inline op:// or ref+op:// references were found; fallback section '${section}' exists by convention but no fields were discovered for validation.`;
      }

      return `No inline op:// or ref+op:// references were found; validated ${sectionFields.length} convention-based secret reference(s) from section '${section}' in vault '${vault}'.`;
    } catch (error) {
      return `No inline op:// or ref+op:// references were found; convention fallback '${section}' could not be resolved: ${toMessage(
        error,
      )}`;
    }
  }

  private resolveConventionSection(
    application: string,
    instanceName: string,
    customer: string,
  ): string | null {
    if (!this.usesConventionFallback(application)) {
      return null;
    }

    const environment = this.extractEnvironment(instanceName);
    if (!environment) {
      return null;
    }

    return `nr-${customer}-${environment}`;
  }

  private usesConventionFallback(application: string): boolean {
    const normalized = normalizeName(application);
    if (CONVENTION_FALLBACK_APPS.has(normalized)) {
      return true;
    }
    return normalized.includes('netreveal');
  }

  private extractEnvironment(instanceName: string): string | null {
    const tokens = normalizeName(instanceName)
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (CONVENTION_ENVIRONMENTS.has(tokens[index])) {
        return tokens[index];
      }
    }

    return null;
  }

  private addReference(
    refs: Map<
      string,
      { parsed: ParsedReference; sources: PortalSecretRefSource[] }
    >,
    parsed: ParsedReference,
    source: PortalSecretRefSource,
  ): void {
    const existing = refs.get(parsed.normalizedReference);
    if (existing) {
      existing.sources.push(source);
      return;
    }

    refs.set(parsed.normalizedReference, {
      parsed,
      sources: [source],
    });
  }

  private buildEnvReference(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault: string;
    envKey: string;
  }): ParsedReference {
    const vault = this.resolveSelectedVault(input.vault);
    const section = this.resolveSectionForEnvRef(
      input.application,
      input.instanceName,
      input.envKey,
    );
    const field = this.resolveFieldForEnvRef(
      input.application,
      input.instanceName,
      input.envKey,
    );

    return {
      normalizedReference: `op://${encodeSegment(vault)}/${encodeSegment(
        input.customer,
      )}/${encodeSegment(section)}/${encodeSegment(field)}`,
      vault,
      item: input.customer,
      section,
      field,
    };
  }

  private buildFetchSecretValueReference(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault: string;
    fetchRef: string;
  }): ParsedReference | null {
    const raw = input.fetchRef.trim();
    if (!raw) {
      return null;
    }

    const direct = parseOpReference(raw);
    if (direct) {
      return direct;
    }

    if (SECRET_ENV_KEY_RE.test(raw)) {
      return this.buildEnvReference({
        application: input.application,
        instanceName: input.instanceName,
        customer: input.customer,
        vault: input.vault,
        envKey: raw,
      });
    }

    const normalizedField = normalizeFetchSecretToken(raw);
    if (!normalizedField) {
      return null;
    }

    const namespace = this.deploymentNamespace(
      input.application,
      input.instanceName,
    );
    const section = isPipelineControlField(normalizedField)
      ? this.pipelineRefSection()
      : this.runtimeSection(input.application, input.instanceName);
    const field = isPipelineControlField(normalizedField)
      ? `${namespace}__${normalizedField}`
      : normalizedField;
    const vault = this.resolveSelectedVault(input.vault);

    return {
      normalizedReference: `op://${encodeSegment(vault)}/${encodeSegment(
        input.customer,
      )}/${encodeSegment(section)}/${encodeSegment(field)}`,
      vault,
      item: input.customer,
      section,
      field,
    };
  }

  private pipelineRefVault(): string {
    return (
      process.env.OP_VAULT_NAME ??
      process.env.CLOUDHUB_1PASSWORD_VAULT ??
      'Customers'
    ).trim();
  }

  private resolveSelectedVault(vault?: string): string {
    const trimmed = vault?.trim();
    if (trimmed) {
      return trimmed;
    }
    return this.pipelineRefVault();
  }

  private pipelineRefSection(): string {
    return (
      process.env.CLOUDHUB_1PASSWORD_PIPELINE_SECTION ?? 'pipeline_refs'
    ).trim();
  }

  private isPipelineRef(parsed: ParsedReference): boolean {
    return (
      normalizeName(parsed.section ?? '') ===
      normalizeName(this.pipelineRefSection())
    );
  }

  private runtimeSection(application: string, instanceName: string): string {
    return this.deploymentNamespace(application, instanceName);
  }

  private deploymentNamespace(
    application: string,
    instanceName: string,
  ): string {
    return instanceName.startsWith(`${application}-`)
      ? instanceName
      : `${application}-${instanceName}`;
  }

  private resolveSectionForEnvRef(
    application: string,
    instanceName: string,
    envKey: string,
  ): string {
    const field = this.resolveFieldForEnvRef(application, instanceName, envKey);
    if (isPipelineControlField(field)) {
      return this.pipelineRefSection();
    }
    return this.runtimeSection(application, instanceName);
  }

  private resolveFieldForEnvRef(
    application: string,
    instanceName: string,
    envKey: string,
  ): string {
    const raw = envKey.trim().replace(/^CLOUDHUB_/i, '');
    const normalizedPrefix = raw.replace(/^ENV_/i, '');
    const namespace = this.deploymentNamespace(application, instanceName);
    const namespaceToken = namespace.replace(/-/g, '_').toLowerCase();
    let normalized = normalizedPrefix.toLowerCase();

    normalized = normalized
      .replace(/^update_me_namespace__/, '')
      .replace(/^_?update___/, '');

    if (normalized.startsWith(`${namespaceToken}__`)) {
      normalized = normalized.slice(namespaceToken.length + 2);
    }

    if (isPipelineControlField(normalized)) {
      return `${namespace}__${normalized}`;
    }

    return normalized;
  }

  private extractFilePlaceholders(
    files: SourceFile[],
  ): PortalFilePlaceholderFinding[] {
    const findings: PortalFilePlaceholderFinding[] = [];

    for (const file of files) {
      const lines = file.content.split(/\r?\n/);
      lines.forEach((line, index) => {
        const matches = line.match(UPDATE_ME_RE);
        if (!matches) return;
        for (const token of matches) {
          if (AUTOMATIC_UPDATE_ME_FIELDS.has(token.toUpperCase())) {
            continue;
          }
          findings.push({ path: file.path, line: index + 1, token });
        }
      });
    }

    return findings;
  }

  private async checkReference(
    parsed: ParsedReference,
    sources: PortalSecretRefSource[],
    opReady: boolean,
    visited: Set<string> = new Set(),
  ): Promise<PortalSecretRefFinding> {
    if (visited.has(parsed.normalizedReference)) {
      return {
        reference: parsed.normalizedReference,
        normalizedReference: parsed.normalizedReference,
        vault: parsed.vault,
        item: parsed.item,
        section: parsed.section,
        field: parsed.field,
        status: 'ERROR',
        message: `Detected circular 1Password reference chain at ${parsed.normalizedReference}.`,
        sources,
      };
    }

    const nextVisited = new Set(visited);
    nextVisited.add(parsed.normalizedReference);

    if (!opReady) {
      return {
        reference: parsed.normalizedReference,
        normalizedReference: parsed.normalizedReference,
        vault: parsed.vault,
        item: parsed.item,
        section: parsed.section,
        field: parsed.field,
        status: 'ERROR',
        message:
          '1Password CLI is not available or not authenticated; unable to verify this reference.',
        sources,
      };
    }

    try {
      const vaultId = await this.resolveVaultId(parsed.vault);
      const item = await this.getItemByTitleOrId(vaultId, parsed.item);
      if (!item) {
        return {
          reference: parsed.normalizedReference,
          normalizedReference: parsed.normalizedReference,
          vault: parsed.vault,
          item: parsed.item,
          section: parsed.section,
          field: parsed.field,
          status: 'MISSING',
          message: `Item '${parsed.item}' is missing in vault '${parsed.vault}'.`,
          sources,
        };
      }

      const fields = Array.isArray(item.fields) ? item.fields : [];
      const matchedField = fields.find((field: any) => {
        const candidateName = normalizeName(field.title ?? field.id ?? '');
        if (candidateName !== normalizeName(parsed.field)) {
          return false;
        }

        return !parsed.section || fieldInSection(item, field, parsed.section);
      });

      if (!matchedField) {
        return {
          reference: parsed.normalizedReference,
          normalizedReference: parsed.normalizedReference,
          vault: parsed.vault,
          item: parsed.item,
          section: parsed.section,
          field: parsed.field,
          status: 'MISSING',
          message: `Field '${parsed.field}' is missing${
            parsed.section ? ` in section '${parsed.section}'` : ''
          } for item '${parsed.item}'.`,
          sources,
        };
      }

      const value = String(matchedField.value ?? '').trim();

      if (isBase64Field(parsed.field) && /[\r\n]/.test(value)) {
        return {
          reference: parsed.normalizedReference,
          normalizedReference: parsed.normalizedReference,
          vault: parsed.vault,
          item: parsed.item,
          section: parsed.section,
          field: parsed.field,
          status: 'ERROR',
          message:
            'Base64 secret values must be single-line strings without embedded line breaks.',
          sources,
        };
      }

      if (!value) {
        return {
          reference: parsed.normalizedReference,
          normalizedReference: parsed.normalizedReference,
          vault: parsed.vault,
          item: parsed.item,
          section: parsed.section,
          field: parsed.field,
          status: 'EMPTY',
          message: 'Field exists in 1Password but is empty.',
          sources,
        };
      }

      if (isPlaceholderValue(value)) {
        return {
          reference: parsed.normalizedReference,
          normalizedReference: parsed.normalizedReference,
          vault: parsed.vault,
          item: parsed.item,
          section: parsed.section,
          field: parsed.field,
          status: 'PLACEHOLDER',
          message: `Field value is still a placeholder (${value}).`,
          sources,
        };
      }

      const chained = parseOpReference(value);
      if (chained) {
        const chainedFinding = await this.checkReference(
          chained,
          sources,
          opReady,
          nextVisited,
        );
        if (chainedFinding.status !== 'READY') {
          const prefix = this.isPipelineRef(parsed)
            ? 'Pipeline reference'
            : 'Reference';
          return {
            reference: parsed.normalizedReference,
            normalizedReference: parsed.normalizedReference,
            vault: parsed.vault,
            item: parsed.item,
            section: parsed.section,
            field: parsed.field,
            status: chainedFinding.status,
            message: `${prefix} points to ${chained.normalizedReference}, which is not ready: ${chainedFinding.message}`,
            sources,
          };
        }

        if (this.isPipelineRef(parsed)) {
          return {
            reference: parsed.normalizedReference,
            normalizedReference: parsed.normalizedReference,
            vault: parsed.vault,
            item: parsed.item,
            section: parsed.section,
            field: parsed.field,
            status: 'READY',
            message: `Pipeline reference resolves through ${chained.normalizedReference} and is populated.`,
            sources,
          };
        }

        return {
          reference: parsed.normalizedReference,
          normalizedReference: parsed.normalizedReference,
          vault: parsed.vault,
          item: parsed.item,
          section: parsed.section,
          field: parsed.field,
          status: 'READY',
          message: `Reference resolves through ${chained.normalizedReference} and is populated.`,
          sources,
        };
      }

      return {
        reference: parsed.normalizedReference,
        normalizedReference: parsed.normalizedReference,
        vault: parsed.vault,
        item: parsed.item,
        section: parsed.section,
        field: parsed.field,
        status: 'READY',
        message: 'Reference resolved successfully and value is populated.',
        sources,
      };
    } catch (error) {
      return {
        reference: parsed.normalizedReference,
        normalizedReference: parsed.normalizedReference,
        vault: parsed.vault,
        item: parsed.item,
        section: parsed.section,
        field: parsed.field,
        status: 'MISSING',
        message: `Reference missing or unreadable in 1Password: ${toMessage(
          error,
        )}`,
        sources,
      };
    }
  }

  private summary(input: {
    ready: boolean;
    referencesDiscovered: number;
    missingCount: number;
    placeholderCount: number;
    filePlaceholderCount: number;
    requireReferences: boolean;
    opReady: boolean;
    connectionMessage: string;
    warnings: string[];
  }): string {
    if (!input.opReady) {
      return input.connectionMessage;
    }
    if (input.referencesDiscovered === 0 && input.requireReferences) {
      const fallbackWarning = input.warnings.find(message =>
        /convention/i.test(message),
      );
      if (fallbackWarning) {
        return fallbackWarning;
      }
      return 'No op://, ref+op://, or env "CLOUDHUB_*"/"ENV_*" references were found, so secret readiness cannot be proven for this instance.';
    }
    if (input.missingCount > 0) {
      return `${input.missingCount} secret reference(s) are missing from 1Password.`;
    }
    if (input.placeholderCount > 0 || input.filePlaceholderCount > 0) {
      return `${
        input.placeholderCount + input.filePlaceholderCount
      } placeholder secret value(s) must be populated before deploy.`;
    }
    if (input.warnings.length > 0) {
      return input.warnings.join(' ');
    }
    return `Ready. ${input.referencesDiscovered} secret reference(s) verified in 1Password.`;
  }
}

function parseOpReference(rawValue: string): ParsedReference | null {
  const normalizedReference = rawValue.replace(/^ref\+/i, '');
  if (!normalizedReference.toLowerCase().startsWith('op://')) {
    return null;
  }

  const pathValue = normalizedReference.slice('op://'.length);
  const segments = pathValue
    .split('/')
    .map(segment => decodeSafe(segment.trim()))
    .filter(Boolean);

  if (segments.length < 3) {
    return null;
  }

  const vault = segments[0];
  const item = segments[1];
  const field = segments[segments.length - 1];
  const section = segments.length > 3 ? segments.slice(2, -1).join('/') : null;

  return {
    normalizedReference,
    vault,
    item,
    section,
    field,
  };
}

function extractEnvVarRefs(line: string): string[] {
  const refs = new Set<string>();
  for (const match of line.matchAll(ENV_REF_RE)) {
    const key = match[1]?.trim();
    if (key) {
      refs.add(key);
    }
  }
  return [...refs];
}

function extractFetchSecretValueRefs(line: string): string[] {
  const refs = new Set<string>();
  for (const match of line.matchAll(FETCH_SECRET_VALUE_RE)) {
    const value = match[1]?.trim();
    if (value) {
      refs.add(value);
    }
  }
  return [...refs];
}

function isCommentOnlyLine(line: string): boolean {
  return line.trimStart().startsWith('#');
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isPlaceholderValue(value: string): boolean {
  return /^update_me(?:$|[_-].*)/i.test(value.trim());
}

function isBase64Field(field: string): boolean {
  return BASE64_FIELD_RE.test(field.trim());
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function isDockerConfigField(field: string): boolean {
  const lower = field.toLowerCase();
  return (
    lower.includes('dockerconfigjson') ||
    lower.includes('regcred') ||
    lower.includes('image_pull_secret')
  );
}

function isExternalSecretsManagedFile(content: string): boolean {
  const normalized = content.toLowerCase();
  return (
    normalized.includes('provider: external-secrets') ||
    normalized.includes('external-secrets store') ||
    normalized.includes('store: azure-key-vault')
  );
}

function dockerConfigJsonFromEnv(): string | null {
  const explicit = process.env.DEFAULT_DOCKERCONFIGJSON_PAYLOAD?.trim();
  if (explicit && explicit.startsWith('{')) {
    return explicit;
  }

  const registry =
    process.env.CLOUDHUB_ACR_REGISTRY?.trim() ||
    process.env.ACR_REGISTRY_SERVER?.trim() ||
    'sensaprodacr.azurecr.io';
  const username = process.env.ACR_USERNAME?.trim();
  const password = process.env.ACR_PASSWORD?.trim();
  if (!username || !password) {
    return null;
  }
  return JSON.stringify({
    auths: {
      [registry]: {
        username,
        password,
        auth: Buffer.from(`${username}:${password}`).toString('base64'),
      },
    },
  });
}

async function autoResolveDockerConfigJsonFromTemplate(
  service: OnePasswordSecretReadinessService,
): Promise<string | null> {
  const fallbackCustomers = ['sri', '_template', 'template', 'default'];

  for (const customerName of fallbackCustomers) {
    try {
      const vaultId = await service.resolveVaultId('Customers');
      const item = await service.getItemByTitleOrId(vaultId, customerName);
      if (!item) {
        continue;
      }

      const field = item.fields?.find((candidate: any) => {
        const label = String(candidate?.label ?? candidate?.title ?? '').trim();
        const fieldName = (candidate?.name ?? label).toLowerCase();
        const rawValue = candidate?.value ?? candidate?.stringValue ?? null;
        const value =
          rawValue === null || rawValue === undefined
            ? ''
            : typeof rawValue === 'string'
            ? rawValue
            : JSON.stringify(rawValue);
        return (
          (fieldName.includes('dockerconfigjson') ||
            label.includes('dockerconfigjson') ||
            label.includes('regcred_acr__dockerconfigjson')) &&
          typeof value === 'string' &&
          value.trim().startsWith('{')
        );
      });

      if (field) {
        const rawValue = field.value ?? field.stringValue ?? null;
        const value =
          rawValue === null || rawValue === undefined
            ? ''
            : typeof rawValue === 'string'
            ? rawValue
            : JSON.stringify(rawValue);
        if (typeof value === 'string' && value.trim().startsWith('{')) {
          return value.trim();
        }
      }
    } catch {
      // Continue searching other fallback customer names.
    }
  }

  return null;
}

function fieldSectionRef(field: any): string {
  return String(
    field?.sectionId ?? field?.section?.id ?? field?.section?.title ?? '',
  );
}

// SDK fields carry only the section's opaque id; op:// references and
// CloudHub callers name sections by title, so resolve the id through
// item.sections before comparing.
function fieldInSection(
  item: any,
  field: any,
  section: string | null,
): boolean {
  const ref = fieldSectionRef(field);
  if (!section) {
    return !ref;
  }
  const wanted = normalizeName(section);
  if (normalizeName(ref) === wanted) {
    return true;
  }
  const owning = (Array.isArray(item?.sections) ? item.sections : []).find(
    (entry: any) => entry?.id === ref,
  );
  return Boolean(
    owning &&
      normalizeName(String(owning.title ?? owning.label ?? '')) === wanted,
  );
}

function normalizeFetchSecretToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^cloudhub_/, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isPipelineControlField(field: string): boolean {
  // Namespace-prefixed fields use a double-underscore separator, e.g.
  // "netreveal-nr-sri-dev__helm_chart_version". Strip the namespace prefix
  // before checking so that "helm_chart_version" is still recognised as a
  // pipeline control field regardless of prefix.
  const normalized = normalizeName(field);
  if (PIPELINE_CONTROL_FIELDS.has(normalized)) {
    return true;
  }
  // Strip everything up to and including the last __ separator
  const doubleSepIdx = normalized.lastIndexOf('__');
  if (doubleSepIdx !== -1) {
    const bareField = normalized.slice(doubleSepIdx + 2);
    return PIPELINE_CONTROL_FIELDS.has(bareField);
  }
  return false;
}
