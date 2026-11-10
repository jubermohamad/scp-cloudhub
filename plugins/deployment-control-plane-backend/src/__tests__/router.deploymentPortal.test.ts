import express from 'express';
import request from 'supertest';
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { createControlPlaneRouter } from '../router';

patchSupertestIpv4();

const PLATFORM_TRIGGER_GROUPS =
  'group:default/cloudhubplatformowners,group:default/nonprd-cicd-pipeline-trigger-allow';
const READ_GROUPS = 'group:default/cloudhubappeng';
const VALID_SUBSCRIPTION = '00000000-0000-0000-0000-000000000000';

function sampleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dep-1',
    deploymentName: 'detectionhub-dt-test',
    application: 'detectionhub',
    instanceName: 'dt-test',
    customer: 'sri',
    environment: 'dev',
    cluster: 'aks-scp-dev-sdc-st-cms',
    subscriptionId: VALID_SUBSCRIPTION,
    resourceGroup: 'rg-scp-dev',
    chartVersion: '1.4.0',
    aiStoreIntegration: true,
    namespace: 'dt-test',
    helmfilePath: 'apps/detectionhub/dt-test/helmfile.yaml',
    helmfileContent: 'namespace: dt-test\n',
    branch: 'feature/juber-detectionhub-test',
    commitSha: 'abcdef1234567890',
    prUrl: null,
    workflowRunId: '42',
    workflowRunUrl: 'https://github.com/run/42',
    status: 'QUEUED',
    currentStep: 'Workflow queued for DetectionHub',
    statusMessage: null,
    failureReason: null,
    mode: 'github-api',
    createdBy: 'user:default/test',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    startedAt: '2026-08-13T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

