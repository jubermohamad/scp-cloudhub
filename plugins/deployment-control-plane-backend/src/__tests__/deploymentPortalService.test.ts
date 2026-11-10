import {
  DeploymentPortalService,
  PortalDeploymentError,
  type DeploymentPortalDeps,
} from '../services/deploymentPortalService';
import type { GitHubActionsService } from '../services/githubActionsService';
import type { CreatePortalDeploymentInput } from '../types';

const SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000';
const CLUSTER = {
  clusterName: 'aks-scp-dev-sdc-st-cms',
  region: 'eastus',
  resourceGroup: 'rg-scp-dev',
  kubernetesVersion: '1.29.0',
  nodePools: 2,
  environment: 'dev',
  status: 'Succeeded',
  subscriptionId: SUBSCRIPTION_ID,
  tags: {},
};

function baseInput(
  overrides: Partial<CreatePortalDeploymentInput> = {},
): CreatePortalDeploymentInput {
  return {
    application: 'detectionhub',
    instanceName: 'dt-absa-dev',
    customer: 'sri',
    environment: 'dev',
    clusterName: CLUSTER.clusterName,
    subscriptionId: SUBSCRIPTION_ID,
    resourceGroup: CLUSTER.resourceGroup,
    chartVersion: '',
    onePasswordVault: 'Customers',
    aiStoreIntegration: false,
    actorRef: 'user:default/requester',
    role: 'platform-admin',
    ...overrides,
  };
}

function buildService(
  opts: { customers?: string[]; clusters?: (typeof CLUSTER)[] } = {},
) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as any;
  const dispatch = jest.fn().mockResolvedValue({
    mode: 'github-api',
    repository: 'SymphonyFS/scripts',
    workflowId: 'deploy-with-dynamic-runners.yml',
    ref: 'main',
    runId: '42',
    status: 'queued',
    conclusion: null,
    htmlUrl: 'https://github.com/SymphonyFS/scripts/actions/runs/42',
  });
  const runStatus = jest.fn();
  const runLogs = jest.fn().mockResolvedValue({
    mode: 'github-api',
    runId: '42',
    lines: [],
    jobLines: [],
  });
  const findWorkflowRun = jest.fn();
  const audit = jest.fn().mockResolvedValue(undefined);
  const readinessReport = {
    ready: true,
    checkedAt: new Date().toISOString(),
    cached: false,
    cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
    application: 'detectionhub',
    instanceName: 'dt-absa-dev',
    includePipelineRefs: true,
    filesScanned: ['apps/detectionhub/dt-absa-dev/overrides.gotmpl'],
    referencesDiscovered: 1,
    findings: [],
    missing: [],
    placeholders: [],
    filePlaceholders: [],
    summary: 'Ready',
  };
  const secretReadinessCheck = jest.fn().mockResolvedValue(readinessReport);
  const secretProvision = jest.fn().mockImplementation(async input => ({
    operationId: 'op-1',
    application: input.application,
    instanceName: input.instanceName,
    customer: input.customer,
    clusterName: input.clusterName,
    workflowRepository: '1password-direct',
    workflowId: 'direct-write',
    workflowRef: 'service-account',
    workflowRunId: null,
    workflowRunUrl: null,
    status: 'completed',
    conclusion: 'success',
    message:
      '1Password sections were populated directly in CloudHub and readiness is now green.',
    sections: ['detectionhub-dt-absa-dev'],
    fieldsGenerated: ['db_password'],
    requestedAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    completedAt: '2026-09-15T00:00:00.000Z',
    readiness: readinessReport,
  }));
  const updateSecretFieldValue = jest.fn().mockImplementation(async input => ({
    success: true,
    reference: `op://${input.vault}/${input.item}/${
      input.section ? `${input.section}/` : ''
    }${input.field}`,
    message: 'Field value updated directly in 1Password.',
    readiness: readinessReport,
  }));
  const syncPipelineRefs = jest.fn().mockResolvedValue(undefined);
  const verifyAppInstanceExists = jest.fn().mockResolvedValue(true);
  const readRepositoryFile = jest
    .fn()
    .mockResolvedValue('helmDefaults:\n  kubeContext: uk-eng-dev\n');
  const ingress = {
    isConfigured: jest.fn().mockReturnValue(true),
    ensureARecord: jest.fn().mockImplementation(async input => ({
      status: 'CREATED',
      fqdn: input.target.fqdn,
      ip: '51.12.84.190',
      propagated: true,
      message: `DNS A record ${input.target.fqdn} created and resolving.`,
    })),
    probeHealth: jest.fn().mockImplementation(async target => ({
      healthy: true,
      url: target.url,
      healthyPath: '/health',
      attempts: [{ path: '/health', statusCode: 200, error: null }],
      checkedAt: new Date().toISOString(),
    })),
  };
  const applications = [
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
  const catalog = {
    listApplications: jest.fn().mockResolvedValue(
      applications.map(appName => ({
        id: appName,
        appName,
        displayName: appName,
        description: appName,
        chartVersions: [],
        supportsAiStoreIntegration: false,
      })),
    ),
    listInstances: jest.fn().mockResolvedValue([
      {
        appName: 'detectionhub',
        appInstance: 'dt-absa-dev',
        helmfilePath: 'apps/detectionhub/dt-absa-dev/helmfile.yaml',
        metadata: { namespace: 'dt-absa-dev', envType: 'dev' },
      },
    ]),
  };
  const discoverClusters = jest
    .fn()
    .mockResolvedValue(opts.clusters ?? [CLUSTER]);
  const listCustomerCodes = jest
    .fn()
    .mockResolvedValue(opts.customers ?? ['sri']);
  const listCustomerCatalog = jest.fn().mockResolvedValue({
    vaults: ['Customers'],
    customersByVault: {
      Customers: opts.customers ?? ['sri'],
    },
  });
  const deps: DeploymentPortalDeps = {
    logger,
    getPool: () => null,
    actions: {
      dispatch,
      runStatus,
      runLogs,
      findWorkflowRun,
      verifyAppInstanceExists,
      readRepositoryFile,
    } as unknown as GitHubActionsService,
    ingress: ingress as any,
    discoverClusters,
    listCustomerCodes,
    listCustomerCatalog,
    audit,
    catalog: catalog as any,
    secretReadiness: {
      check: secretReadinessCheck,
      provision: secretProvision,
      updateSecretFieldValue,
      syncPipelineRefs,
    },
  };
  return {
    service: new DeploymentPortalService(deps),
    dispatch,
    runStatus,
    runLogs,
    findWorkflowRun,
    audit,
    listCustomerCodes,
    listCustomerCatalog,
    secretReadinessCheck,
    secretProvision,
    updateSecretFieldValue,
    syncPipelineRefs,
    verifyAppInstanceExists,
    readRepositoryFile,
    ingress,
  };
}

describe('DeploymentPortalService unified scripts flow', () => {
  beforeEach(() => {
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY = 'SymphonyFS/scripts';
    process.env.CLOUDHUB_1PASSWORD_WORKFLOW_REPOSITORY =
      'jubermohamad/platform_cloudhub';
    delete process.env.SYMPHONYFS_1PASSWORD_WRITE_SECRET_NAME;
    delete process.env.CLOUDHUB_1PASSWORD_WRITE_SECRET_NAME;
  });

  afterEach(() => {
    delete process.env.SYMPHONYFS_1PASSWORD_WRITE_SECRET_NAME;
    delete process.env.CLOUDHUB_1PASSWORD_WORKFLOW_REPOSITORY;
    delete process.env.CLOUDHUB_1PASSWORD_WRITE_SECRET_NAME;
    delete process.env.GITHUB_ACTIONS_REPO;
    delete process.env.SRI_PIPELINE_REPO;
    delete process.env.GITHUB_REPOSITORY;
  });

  it('derives exactly the scripts application catalog', async () => {
    const { service } = buildService();
    const options = await service.getOptions();
    expect(options.applications).toHaveLength(18);
    expect(
      options.applications.find(app => app.appName === 'detectionhub')
        ?.chartVersions,
    ).toEqual([]);
  });

  it('creates a saved deployment without dispatching', async () => {
    const { service, dispatch } = buildService();
    const record = await service.create(baseInput());
    expect(record.status).toBe('PENDING');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('falls back to created_by when the legacy portal schema has no requested_by column', async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as any;

    const pool = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('information_schema.columns')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('control_plane_portal_deployments')) {
          return {
            rows: [
              {
                id: 'd-1',
                deploymentName: 'detectionhub-dt-absa-dev',
                application: 'detectionhub',
                instanceName: 'dt-absa-dev',
                customer: 'sri',
                environment: 'dev',
                cluster: CLUSTER.clusterName,
                subscriptionId: SUBSCRIPTION_ID,
                resourceGroup: CLUSTER.resourceGroup,
                chartVersion: '1.2.3',
                aiStoreIntegration: false,
                namespace: 'dt-absa-dev',
                helmfilePath: 'apps/detectionhub/dt-absa-dev/helmfile.yaml',
                helmfileContent: null,
                branch: 'main',
                commitSha: null,
                prUrl: null,
                workflowRunId: null,
                workflowRunUrl: null,
                status: 'PENDING',
                currentStep: 'Configuration saved',
                statusMessage: null,
                failureReason: null,
                approvedBy: null,
                approvedAt: null,
                mode: 'github-api',
                requestedBy: null,
                requestedAt: null,
                createdBy: 'user:default/requester',
                createdAt: '2026-09-15T00:00:00.000Z',
                updatedAt: '2026-09-15T00:00:00.000Z',
                startedAt: '2026-09-15T00:00:00.000Z',
                completedAt: null,
                workflowRepository: null,
                workflowId: null,
                workflowRef: null,
                workflowInputs: {},
                dispatchInitiatedAt: null,
                workflowRunAttempt: null,
                workflowStatus: null,
                workflowConclusion: null,
                correlationStatus: null,
                correlationMessage: null,
                correlationAttempts: 0,
                correlationDeadline: null,
                lastLogLine: 0,
                instanceStatus: 'NEW',
                instanceMode: 'auto',
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as any;

    const service = new DeploymentPortalService({
      logger,
      getPool: () => pool,
      actions: {
        dispatch: jest.fn(),
        runStatus: jest.fn(),
        runLogs: jest.fn(),
        findWorkflowRun: jest.fn(),
      } as any,
      discoverClusters: jest.fn().mockResolvedValue([CLUSTER]),
      listCustomerCodes: jest.fn().mockResolvedValue(['sri']),
      audit: jest.fn().mockResolvedValue(undefined),
      catalog: {
        listApplications: jest.fn().mockResolvedValue([]),
        listInstances: jest.fn().mockResolvedValue([]),
      } as any,
    });

    const records = await service.list();

    expect(records).toHaveLength(1);
    expect(records[0].requestedBy).toBe('user:default/requester');
    expect(
      pool.query.mock.calls.some(([sql]: [unknown]) =>
        String(sql).includes('created_by AS "requestedBy"'),
      ),
    ).toBe(true);
  });

  it('runs diff via the configured deployment workflow', async () => {
    const { service, dispatch } = buildService();
    const created = await service.create(
      baseInput({ instanceName: 'diff-ready' }),
    );

    const diff = await service.runDiff({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    expect(diff.status).toBe('queued');
    // The diff runs in its own workflow; dispatching the deploy workflow
    // would apply changes.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'github-actions-diff-manual.yml',
        inputs: {
          appName: 'detectionhub',
          appInstance: 'diff-ready',
          actionValidation: 'diff',
        },
      }),
    );

    const record = await service.get(created.id);
    expect(record?.status).toBe('PENDING');
  });

  it('updates diff status to completed success without mutating deployment lifecycle', async () => {
    const { service, runStatus, runLogs } = buildService();
    const created = await service.create(
      baseInput({ instanceName: 'diff-finish' }),
    );
    await service.runDiff({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    runStatus.mockResolvedValueOnce({
      mode: 'github-api',
      runId: '42',
      workflowId: 'deploy-with-dynamic-runners.yml',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/SymphonyFS/scripts/actions/runs/42',
      jobs: [],
    });
    runLogs.mockResolvedValueOnce({
      mode: 'github-api',
      runId: '42',
      lines: [],
      jobLines: [],
    });

    const diffStatus = await service.getDiffStatus(created.id);
    expect(diffStatus?.status).toBe('completed');
    expect(diffStatus?.conclusion).toBe('success');

    const record = await service.get(created.id);
    expect(record?.status).toBe('PENDING');
  });

  it('submits a saved deployment for approval', async () => {
    const { service, dispatch } = buildService();
    const created = await service.create(
      baseInput({ instanceName: 'juber98' }),
    );
    const submitted = await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });
    expect(submitted.status).toBe('PENDING_APPROVAL');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('persists the generated Helmfile content on the deployment record', async () => {
    const { service } = buildService();
    const record = await service.create(baseInput({ instanceName: 'juber99' }));
    expect(record.helmfileContent).toContain('Instance status:');
    expect(record.helmfileContent).toContain('SymphonyFS pipeline-internal');
    expect(record.helmfileContent).toContain(
      'value: detectionhub-sri-juber99.symphonyai.dev',
    );
  });

  it('approves the same deployment record and dispatches existing workflow inputs', async () => {
    const {
      service,
      dispatch,
      secretReadinessCheck,
      syncPipelineRefs,
      verifyAppInstanceExists,
    } = buildService();
    const created = await service.create(baseInput({ chartVersion: '2.0.14' }));
    await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });
    const approved = await service.approve({
      id: created.id,
      approverRef: 'user:default/approver',
      role: 'platform-admin',
    });
    expect(approved.id).toBe(created.id);
    expect(approved.status).toBe('QUEUED');
    expect(approved.decidedBy).toBe('user:default/approver');
    expect(approved.decidedAt).toEqual(expect.any(String));
    expect(syncPipelineRefs).toHaveBeenCalledWith({
      vault: 'Customers',
      itemTitleOrId: 'sri',
      namespace: 'dt-absa-dev',
      helmChartVersion: '2.0.14',
    });
    expect(verifyAppInstanceExists).toHaveBeenCalledWith(
      'detectionhub',
      'dt-absa-dev',
      'main',
      'SymphonyFS/scripts',
    );
    expect(syncPipelineRefs.mock.invocationCallOrder[0]).toBeLessThan(
      secretReadinessCheck.mock.invocationCallOrder[0],
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'SymphonyFS/scripts',
        workflowId: 'deploy-with-dynamic-runners.yml',
        ref: 'main',
        // Exactly the inputs the workflow declares; GitHub rejects others.
        inputs: {
          appName: 'detectionhub',
          appInstance: 'dt-absa-dev',
          triggerFailover: 'no',
        },
      }),
    );
    expect(secretReadinessCheck.mock.invocationCallOrder[0]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0],
    );
  });

  async function approveDeployment(
    built: ReturnType<typeof buildService>,
  ): Promise<string> {
    const created = await built.service.create(baseInput());
    await built.service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });
    await built.service.approve({
      id: created.id,
      approverRef: 'user:default/approver',
      role: 'platform-admin',
    });
    return created.id;
  }

  it('upserts the ingress DNS record for the helmfile kubeContext before dispatch', async () => {
    const built = buildService();
    const id = await approveDeployment(built);

    expect(built.readRepositoryFile).toHaveBeenCalledWith(
      'apps/detectionhub/dt-absa-dev/helmfile.yaml',
      'main',
      'SymphonyFS/scripts',
    );
    expect(built.ingress.ensureARecord).toHaveBeenCalledWith({
      target: expect.objectContaining({
        fqdn: 'detectionhub-sri-absa-dev.symphonyai.dev',
      }),
      clusterNames: ['uk-eng-dev', 'aks-scp-dev-sdc-st-cms'],
    });
    expect(
      built.ingress.ensureARecord.mock.invocationCallOrder[0],
    ).toBeLessThan(built.dispatch.mock.invocationCallOrder[0]);
    const events = await built.service.getDeploymentEvents(id);
    expect(events.map(event => event.eventType)).toContain('dns-provisioned');
  });

  it('fails the deployment without dispatching when DNS provisioning fails', async () => {
    const built = buildService();
    built.ingress.ensureARecord.mockRejectedValueOnce(
      new Error('No ingress IP is configured for cluster uk-eng-dev.'),
    );
    const created = await built.service.create(baseInput());
    await built.service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    await expect(
      built.service.approve({
        id: created.id,
        approverRef: 'user:default/approver',
        role: 'platform-admin',
      }),
    ).rejects.toThrow('No ingress IP is configured');
    expect(built.dispatch).not.toHaveBeenCalled();
    expect((await built.service.get(created.id))?.status).toBe('FAILED');
  });

  it('probes application health only after the workflow succeeds', async () => {
    const built = buildService();
    const id = await approveDeployment(built);

    await expect(
      built.service.checkApplicationHealth(id),
    ).rejects.toMatchObject({ status: 409 });

    built.runStatus.mockResolvedValue({
      mode: 'github-api',
      runId: '42',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/SymphonyFS/scripts/actions/runs/42',
      jobs: [],
    });
    const status = await built.service.getStatus(id);
    expect(status?.status).toBe('SUCCEEDED');
    expect(status?.applicationUrl).toBe(
      'https://detectionhub-sri-absa-dev.symphonyai.dev',
    );

    const health = await built.service.checkApplicationHealth(id);
    expect(health).toMatchObject({ healthy: true, healthyPath: '/health' });
    expect(built.ingress.probeHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://detectionhub-sri-absa-dev.symphonyai.dev',
      }),
    );
  });

  it('rejects self approval and never dispatches', async () => {
    const { service, dispatch } = buildService();
    const created = await service.create(baseInput());
    await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });
    await expect(
      service.approve({
        id: created.id,
        approverRef: 'user:default/requester',
        role: 'platform-admin',
      }),
    ).rejects.toBeInstanceOf(PortalDeploymentError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not allow an account name to bypass self-approval policy', async () => {
    const { service, dispatch } = buildService();
    const created = await service.create(
      baseInput({ actorRef: 'user:default/JuberMohamad@symphonysensa.com' }),
    );
    await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/JuberMohamad@symphonysensa.com',
      role: 'platform-admin',
    });

    await expect(
      service.approve({
        id: created.id,
        approverRef: 'user:default/JuberMohamad@symphonysensa.com',
        role: 'platform-admin',
      }),
    ).rejects.toBeInstanceOf(PortalDeploymentError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('allows Juber to reject their own deployment without allowing self-approval', async () => {
    const { service, dispatch, audit } = buildService();
    const actorRef = 'user:default/JuberMohamad@symphonysensa.com';
    const created = await service.create(baseInput({ actorRef }));
    await service.submitForApproval({
      id: created.id,
      actorRef,
      role: 'platform-admin',
    });

    const rejected = await service.reject({
      id: created.id,
      approverRef: 'user:default/jubermohamad@symphonysensa.com',
      role: 'platform-admin',
      note: 'Rejected by requester exception',
    });

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.decidedBy).toBe(
      'user:default/jubermohamad@symphonysensa.com',
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'portal-deployment-rejected',
        actorRef: 'user:default/jubermohamad@symphonysensa.com',
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('requires explicit configuration to bypass self-approval for any account', async () => {
    const { service, dispatch } = buildService();
    const created = await service.create(
      baseInput({ actorRef: 'user:default/jubermohaamd@symphonysensa.com' }),
    );
    await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/jubermohaamd@symphonysensa.com',
      role: 'platform-admin',
    });

    await expect(
      service.approve({
        id: created.id,
        approverRef: 'user:default/jubermohaamd@symphonysensa.com',
        role: 'platform-admin',
      }),
    ).rejects.toBeInstanceOf(PortalDeploymentError);
    expect(dispatch).not.toHaveBeenCalled();

    const rejected = await service.create(
      baseInput({
        actorRef: 'user:default/jubermohaamd@symphonysensa.com',
        instanceName: 'dt-absa-dev-reject-check',
      }),
    );
    await service.submitForApproval({
      id: rejected.id,
      actorRef: 'user:default/jubermohaamd@symphonysensa.com',
      role: 'platform-admin',
    });

    await expect(
      service.reject({
        id: rejected.id,
        approverRef: 'user:default/jubermohaamd@symphonysensa.com',
        role: 'platform-admin',
      }),
    ).rejects.toBeInstanceOf(PortalDeploymentError);
  });

  it('blocks approval when 1Password readiness fails', async () => {
    const { service, dispatch } = buildService();
    const readiness = {
      check: jest.fn().mockResolvedValue({
        ready: false,
        checkedAt: new Date().toISOString(),
        cached: false,
        cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
        application: 'detectionhub',
        instanceName: 'dt-absa-dev',
        includePipelineRefs: true,
        filesScanned: ['apps/detectionhub/dt-absa-dev/overrides.gotmpl'],
        referencesDiscovered: 1,
        findings: [],
        missing: [
          {
            reference: 'op://vault/item/section/field',
            normalizedReference: 'op://vault/item/section/field',
            vault: 'vault',
            item: 'item',
            section: 'section',
            field: 'field',
            status: 'MISSING',
            message: 'missing',
            sources: [
              {
                path: 'apps/detectionhub/dt-absa-dev/overrides.gotmpl',
                line: 12,
              },
            ],
          },
        ],
        placeholders: [],
        filePlaceholders: [],
        summary: '1 secret reference is missing',
      }),
    };
    (service as any).deps.secretReadiness = readiness;

    const created = await service.create(baseInput());
    await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    await expect(
      service.approve({
        id: created.id,
        approverRef: 'user:default/approver',
        role: 'platform-admin',
      }),
    ).rejects.toThrow(/1Password readiness check/i);
    expect(dispatch).not.toHaveBeenCalled();
    expect(readiness.check).toHaveBeenCalled();
  });

  it('fails closed when 1Password readiness checker is not configured', async () => {
    const { service, dispatch } = buildService();
    delete (service as any).deps.secretReadiness;

    const created = await service.create(
      baseInput({ instanceName: 'strict-readiness' }),
    );
    await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    await expect(
      service.approve({
        id: created.id,
        approverRef: 'user:default/approver',
        role: 'platform-admin',
      }),
    ).rejects.toThrow(/1Password readiness runner status is unavailable/i);
    expect(dispatch).toHaveBeenCalled();
  });

  it('fails run-diff when 1Password readiness checker is not configured', async () => {
    const { service, dispatch } = buildService();
    delete (service as any).deps.secretReadiness;

    const created = await service.create(
      baseInput({ instanceName: 'strict-diff' }),
    );

    await expect(
      service.runDiff({
        id: created.id,
        actorRef: 'user:default/requester',
        role: 'platform-admin',
      }),
    ).rejects.toThrow(/1Password readiness runner status is unavailable/i);
    expect(dispatch).toHaveBeenCalled();
  });

  it('runs readiness through the secure runner when no local checker is configured', async () => {
    const { service, dispatch, runStatus, runLogs } = buildService();
    delete (service as any).deps.secretReadiness;
    const report = {
      ready: false,
      checkedAt: new Date().toISOString(),
      cached: false,
      cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
      application: 'detectionhub',
      instanceName: 'runner-readiness',
      customer: 'sri',
      includePipelineRefs: true,
      filesScanned: ['apps/detectionhub/runner-readiness/overrides.gotmpl'],
      referencesDiscovered: 1,
      findings: [],
      missing: [{ status: 'MISSING', field: 'db_password' }],
      placeholders: [],
      filePlaceholders: [],
      summary: '1 secret reference(s) are missing from 1Password.',
    };
    runStatus.mockResolvedValue({
      mode: 'github-api',
      runId: '42',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/SymphonyFS/scripts/actions/runs/42',
    });
    runLogs.mockResolvedValue({
      mode: 'github-api',
      runId: '42',
      lines: [
        `CLOUDHUB_READINESS_RESULT=${Buffer.from(
          JSON.stringify(report),
        ).toString('base64')}`,
      ],
      jobLines: [],
    });

    const result = await service.getSecretReadiness({
      application: 'detectionhub',
      instanceName: 'runner-readiness',
      customer: 'sri',
    });

    expect(result).toEqual(report);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'onepassword-readiness.yml',
        inputs: expect.objectContaining({
          application: 'detectionhub',
          instanceName: 'runner-readiness',
          customer: 'sri',
        }),
      }),
    );
    expect(runStatus).toHaveBeenCalledWith(
      '42',
      'jubermohamad/platform_cloudhub',
    );
    expect(runLogs).toHaveBeenCalledWith(
      '42',
      'jubermohamad/platform_cloudhub',
    );
  });

  it('provisions 1Password secrets directly when readiness is blocked', async () => {
    const { service, audit, secretProvision, secretReadinessCheck } =
      buildService();
    secretReadinessCheck.mockResolvedValueOnce({
      ready: false,
      checkedAt: new Date().toISOString(),
      cached: false,
      cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      includePipelineRefs: true,
      filesScanned: ['apps/detectionhub/dt-absa-dev/overrides.gotmpl'],
      referencesDiscovered: 1,
      findings: [
        {
          reference: 'op://Customers/sri/detectionhub-dt-absa-dev/db_password',
          normalizedReference:
            'op://Customers/sri/detectionhub-dt-absa-dev/db_password',
          vault: 'Customers',
          item: 'sri',
          section: 'detectionhub-dt-absa-dev',
          field: 'db_password',
          status: 'MISSING',
          message: 'missing',
          sources: [
            {
              path: 'apps/detectionhub/dt-absa-dev/overrides.gotmpl',
              line: 12,
            },
          ],
        },
        {
          reference:
            'op://Customers/sri/pipeline_refs/detectionhub-dt-absa-dev__helm_chart_version',
          normalizedReference:
            'op://Customers/sri/pipeline_refs/detectionhub-dt-absa-dev__helm_chart_version',
          vault: 'Customers',
          item: 'sri',
          section: 'pipeline_refs',
          field: 'detectionhub-dt-absa-dev__helm_chart_version',
          status: 'MISSING',
          message: 'missing pipeline value',
          sources: [
            {
              path: 'apps/detectionhub/dt-absa-dev/overrides.gotmpl',
              line: 18,
            },
          ],
        },
      ],
      missing: [],
      placeholders: [],
      filePlaceholders: [],
      summary: '1 secret reference is missing',
    });

    const result = await service.provisionSecrets({
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      customer: 'sri',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    expect(secretProvision).toHaveBeenCalledWith(
      expect.objectContaining({
        application: 'detectionhub',
        instanceName: 'dt-absa-dev',
        customer: 'sri',
        clusterName: 'aks-scp-dev-sdc-st-cms',
      }),
    );
    expect(result.status).toBe('completed');
    expect(result.readiness?.ready).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'portal-secret-provision-requested' }),
    );
  });

  it('updates 1Password fields directly through the backend service', async () => {
    const { service, updateSecretFieldValue } = buildService();

    await service.updateSecretFieldValue({
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      customer: 'sri',
      vault: 'Customers',
      item: 'sri',
      section: 'detectionhub-dt-absa-dev',
      field: 'db_password',
      value: 'super-secret',
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    expect(updateSecretFieldValue).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: 'Customers',
        item: 'sri',
        field: 'db_password',
        value: 'super-secret',
      }),
    );
  });

  it('keeps secret provisioning on CloudHub even when deploy env vars point to scripts', async () => {
    delete process.env.CLOUDHUB_1PASSWORD_WORKFLOW_REPOSITORY;
    process.env.GITHUB_ACTIONS_REPO = 'SymphonyFS/scripts';
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_REPOSITORY = 'jubermohamad/platform_cloudhub';

    const { service, secretProvision, dispatch } = buildService();
    const readinessCheck = (service as any).deps.secretReadiness
      .check as jest.Mock;
    readinessCheck.mockResolvedValueOnce({
      ready: false,
      checkedAt: new Date().toISOString(),
      cached: false,
      cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      includePipelineRefs: true,
      filesScanned: ['apps/detectionhub/dt-absa-dev/overrides.gotmpl'],
      referencesDiscovered: 1,
      findings: [],
      missing: [],
      placeholders: [],
      filePlaceholders: [],
      summary: 'Missing values',
    });

    await service.provisionSecrets({
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      customer: 'sri',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    expect(secretProvision).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('provisions secrets directly even when the workflow repository env is invalid', async () => {
    process.env.CLOUDHUB_1PASSWORD_WORKFLOW_REPOSITORY = 'invalid-repo';
    const { service, secretProvision, dispatch } = buildService();
    const readinessCheck = (service as any).deps.secretReadiness
      .check as jest.Mock;
    readinessCheck.mockResolvedValueOnce({
      ready: false,
      checkedAt: new Date().toISOString(),
      cached: false,
      cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      includePipelineRefs: true,
      filesScanned: ['apps/detectionhub/dt-absa-dev/overrides.gotmpl'],
      referencesDiscovered: 1,
      findings: [],
      missing: [],
      placeholders: [],
      filePlaceholders: [],
      summary: 'Missing values',
    });

    await service.provisionSecrets({
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      customer: 'sri',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    expect(secretProvision).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('provisions 1Password secrets directly without workflow env vars', async () => {
    const { service, secretProvision, audit } = buildService();

    const started = await service.provisionSecrets({
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      customer: 'sri',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });

    expect(secretProvision).toHaveBeenCalledWith(
      expect.objectContaining({
        application: 'detectionhub',
        instanceName: 'dt-absa-dev',
        customer: 'sri',
        clusterName: 'aks-scp-dev-sdc-st-cms',
      }),
    );
    expect(started.status).toBe('completed');
    expect(started.readiness?.ready).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'portal-secret-provision-requested' }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'portal-secret-provision-completed' }),
    );
  });

  it('rejects an unregistered cluster before persistence or dispatch', async () => {
    const { service, dispatch } = buildService({
      clusters: [{ ...CLUSTER, clusterName: 'other-cluster' }],
    });
    await expect(service.create(baseInput())).rejects.toThrow(
      /not found|registered/i,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('accepts a custom customer identifier when it matches the allowed format', async () => {
    const { service, dispatch } = buildService();
    const record = await service.create(baseInput({ customer: 'acme-demo' }));
    expect(record.customer).toBe('acme-demo');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('classifies a missing scripts instance as NEW', async () => {
    const { service, dispatch } = buildService();
    const record = await service.create(
      baseInput({ instanceName: 'not-real' }),
    );
    expect(record.instanceStatus).toBe('NEW');
    expect(record.status).toBe('PENDING');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('updates status from GitHub and does not re-query terminal deployments', async () => {
    const { service, runStatus } = buildService();
    const created = await service.create(baseInput());
    await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });
    const queued = await service.approve({
      id: created.id,
      approverRef: 'user:default/approver',
      role: 'platform-admin',
    });
    runStatus.mockResolvedValue({
      mode: 'github-api',
      runId: '42',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: '',
      jobs: [],
    });
    expect((await service.getStatus(queued.id))?.status).toBe('SUCCEEDED');
    runStatus.mockClear();
    await service.getStatus(queued.id);
    expect(runStatus).not.toHaveBeenCalled();
  });

  it('reconciles a dispatched run that was initially invisible without redispatching', async () => {
    const { service, dispatch, findWorkflowRun } = buildService();
    dispatch.mockResolvedValueOnce({
      mode: 'github-api',
      repository: 'SymphonyFS/scripts',
      workflowId: 'deploy-with-dynamic-runners.yml',
      ref: 'main',
      runId: '',
      status: 'queued',
      conclusion: null,
      htmlUrl: '',
    });
    findWorkflowRun.mockResolvedValue({
      status: 'correlated',
      run: {
        id: '99',
        status: 'queued',
        conclusion: null,
        htmlUrl: 'run-99',
        attempt: 1,
      },
    });
    const created = await service.create(baseInput());
    await service.submitForApproval({
      id: created.id,
      actorRef: 'user:default/requester',
      role: 'platform-admin',
    });
    const dispatched = await service.approve({
      id: created.id,
      approverRef: 'user:default/approver',
      role: 'platform-admin',
    });
    expect(dispatched.status).toBe('DISPATCHING');
    await service.reconcileNonTerminalDeployments();
    expect((await service.get(created.id))?.workflowRunId).toBe('99');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('uses sequential placeholders for approval updates', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) } as any;
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as any;
    const deps: DeploymentPortalDeps = {
      logger,
      getPool: () => pool,
      actions: {
        dispatch: jest.fn(),
        runStatus: jest.fn(),
        runLogs: jest.fn(),
        findWorkflowRun: jest.fn(),
      } as any,
      discoverClusters: jest.fn().mockResolvedValue([CLUSTER]),
      listCustomerCodes: jest.fn().mockResolvedValue(['sri']),
      audit: jest.fn().mockResolvedValue(undefined),
      catalog: {
        listApplications: jest.fn().mockResolvedValue([]),
        listInstances: jest.fn().mockResolvedValue([]),
      } as any,
    };
    const service = new DeploymentPortalService(deps);
    const record = {
      id: 'deployment-123',
      deploymentName: 'demo',
      application: 'detectionhub',
      instanceName: 'dt-absa-dev',
      customer: 'sri',
      environment: 'dev',
      cluster: 'aks-scp-dev-sdc-st-cms',
      subscriptionId: SUBSCRIPTION_ID,
      resourceGroup: CLUSTER.resourceGroup,
      chartVersion: '1.2.3',
      aiStoreIntegration: false,
      namespace: 'ns',
      helmfilePath: 'apps/detectionhub/dt-absa-dev/helmfile.yaml',
      helmfileContent: 'content',
      branch: 'main',
      commitSha: null,
      prUrl: null,
      workflowRunId: null,
      workflowRunUrl: null,
      status: 'PENDING_APPROVAL',
      currentStep: 'Awaiting approval',
      statusMessage: null,
      failureReason: null,
      approvedBy: null,
      approvedAt: null,
      mode: 'github-api',
      requestedBy: 'user:default/requester',
      requestedAt: '2024-01-01T00:00:00.000Z',
      createdBy: 'user:default/requester',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      startedAt: '2024-01-01T00:00:00.000Z',
      completedAt: null,
      workflowRepository: null,
      workflowId: null,
      workflowRef: null,
      workflowInputs: {},
      dispatchInitiatedAt: null,
      workflowRunAttempt: null,
      workflowStatus: null,
      workflowConclusion: null,
      correlationStatus: 'PENDING',
      correlationMessage: null,
      correlationAttempts: 0,
      correlationDeadline: null,
      lastLogLine: 0,
      instanceStatus: 'EXISTING',
      instanceMode: 'auto',
    } as any;

    await (service as any).persistApprovalUpdate(record);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('$2');
    expect(sql).toContain('$30');
    expect(params).toHaveLength(30);
  });
});