function buildApp() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as any;

  const service = {
    getPortalDeploymentOptions: jest.fn().mockResolvedValue({
      applications: [
        {
          id: 'sri-detection',
          appName: 'detectionhub',
          displayName: 'SRI Detection',
          description: 'x',
          chartVersions: ['1.4.0', '1.3.2', '1.2.0'],
          supportsAiStoreIntegration: true,
        },
      ],
      environments: ['dev', 'qa', 'sandbox', 'test'],
      customers: ['sri'],
      repository: 'SymphonyFS/scripts',
      branch: 'feature/juber-detectionhub-test',
    }),
    previewPortalHelmfile: jest.fn().mockReturnValue({
      path: 'apps/detectionhub/dt-test/helmfile.yaml',
      namespace: 'dt-test',
      content: 'namespace: dt-test\n',
    }),
    getPortalDeploymentSecretReadiness: jest.fn().mockResolvedValue({
      ready: true,
      checkedAt: '2026-09-15T12:00:00.000Z',
      cached: false,
      cacheExpiresAt: '2026-09-15T12:05:00.000Z',
      application: 'detectionhub',
      instanceName: 'dt-test',
      includePipelineRefs: true,
      filesScanned: ['apps/detectionhub/dt-test/overrides.gotmpl'],
      referencesDiscovered: 2,
      findings: [],
      missing: [],
      placeholders: [],
      filePlaceholders: [],
      summary: 'Ready',
    }),
    provisionPortalDeploymentSecrets: jest.fn().mockResolvedValue({
      operationId: 'op-1',
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      workflowRepository: 'SymphonyFS/scripts',
      workflowId: 'copy-1password-section.yml',
      workflowRef: 'main',
      workflowRunId: '77',
      workflowRunUrl: 'https://github.com/SymphonyFS/scripts/actions/runs/77',
      status: 'queued',
      conclusion: null,
      message: 'Provisioning workflow dispatched to secure runner.',
      sections: ['detectionhub-dt-test'],
      fieldsGenerated: ['db_password'],
      requestedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:00:00.000Z',
      completedAt: null,
      readiness: null,
    }),
    getPortalSecretProvisionStatus: jest.fn().mockResolvedValue({
      operationId: 'op-1',
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      workflowRepository: 'SymphonyFS/scripts',
      workflowId: 'copy-1password-section.yml',
      workflowRef: 'main',
      workflowRunId: '77',
      workflowRunUrl: 'https://github.com/SymphonyFS/scripts/actions/runs/77',
      status: 'completed',
      conclusion: 'success',
      message: '1Password section was created/populated and readiness is now Ready.',
      sections: ['detectionhub-dt-test'],
      fieldsGenerated: ['db_password'],
      requestedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:01:00.000Z',
      completedAt: '2026-09-15T12:01:00.000Z',
      readiness: {
        ready: true,
        checkedAt: '2026-09-15T12:01:00.000Z',
        cached: false,
        cacheExpiresAt: '2026-09-15T12:06:00.000Z',
        application: 'detectionhub',
        instanceName: 'dt-test',
        includePipelineRefs: true,
        filesScanned: ['apps/detectionhub/dt-test/overrides.gotmpl'],
        referencesDiscovered: 2,
        findings: [],
        missing: [],
        placeholders: [],
        filePlaceholders: [],
        summary: 'Ready',
      },
    }),
    createPortalDeployment: jest.fn().mockResolvedValue(sampleRecord()),
    submitPortalDeploymentForApproval: jest
      .fn()
      .mockResolvedValue(sampleRecord({ status: 'PENDING_APPROVAL' })),
    approvePortalDeployment: jest.fn().mockResolvedValue(sampleRecord()),
    rejectPortalDeployment: jest.fn().mockResolvedValue(
      sampleRecord({ status: 'FAILED', currentStep: 'Rejected' }),
    ),
    syncPortalDeploymentWorkflowRun: jest.fn().mockResolvedValue(sampleRecord()),
    listPortalDeployments: jest.fn().mockResolvedValue([sampleRecord()]),
    getPortalDeployment: jest.fn().mockResolvedValue(sampleRecord()),
    getPortalDeploymentStatus: jest.fn().mockResolvedValue({
      deploymentId: 'dep-1',
      workflowRunId: '42',
      status: 'DEPLOYING',
      currentStep: 'Creating Kubernetes resources',
      workflowRunUrl: 'https://github.com/run/42',
      statusMessage: null,
      failureReason: null,
      updatedAt: '2026-08-13T00:01:00.000Z',
      completedAt: null,
    }),
    runPortalDeploymentDiff: jest.fn().mockResolvedValue({
      deploymentId: 'dep-1',
      workflowRunId: '52',
      workflowRunUrl: 'https://github.com/run/52',
      status: 'queued',
      conclusion: null,
      currentStep: 'Diff workflow queued',
      statusMessage: 'Waiting for GitHub Actions runner capacity.',
      failureReason: null,
      correlationStatus: 'CORRELATED',
      correlationMessage: 'Workflow run correlated after dispatch.',
      updatedAt: '2026-08-13T00:01:00.000Z',
      startedAt: '2026-08-13T00:01:00.000Z',
      completedAt: null,
    }),
    getPortalDeploymentDiffStatus: jest.fn().mockResolvedValue({
      deploymentId: 'dep-1',
      workflowRunId: '52',
      workflowRunUrl: 'https://github.com/run/52',
      status: 'in_progress',
      conclusion: null,
      currentStep: 'Running deployment diff',
      statusMessage:
        'Runner is executing actionValidation checks and producing diff logs.',
      failureReason: null,
      correlationStatus: 'CORRELATED',
      correlationMessage: null,
      updatedAt: '2026-08-13T00:02:00.000Z',
      startedAt: '2026-08-13T00:01:00.000Z',
      completedAt: null,
    }),
    retryPortalDeployment: jest
      .fn()
      .mockResolvedValue(sampleRecord({ status: 'QUEUED' })),
  };

  const httpAuth = {
    credentials: jest.fn(async (req: express.Request) => {
      const groups =
        (req.headers['x-groups'] as string | undefined)
          ?.split(',')
          .map(s => s.trim())
          .filter(Boolean) ?? [];
      return { principal: { type: 'user' }, groups };
    }),
  } as any;

  const userInfo = {
    getUserInfo: jest.fn(async (credentials: any) => ({
      userEntityRef: 'user:default/test',
      ownershipEntityRefs: credentials.groups ?? [],
    })),
  } as any;

  const gitHubAuthorizationService = {
    isEnabled: jest.fn().mockReturnValue(false),
    authorize: jest.fn().mockResolvedValue({ authorized: false, enabled: false }),
  } as any;
  const gitHubRepositoryService = {} as any;

  const router = createControlPlaneRouter({
    logger,
    httpAuth,
    userInfo,
    service: service as any,
    gitHubAuthorizationService,
    gitHubRepositoryService,
  });

  const app = express();
  app.use(express.json());
  app.use(router);
  return { app, service };
}

const validBody = {
  application: 'detectionhub',
  instanceName: 'dt-test',
  customer: 'sri',
  environment: 'dev',
  clusterName: 'aks-scp-dev-sdc-st-cms',
  subscriptionId: VALID_SUBSCRIPTION,
  resourceGroup: 'rg-scp-dev',
  chartVersion: '1.4.0',
  aiStoreIntegration: true,
};

describe('Control Plane Router deployment portal endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns deployment options for readers', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .get('/deployments/options')
      .set('x-groups', READ_GROUPS);

    expect(res.status).toBe(200);
    expect(res.body.repository).toBe('SymphonyFS/scripts');
    expect(service.getPortalDeploymentOptions).toHaveBeenCalledTimes(1);
  });

  it('renders a Helmfile preview', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/deployments/preview')
      .set('x-groups', READ_GROUPS)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('apps/detectionhub/dt-test/helmfile.yaml');
    expect(service.previewPortalHelmfile).toHaveBeenCalledTimes(1);
  });

  it('rejects a preview with missing fields', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/deployments/preview')
      .set('x-groups', READ_GROUPS)
      .send({ application: 'detectionhub' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
    expect(service.previewPortalHelmfile).not.toHaveBeenCalled();
  });

  it('returns deployment secret readiness report', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/deployments/secret-readiness')
      .set('x-groups', READ_GROUPS)
      .send({
        application: 'detectionhub',
        instanceName: 'dt-test',
        customer: 'sri',
        clusterName: 'aks-scp-dev-sdc-st-cms',
      });

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(service.getPortalDeploymentSecretReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        application: 'detectionhub',
        instanceName: 'dt-test',
        customer: 'sri',
      }),
    );
  });

  it('triggers secure-runner 1Password section provisioning', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/deployments/secret-provision')
      .set('x-groups', READ_GROUPS)
      .send({
        application: 'detectionhub',
        instanceName: 'dt-test',
        customer: 'sri',
        clusterName: 'aks-scp-dev-sdc-st-cms',
      });

    expect(res.status).toBe(202);
    expect(res.body.operationId).toBe('op-1');
    expect(service.provisionPortalDeploymentSecrets).toHaveBeenCalledWith(
      expect.objectContaining({
        application: 'detectionhub',
        instanceName: 'dt-test',
        customer: 'sri',
      }),
    );
  });

  it('returns secret provisioning status by operation id', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .get('/deployments/secret-provision/op-1')
      .set('x-groups', READ_GROUPS);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(service.getPortalSecretProvisionStatus).toHaveBeenCalledWith('op-1');
  });

  it('creates a deployment for platform + pipeline-trigger members', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/deployments')
      .set('x-groups', PLATFORM_TRIGGER_GROUPS)
      .send(validBody);

    expect(res.status).toBe(202);
    expect(res.body.id).toBe('dep-1');
    expect(service.createPortalDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        application: 'detectionhub',
        instanceName: 'dt-test',
        actorRef: 'user:default/test',
        role: 'platform-admin',
      }),
    );
  });

  it('allows app engineering to create application deployments', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/deployments')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send(validBody);

    expect(res.status).toBe(202);
    expect(service.createPortalDeployment).toHaveBeenCalled();
  });

  it('rejects create with a missing field', async () => {
    const { app, service } = buildApp();
    const { customer, ...withoutCustomer } = validBody;
    const res = await request(app)
      .post('/deployments')
      .set('x-groups', PLATFORM_TRIGGER_GROUPS)
      .send(withoutCustomer);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
    expect(service.createPortalDeployment).not.toHaveBeenCalled();
  });

  it('rejects create with an invalid subscription id', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/deployments')
      .set('x-groups', PLATFORM_TRIGGER_GROUPS)
      .send({ ...validBody, subscriptionId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid UUID/);
  });

  it('maps a service PortalDeploymentError status onto the response', async () => {
    const { app, service } = buildApp();
    service.createPortalDeployment.mockRejectedValueOnce(
      Object.assign(new Error('Instance dt-test already exists.'), {
        status: 409,
      }),
    );

    const res = await request(app)
      .post('/deployments')
      .set('x-groups', PLATFORM_TRIGGER_GROUPS)
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it('approves a deployment for platform admins', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/deployments/dep-1/approve')
      .set('x-groups', 'group:default/GRP-CloudHub-PlatformAdmin')
      .send({ note: 'approved' });

    expect(res.status).toBe(202);
    expect(service.approvePortalDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dep-1', note: 'approved' }),
    );
  });

  it('submits a saved deployment for approval', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/deployments/dep-1/send-for-approval')
      .set('x-groups', PLATFORM_TRIGGER_GROUPS)
      .send({ note: 'submit for approval' });

    expect(res.status).toBe(202);
    expect(service.submitPortalDeploymentForApproval).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dep-1', note: 'submit for approval' }),
    );
  });

  it('syncs workflow runs from the webhook receiver', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .post('/webhooks/github/workflow-runs')
      .send({
        workflow_run: {
          id: '42',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/run/42',
        },
      });

    expect(res.status).toBe(200);
    expect(service.syncPortalDeploymentWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRunId: '42', status: 'completed' }),
    );
  });

  it('lists deployments for readers', async () => {
    const { app, service } = buildApp();
    const res = await request(app)
      .get('/deployments')
      .set('x-groups', READ_GROUPS);

    expect(res.status).toBe(200);
    expect(res.body.deployments).toHaveLength(1);
    expect(service.listPortalDeployments).toHaveBeenCalledTimes(1);
  });

  it('returns a single deployment and 404 when missing', async () => {
    const { app, service } = buildApp();

    const ok = await request(app)
      .get('/deployments/dep-1')
      .set('x-groups', READ_GROUPS);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe('dep-1');

    service.getPortalDeployment.mockResolvedValueOnce(null);
    const missing = await request(app)
      .get('/deployments/nope')
      .set('x-groups', READ_GROUPS);
    expect(missing.status).toBe(404);
  });

  it('returns live status and 404 when missing', async () => {
    const { app, service } = buildApp();

    const ok = await request(app)
      .get('/deployments/dep-1/status')
      .set('x-groups', READ_GROUPS);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('DEPLOYING');

    service.getPortalDeploymentStatus.mockResolvedValueOnce(null);
    const missing = await request(app)
      .get('/deployments/nope/status')
      .set('x-groups', READ_GROUPS);
    expect(missing.status).toBe(404);
  });

  it('runs and tracks deployment diff', async () => {
    const { app, service } = buildApp();

    const run = await request(app)
      .post('/deployments/dep-1/diff')
      .set('x-groups', READ_GROUPS)
      .send({ note: 'run diff' });
    expect(run.status).toBe(202);
    expect(run.body.workflowRunId).toBe('52');
    expect(service.runPortalDeploymentDiff).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dep-1', note: 'run diff' }),
    );

    const status = await request(app)
      .get('/deployments/dep-1/diff/status')
      .set('x-groups', READ_GROUPS);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('in_progress');
    expect(service.getPortalDeploymentDiffStatus).toHaveBeenCalledWith('dep-1');

    service.getPortalDeploymentDiffStatus.mockResolvedValueOnce(null);
    const missing = await request(app)
      .get('/deployments/dep-1/diff/status')
      .set('x-groups', READ_GROUPS);
    expect(missing.status).toBe(404);
  });

  it('retries a deployment for authorised members and forbids others', async () => {
    const { app, service } = buildApp();

    const ok = await request(app)
      .post('/deployments/dep-1/retry')
      .set('x-groups', PLATFORM_TRIGGER_GROUPS);
    expect(ok.status).toBe(202);
    expect(service.retryPortalDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dep-1', role: 'platform-admin' }),
    );

    const forbidden = await request(app)
      .post('/deployments/dep-1/retry')
      .set('x-groups', READ_GROUPS);
    expect(forbidden.status).toBe(403);
  });
});
