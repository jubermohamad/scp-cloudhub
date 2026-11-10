const {
  OnePasswordSecretReadinessService,
} = require('../services/onePasswordSecretReadinessService');

describe('OnePasswordSecretReadinessService', () => {
  const originalServiceToken = process.env.OP_SERVICE_ACCOUNT_TOKEN;
  const originalConnectHost = process.env.OP_CONNECT_HOST;
  const originalConnectToken = process.env.OP_CONNECT_TOKEN;

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  beforeEach(() => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = 'test-service-account-token';
    delete process.env.OP_CONNECT_HOST;
    delete process.env.OP_CONNECT_TOKEN;
  });

  afterAll(() => {
    if (originalServiceToken === undefined) {
      delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    } else {
      process.env.OP_SERVICE_ACCOUNT_TOKEN = originalServiceToken;
    }

    if (originalConnectHost === undefined) {
      delete process.env.OP_CONNECT_HOST;
    } else {
      process.env.OP_CONNECT_HOST = originalConnectHost;
    }

    if (originalConnectToken === undefined) {
      delete process.env.OP_CONNECT_TOKEN;
    } else {
      process.env.OP_CONNECT_TOKEN = originalConnectToken;
    }
  });

  function makeService(params: any) {
    const vaults = params.vaults ?? [
      { id: 'Customers', title: 'Customers' },
      { id: 'CloudHubVault', title: 'CloudHubVault' },
    ];
    const items = new Map();

    const seedItems = params.itemsByVault ?? {
      Customers: [
        {
          id: 'sri',
          title: 'sri',
          fields: [
            {
              id: 'password',
              title: 'password',
              value: 'super-secret',
              sectionId: 'database',
              section: { id: 'database', title: 'database' },
              fieldType: 'Concealed',
            },
          ],
          sections: [{ id: 'database', title: 'database' }],
        },
        {
          id: 'demo',
          title: 'demo',
          fields: [
            {
              id: 'password',
              title: 'password',
              value: 'demo-secret',
              sectionId: 'database',
              section: { id: 'database', title: 'database' },
              fieldType: 'Concealed',
            },
          ],
          sections: [{ id: 'database', title: 'database' }],
        },
      ],
      CloudHubVault: [
        {
          id: 'dt-test',
          title: 'dt-test',
          fields: [
            {
              id: 'password',
              title: 'password',
              value: 'super-secret',
              sectionId: 'database',
              section: { id: 'database', title: 'database' },
              fieldType: 'Concealed',
            },
            {
              id: 'db_password',
              title: 'db_password',
              value: 'super-secret',
              sectionId: 'detectionhub-dt-test',
              section: {
                id: 'detectionhub-dt-test',
                title: 'detectionhub-dt-test',
              },
              fieldType: 'Concealed',
            },
            {
              id: 'detectionhub-dt-test__project_overlay_branch',
              title: 'detectionhub-dt-test__project_overlay_branch',
              value: 'op://Customers/sri/detectionhub-dt-test/db_password',
              sectionId: 'pipeline_refs',
              section: { id: 'pipeline_refs', title: 'pipeline_refs' },
              fieldType: 'Concealed',
            },
            {
              id: 'detectionhub-dt-test__helm_chart_version',
              title: 'detectionhub-dt-test__helm_chart_version',
              value: '1.0.2',
              sectionId: 'pipeline_refs',
              section: { id: 'pipeline_refs', title: 'pipeline_refs' },
              fieldType: 'Concealed',
            },
          ],
          sections: [
            { id: 'database', title: 'database' },
            { id: 'detectionhub-dt-test', title: 'detectionhub-dt-test' },
            { id: 'pipeline_refs', title: 'pipeline_refs' },
          ],
        },
      ],
    };

    for (const [vaultId, vaultItems] of Object.entries(seedItems) as Array<
      [string, any[]]
    >) {
      items.set(
        vaultId,
        vaultItems.map((item: any) => ({ ...item })),
      );
    }

    const getVaultItems = (vaultId: string) => items.get(vaultId) ?? [];

    const client = {
      vaults: {
        list: jest.fn(async () => vaults),
      },
      items: {
        list: jest.fn(async (vaultId: string) =>
          getVaultItems(vaultId).map((item: any) => ({
            id: item.id,
            title: item.title,
            vaultId,
            category: 'SecureNote',
            state: 'Active',
          })),
        ),
        get: jest.fn(async (vaultId: string, itemId: string) => {
          const vaultItems = getVaultItems(vaultId);
          const item = vaultItems.find(
            (candidate: any) =>
              candidate.id === itemId || candidate.title === itemId,
          );
          if (!item) {
            throw new Error(`missing ${vaultId}/${itemId}`);
          }
          return { ...item, vaultId };
        }),
        create: jest.fn(async (item: any) => {
          const nextItem = {
            id: item.title,
            title: item.title,
            vaultId: item.vaultId,
            category: item.category,
            fields: (item.fields ?? []).map((field: any) => ({
              ...field,
              section: field.sectionId
                ? { id: field.sectionId, title: field.sectionId }
                : field.section,
            })),
            sections: item.sections ?? [],
          };
          const vaultItems = getVaultItems(item.vaultId);
          vaultItems.push(nextItem);
          items.set(item.vaultId, vaultItems);
          return { ...nextItem };
        }),
        put: jest.fn(async (item: any) => {
          const vaultItems = getVaultItems(item.vaultId);
          const index = vaultItems.findIndex(
            (candidate: any) =>
              candidate.id === item.id || candidate.title === item.title,
          );
          const nextItem = {
            ...item,
            fields: (item.fields ?? []).map((field: any) => ({
              ...field,
              section: field.sectionId
                ? { id: field.sectionId, title: field.sectionId }
                : field.section,
            })),
          };
          if (index >= 0) {
            vaultItems[index] = nextItem;
          } else {
            vaultItems.push(nextItem);
          }
          items.set(item.vaultId, vaultItems);
          return { ...nextItem };
        }),
      },
    };

    const createClient = jest.fn(async () => client);

    const catalog = {
      readTextIfExists: jest.fn(async path => params.files[path] ?? null),
    };

    const readLocalTextFile = jest.fn(async () => null);

    const service = new OnePasswordSecretReadinessService({
      logger,
      catalog,
      createClient,
      readLocalTextFile,
      now: () => Date.parse('2026-09-15T00:00:00.000Z'),
    });

    return { service, client, catalog, createClient };
  }

  it('returns ready when all op refs resolve with non-placeholder values', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: ref+op://CloudHubVault/dt-test/database/password\n',
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
    });

    expect(report.ready).toBe(true);
    expect(report.referencesDiscovered).toBe(1);
    expect(report.missing).toHaveLength(0);
    expect(report.placeholders).toHaveLength(0);
  });

  it('returns blocked when a secret resolves to UPDATE_ME placeholder', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: op://CloudHubVault/dt-test/database/password\n',
      },
      itemsByVault: {
        CloudHubVault: [
          {
            id: 'dt-test',
            title: 'dt-test',
            fields: [
              {
                id: 'password',
                title: 'password',
                value: 'UPDATE_ME',
                sectionId: 'database',
                section: { id: 'database', title: 'database' },
                fieldType: 'Concealed',
              },
            ],
            sections: [{ id: 'database', title: 'database' }],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
    });

    expect(report.ready).toBe(false);
    expect(report.placeholders).toHaveLength(1);
    expect(report.summary).toMatch(/placeholder/i);
  });

  it('synthesizes CloudHub metadata UPDATE_ME values from deployment context', async () => {
    const { service } = makeService({});

    expect(
      await service.generateProvisionValue('UPDATE_ME_NC_SUFFIX', {
        application: 'invhub',
        instanceName: 'nr-sri-dev',
      }),
    ).toBe('sri-dev');
    expect(
      await service.generateProvisionValue('UPDATE_ME_NC_SUFFIX', {
        application: 'invhub',
        instanceName: 'invhub-dt-juber-poc3',
      }),
    ).toBe('dt-juber-poc3');
    expect(
      await service.generateProvisionValue('UPDATE_ME_CLIENT_SUBDOMAIN', {
        application: 'invhub',
        instanceName: 'nr-sri-dev',
        customer: 'sri',
      }),
    ).toBe('sri');
    expect(
      await service.generateProvisionValue('UPDATE_ME_ENV_TYPE', {
        application: 'invhub',
        instanceName: 'nr-sri-dev',
      }),
    ).toBe('dev');
    expect(
      await service.generateProvisionValue('UPDATE_ME_OWNERS', {
        application: 'invhub',
        instanceName: 'nr-sri-dev',
      }),
    ).toContain('cloudhub');
  });

  it('ignores CloudHub-managed UPDATE_ME tokens during file placeholder scans', async () => {
    const { service } = makeService({
      files: {
        'scp/apps/invhub/helmfile.yaml':
          'kubeContext: aks-UPDATE_ME_NC_SUFFIX\nowners: "UPDATE_ME_OWNERS"\nclientSubDomain: "UPDATE_ME_CLIENT_SUBDOMAIN"\nenvType: "UPDATE_ME_ENV_TYPE"\n',
      },
    });

    const report = await service.check({
      application: 'invhub',
      instanceName: 'nr-sri-dev',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.filePlaceholders).toHaveLength(0);
  });

  it('returns blocked when a secret resolves to an empty value', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: op://CloudHubVault/dt-test/database/password\n',
      },
      itemsByVault: {
        CloudHubVault: [
          {
            id: 'dt-test',
            title: 'dt-test',
            fields: [
              {
                id: 'password',
                title: 'password',
                value: '   ',
                sectionId: 'database',
                section: { id: 'database', title: 'database' },
              },
            ],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(false);
    expect(report.placeholders).toHaveLength(1);
    expect(report.findings[0].status).toBe('EMPTY');
  });

  it('uses the SDK client for readiness checks without mutating items', async () => {
    const { service, client } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: ref+op://CloudHubVault/dt-test/database/password\n',
      },
    });

    await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(client.items.get).toHaveBeenCalled();
    expect(client.items.put).not.toHaveBeenCalled();
    expect(client.items.create).not.toHaveBeenCalled();
  });

  it('lists customer codes directly from 1Password vault items and filters templates', async () => {
    const { service } = makeService({
      files: {},
    });

    const codes = await service.listCustomerCodesFromVaults(['Customers']);

    expect(codes).toEqual(['demo', 'sri']);
  });

  it('bootstraps standard environment sections on an existing customer item', async () => {
    const { service, client } = makeService({
      files: {},
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [],
            sections: [],
          },
        ],
      },
    });

    const result = await service.bootstrapCustomerStructure({
      customer: 'sri',
    });

    expect(result.item).toBe('sri');
    expect(result.sections).toEqual([
      'nr-sri-dev',
      'nr-sri-qa',
      'nr-sri-uat',
      'nr-sri-prod',
      'pipeline_refs',
    ]);

    expect(client.items.create).not.toHaveBeenCalled();
    // Every requested section is new, so each write performs one PUT to persist
    // the section and one PUT to persist the bootstrap marker field.
    expect(client.items.put).toHaveBeenCalledTimes(10);
  });

  it('fails closed when the customer item does not exist in the selected vault', async () => {
    const { service, client } = makeService({
      files: {},
      itemsByVault: {
        Customers: [],
      },
    });

    await expect(
      service.bootstrapCustomerStructure({ customer: 'sri' }),
    ).rejects.toThrow(/will not create missing customer items automatically/i);
    expect(client.items.create).not.toHaveBeenCalled();
  });

  it('provisions pipeline-control fields like helm_chart_version seeded from Release Catalog', async () => {
    const { service, client } = makeService({
      files: {
        'apps/detectionhub/dt-test/helmfile.yaml':
          'helm_chart_version: {{ env "CLOUDHUB_HELM_CHART_VERSION" }}\ndbPassword: {{ env "CLOUDHUB_DB_PASSWORD" }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [],
            sections: [],
          },
        ],
      },
    });

    const result = await service.provisionSecrets({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      actorRef: 'user:default/test',
      role: 'platform-admin',
      applicationReleaseVersion: '2.0.14',
    });

    // Pipeline fields (helm_chart_version, etc.) are now seeded from Release Catalog
    // during provisioning so helmfile diff can resolve them before deploy time.
    // They will have Release Catalog values (e.g., "2.0.14" for helm_chart_version).
    expect(result.fieldsGenerated).toContain(
      'detectionhub-dt-test__helm_chart_version',
    );
    expect(result.fieldsGenerated).toContain('db_password');
    expect(
      result.verifiedFields?.some(
        (f: any) => f.field === 'db_password' && f.verified,
      ),
    ).toBe(true);
    expect(
      result.verifiedFields?.some(
        (f: any) =>
          f.field === 'detectionhub-dt-test__helm_chart_version' && f.verified,
      ),
    ).toBe(true);

    const savedItem = client.items.put.mock.calls.at(-1)![0];
    expect(
      savedItem.fields.some((field: any) => field.title === 'db_password'),
    ).toBe(true);
    // Pipeline ref should be saved with Release Catalog value
    const helmChartVersionField = savedItem.fields.find(
      (field: any) =>
        field.title === 'detectionhub-dt-test__helm_chart_version',
    );
    expect(helmChartVersionField).toBeDefined();
    expect(helmChartVersionField.value).toBe('2.0.14');
  });

  it('only auto-generates truly missing secrets and leaves placeholder values alone', async () => {
    const { service, client } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: op://Customers/sri/detectionhub-dt-test/db_password\n' +
          'clientSecret: op://Customers/sri/detectionhub-dt-test/client_secret\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'db_password',
                title: 'db_password',
                value: 'UPDATE_ME',
                sectionId: 'detectionhub-dt-test',
                section: {
                  id: 'detectionhub-dt-test',
                  title: 'detectionhub-dt-test',
                },
                fieldType: 'Concealed',
              },
            ],
            sections: [
              { id: 'detectionhub-dt-test', title: 'detectionhub-dt-test' },
            ],
          },
        ],
      },
    });

    await service.provisionSecrets({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      actorRef: 'user:default/test',
      role: 'platform-admin',
      applicationReleaseVersion: '2.0.14',
    });

    const savedItem = client.items.put.mock.calls.at(-1)![0];
    const dbPasswordField = savedItem.fields.find(
      (field: any) => field.title === 'db_password',
    );
    const clientSecretField = savedItem.fields.find(
      (field: any) => field.title === 'client_secret',
    );

    expect(dbPasswordField).toBeDefined();
    expect(dbPasswordField.value).toBe('UPDATE_ME');
    expect(clientSecretField).toBeDefined();
    expect(clientSecretField.value).toBeTruthy();
  });

  it('syncs pipeline refs into the pipeline_refs section before deployment', async () => {
    const { service, client } = makeService({
      files: {},
    });

    await service.syncPipelineRefs({
      vault: 'Customers',
      itemTitleOrId: 'sri',
      namespace: 'detectionhub-dt-test',
      helmChartVersion: '2.0.14',
      overlayRef: 'refs/heads/main',
    });

    expect(client.items.put).toHaveBeenCalled();
    const updatedItem = client.items.put.mock.calls.at(-1)![0];
    expect(updatedItem.fields.map((field: any) => field.title)).toEqual(
      expect.arrayContaining([
        'detectionhub-dt-test__helm_chart_version',
        'detectionhub-dt-test__project_overlay_files_ref',
      ]),
    );
  });

  it('creates missing base64 certificate fields with valid self-signed certificate material', async () => {
    const { service, client } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'clientSecret: ref+op://Customers/sri/detectionhub-dt-test/client_secret__base64__\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [],
            sections: [],
          },
        ],
      },
    });

    await service.provisionSecrets({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      actorRef: 'user:default/test',
      role: 'platform-admin',
    });

    const savedItem = client.items.put.mock.calls.at(-1)![0];
    const generatedField = savedItem.fields.find(
      (field: any) => field.title === 'client_secret__base64__',
    );

    expect(generatedField).toBeTruthy();
    expect(generatedField.value).toMatch(/^[A-Za-z0-9+/=]+$/);

    const decoded = Buffer.from(generatedField.value, 'base64').toString(
      'utf8',
    );
    expect(decoded).toContain('BEGIN CERTIFICATE');
    expect(decoded).not.toContain('BEGIN PRIVATE KEY');
  });

  it('returns blocked when a required op reference is missing', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: op://CloudHubVault/dt-test/database/password\n',
      },
      itemsByVault: {
        CloudHubVault: [
          {
            id: 'dt-test',
            title: 'dt-test',
            fields: [],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(false);
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0].field).toBe('password');
  });

  it('maps CLOUDHUB_HELM_CHART_VERSION to Customers/<customer>/pipeline_refs/<namespace>__helm_chart_version', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/helmfile.yaml':
          'helm_chart_version: {{ env "CLOUDHUB_HELM_CHART_VERSION" }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'detectionhub-dt-test__helm_chart_version',
                title: 'detectionhub-dt-test__helm_chart_version',
                value: '1.0.2',
                sectionId: 'pipeline_refs',
                section: { id: 'pipeline_refs', title: 'pipeline_refs' },
              },
            ],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
    });

    expect(report.ready).toBe(true);
    expect(report.referencesDiscovered).toBe(1);
    expect(report.findings[0].status).toBe('READY');
    expect(report.findings[0].normalizedReference).toBe(
      'op://Customers/sri/pipeline_refs/detectionhub-dt-test__helm_chart_version',
    );
  });

  it('maps non-pipeline CLOUDHUB env keys to the runtime section <app>-<instance>', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/helmfile.yaml':
          'dbPassword: {{ env "CLOUDHUB_DB_PASSWORD" }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'db_password',
                title: 'db_password',
                value: 'super-secret',
                sectionId: 'detectionhub-dt-test',
                section: {
                  id: 'detectionhub-dt-test',
                  title: 'detectionhub-dt-test',
                },
              },
            ],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(true);
    expect(report.referencesDiscovered).toBe(1);
    expect(report.findings[0].normalizedReference).toBe(
      'op://Customers/sri/detectionhub-dt-test/db_password',
    );
  });

  it('maps ENV_* keys to the same runtime section convention as CLOUDHUB_* keys', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/helmfile.yaml':
          'dbPassword: {{ env "ENV_DB_PASSWORD" }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'db_password',
                title: 'db_password',
                value: 'super-secret',
                sectionId: 'detectionhub-dt-test',
                section: {
                  id: 'detectionhub-dt-test',
                  title: 'detectionhub-dt-test',
                },
              },
            ],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(true);
    expect(report.referencesDiscovered).toBe(1);
    expect(report.findings[0].normalizedReference).toBe(
      'op://Customers/sri/detectionhub-dt-test/db_password',
    );
  });

  it('extracts direct op references from fetchSecretValue calls', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: {{ fetchSecretValue "op://Customers/sri/detectionhub-dt-test/db_password" }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'db_password',
                title: 'db_password',
                value: 'super-secret',
                sectionId: 'detectionhub-dt-test',
                section: {
                  id: 'detectionhub-dt-test',
                  title: 'detectionhub-dt-test',
                },
              },
            ],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(true);
    expect(report.referencesDiscovered).toBe(1);
    expect(report.findings[0].normalizedReference).toBe(
      'op://Customers/sri/detectionhub-dt-test/db_password',
    );
  });

  it('extracts nested quoted ref+op URIs from Go templates', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          '{{- $secret := "ref+op://Customers/sri/detectionhub-dt-test/db_password" -}}\nvalue: {{ $secret }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'db_password',
                title: 'db_password',
                value: 'super-secret',
                sectionId: 'detectionhub-dt-test',
                section: {
                  id: 'detectionhub-dt-test',
                  title: 'detectionhub-dt-test',
                },
              },
            ],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(true);
    expect(report.referencesDiscovered).toBe(1);
    expect(report.findings[0].normalizedReference).toBe(
      'op://Customers/sri/detectionhub-dt-test/db_password',
    );
  });

  it('scans scp/apps helmfiles for CLOUDHUB env secret references', async () => {
    const { service } = makeService({
      files: {
        'scp/apps/netreveal/helmfile.yaml':
          'helm_chart_version: {{ env "CLOUDHUB_UPDATE_ME_NAMESPACE__HELM_CHART_VERSION" }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'netreveal-nr-sri-dev__helm_chart_version',
                title: 'netreveal-nr-sri-dev__helm_chart_version',
                value: '2.0.14',
                sectionId: 'pipeline_refs',
                section: { id: 'pipeline_refs', title: 'pipeline_refs' },
              },
            ],
            sections: [{ id: 'pipeline_refs', title: 'pipeline_refs' }],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'netreveal',
      instanceName: 'nr-sri-dev',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.referencesDiscovered).toBe(1);
    expect(report.filesScanned).toContain('scp/apps/netreveal/helmfile.yaml');
    expect(report.findings[0].normalizedReference).toBe(
      'op://Customers/sri/pipeline_refs/netreveal-nr-sri-dev__helm_chart_version',
    );
  });

  it('falls back to nr-<customer>-<env> convention section when no inline refs are found', async () => {
    const { service } = makeService({
      files: {
        'scp/apps/invhub/helmfile.yaml': 'values:\n  - envType: "dev"\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'db_password',
                title: 'db_password',
                value: 'super-secret',
                sectionId: 'nr-sri-dev',
                section: { id: 'nr-sri-dev', title: 'nr-sri-dev' },
              },
            ],
            sections: [{ id: 'nr-sri-dev', title: 'nr-sri-dev' }],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'invhub',
      instanceName: 'nr-sri-dev',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(true);
    expect(report.referencesDiscovered).toBe(1);
    expect(report.findings[0].normalizedReference).toBe(
      'op://Customers/sri/nr-sri-dev/db_password',
    );
    expect(report.summary).toMatch(/convention-based secret reference/i);
  });

  it('blocks multiline values for __base64__ fields', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'clientSecret: ref+op://Customers/sri/detectionhub-dt-test/client_secret__base64__\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'client_secret__base64__',
                title: 'client_secret__base64__',
                value: 'YWJj\nZGVm',
                sectionId: 'detectionhub-dt-test',
                section: {
                  id: 'detectionhub-dt-test',
                  title: 'detectionhub-dt-test',
                },
              },
            ],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(false);
    expect(report.findings[0].status).toBe('ERROR');
    expect(report.findings[0].message).toMatch(/single-line/i);
  });

  it('maps fetchSecretValue plain keys to the runtime section', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: {{ fetchSecretValue "db_password" }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'db_password',
                title: 'db_password',
                value: 'super-secret',
                sectionId: 'detectionhub-dt-test',
                section: {
                  id: 'detectionhub-dt-test',
                  title: 'detectionhub-dt-test',
                },
              },
            ],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(true);
    expect(report.referencesDiscovered).toBe(1);
    expect(report.findings[0].normalizedReference).toBe(
      'op://Customers/sri/detectionhub-dt-test/db_password',
    );
  });

  it('blocks env-based refs when pipeline mapping points to an unready chained target', async () => {
    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/helmfile.yaml':
          'project_overlay_branch: {{ env "CLOUDHUB_PROJECT_OVERLAY_BRANCH" }}\n',
      },
      itemsByVault: {
        Customers: [
          {
            id: 'sri',
            title: 'sri',
            fields: [
              {
                id: 'password',
                title: 'password',
                value: 'super-secret',
                sectionId: 'database',
                section: { id: 'database', title: 'database' },
              },
              {
                id: 'detectionhub-dt-test__project_overlay_branch',
                title: 'detectionhub-dt-test__project_overlay_branch',
                value: 'op://Customers/sri/detectionhub-dt-test/missing_secret',
                sectionId: 'pipeline_refs',
                section: { id: 'pipeline_refs', title: 'pipeline_refs' },
              },
            ],
            sections: [
              { id: 'database', title: 'database' },
              { id: 'pipeline_refs', title: 'pipeline_refs' },
            ],
          },
        ],
        CloudHubVault: [
          {
            id: 'dt-test',
            title: 'dt-test',
            fields: [
              {
                id: 'detectionhub-dt-test__project_overlay_branch',
                title: 'detectionhub-dt-test__project_overlay_branch',
                value: 'op://Customers/sri/detectionhub-dt-test/db_password',
                sectionId: 'pipeline_refs',
                section: { id: 'pipeline_refs', title: 'pipeline_refs' },
              },
            ],
            sections: [{ id: 'pipeline_refs', title: 'pipeline_refs' }],
          },
        ],
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(false);
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0].message).toMatch(/points to/i);
  });

  it('blocks readiness when service account token is missing', async () => {
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;

    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: op://Customers/sri/detectionhub-dt-test/db_password\n',
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(false);
    expect(report.summary).toMatch(/OP_SERVICE_ACCOUNT_TOKEN/i);
  });

  it('blocks readiness when service account auth is not configured', async () => {
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;

    const { service } = makeService({
      files: {
        'apps/detectionhub/dt-test/overrides.gotmpl':
          'dbPassword: op://Customers/sri/detectionhub-dt-test/db_password\n',
      },
    });

    const report = await service.check({
      application: 'detectionhub',
      instanceName: 'dt-test',
      customer: 'sri',
      forceRefresh: true,
    });

    expect(report.ready).toBe(false);
    expect(report.summary).toMatch(/OP_SERVICE_ACCOUNT_TOKEN/i);
  });

  describe('sections with opaque ids (as created in the 1Password UI)', () => {
    const helmfile = {
      'apps/invhub/dt-juber-poc3/helmfile.yaml':
        'version: {{ fetchSecretValue "helm_chart_version" }}\n' +
        'db: ref+op://Customers/sri/invhub-dt-juber-poc3/db_password\n',
    };
    const seed = (fields: any[] = []) => ({
      Customers: [
        {
          id: 'sri',
          title: 'sri',
          sections: [
            { id: 'k3xq7bzr2m4w', title: 'pipeline_refs' },
            { id: 'p9vd0a1sy6te', title: 'invhub-dt-juber-poc3' },
            { id: 'z1other00000', title: 'invhub-other-ns' },
          ],
          fields,
        },
      ],
    });

    it('reports fields in a title-named section as READY', async () => {
      const { service } = makeService({
        files: helmfile,
        itemsByVault: seed([
          {
            id: 'a1',
            title: 'invhub-dt-juber-poc3__helm_chart_version',
            value: '1.415.0',
            sectionId: 'k3xq7bzr2m4w',
          },
          {
            id: 'a2',
            title: 'db_password',
            value: 's3cret',
            sectionId: 'p9vd0a1sy6te',
          },
        ]),
      });

      const report = await service.check({
        application: 'invhub',
        instanceName: 'dt-juber-poc3',
        customer: 'sri',
      });

      expect(report.missing).toEqual([]);
      expect(report.ready).toBe(true);
    });

    it('verifies provisioned pipeline refs on read-back instead of reporting MISSING', async () => {
      const { service } = makeService({
        files: helmfile,
        itemsByVault: seed(),
      });

      const result = await service.provisionSecrets({
        application: 'invhub',
        instanceName: 'dt-juber-poc3',
        customer: 'sri',
        actorRef: 'user:default/test',
        role: 'platform-admin',
        applicationReleaseVersion: '1.411.0',
      });

      expect(result.verifiedFields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'invhub-dt-juber-poc3__helm_chart_version',
            verified: true,
          }),
          expect.objectContaining({ field: 'db_password', verified: true }),
        ]),
      );
      expect(result.readiness?.ready).toBe(true);
      expect(
        await service.getPipelineRefValue({
          customer: 'sri',
          namespace: 'invhub-dt-juber-poc3',
          field: 'helm_chart_version',
        }),
      ).toBe('1.411.0');
    });

    it('leaves a same-named field in another namespace section untouched', async () => {
      const { service, client } = makeService({
        files: helmfile,
        itemsByVault: seed([
          {
            id: 'db_password',
            title: 'db_password',
            value: 'other-ns',
            sectionId: 'z1other00000',
          },
        ]),
      });

      await service.provisionSecrets({
        application: 'invhub',
        instanceName: 'dt-juber-poc3',
        customer: 'sri',
        actorRef: 'user:default/test',
        role: 'platform-admin',
      });

      const saved = client.items.put.mock.calls.at(-1)![0];
      const passwords = saved.fields.filter(
        (f: any) => f.title === 'db_password',
      );
      expect(passwords).toHaveLength(2);
      expect(
        passwords.find((f: any) => f.sectionId === 'z1other00000').value,
      ).toBe('other-ns');
      expect(new Set(saved.fields.map((f: any) => f.id)).size).toBe(
        saved.fields.length,
      );
    });
  });

  describe('image pull secrets', () => {
    const originalUser = process.env.ACR_USERNAME;
    const originalPassword = process.env.ACR_PASSWORD;
    afterEach(() => {
      process.env.ACR_USERNAME = originalUser;
      process.env.ACR_PASSWORD = originalPassword;
      if (originalUser === undefined) delete process.env.ACR_USERNAME;
      if (originalPassword === undefined) delete process.env.ACR_PASSWORD;
    });

    const setup = () =>
      makeService({
        files: {
          'apps/invhub/dt-test/overrides.gotmpl':
            'pull: ref+op://Customers/sri/invhub-dt-test/dockerconfigjson\n',
        },
        itemsByVault: {
          Customers: [{ id: 'sri', title: 'sri', fields: [], sections: [] }],
        },
      });

    it('stringifies object values before writing dockerconfigjson to 1Password', async () => {
      process.env.ACR_USERNAME = 'puller';
      process.env.ACR_PASSWORD = 'pull-token';
      const { service, client } = setup();

      await service.provisionSecrets({
        application: 'invhub',
        instanceName: 'dt-test',
        customer: 'sri',
        actorRef: 'user:default/test',
        role: 'platform-admin',
      });

      const saved = client.items.put.mock.calls.at(-1)![0];
      const field = saved.fields.find(
        (f: any) => f.title === 'dockerconfigjson',
      );
      expect(typeof field.value).toBe('string');
      expect(JSON.parse(field.value).auths['sensaprodacr.azurecr.io']).toEqual({
        username: 'puller',
        password: 'pull-token',
        auth: Buffer.from('puller:pull-token').toString('base64'),
      });
    });

    it('builds a dockerconfigjson from ACR credentials without logging them', async () => {
      process.env.ACR_USERNAME = 'puller';
      process.env.ACR_PASSWORD = 'pull-token';
      const { service, client } = setup();
      const events: any[] = [];

      await service.provisionSecrets({
        application: 'invhub',
        instanceName: 'dt-test',
        customer: 'sri',
        actorRef: 'user:default/test',
        role: 'platform-admin',
        onProgress: (event: any) => events.push(event),
      });

      const saved = client.items.put.mock.calls.at(-1)![0];
      const field = saved.fields.find(
        (f: any) => f.title === 'dockerconfigjson',
      );
      const auth = JSON.parse(field.value).auths['sensaprodacr.azurecr.io'];
      expect(auth).toEqual({
        username: 'puller',
        password: 'pull-token',
        auth: Buffer.from('puller:pull-token').toString('base64'),
      });
      expect(JSON.stringify(events)).not.toContain('pull-token');
    });

    it('copies dockerconfigjson from an existing customer template when env vars are unset', async () => {
      delete process.env.ACR_USERNAME;
      delete process.env.ACR_PASSWORD;
      const { service, client } = makeService({
        files: {
          'apps/invhub/dt-test/overrides.gotmpl':
            'pull: ref+op://Customers/sri/invhub-dt-test/dockerconfigjson\n',
        },
        itemsByVault: {
          Customers: [
            {
              id: 'sri',
              title: 'sri',
              fields: [],
              sections: [],
            },
            {
              id: '_template',
              title: '_template',
              fields: [
                {
                  id: 'dockerconfigjson',
                  title: 'dockerconfigjson',
                  value: JSON.stringify({
                    auths: {
                      'sensaprodacr.azurecr.io': {
                        username: 'template-puller',
                        password: 'template-secret',
                        auth: Buffer.from(
                          'template-puller:template-secret',
                        ).toString('base64'),
                      },
                    },
                  }),
                },
              ],
              sections: [],
            },
          ],
        },
      });

      await service.provisionSecrets({
        application: 'invhub',
        instanceName: 'dt-test',
        customer: 'sri',
        actorRef: 'user:default/test',
        role: 'platform-admin',
      });

      const saved = client.items.put.mock.calls.at(-1)![0];
      const field = saved.fields.find(
        (f: any) => f.title === 'dockerconfigjson',
      );
      expect(JSON.parse(field.value).auths['sensaprodacr.azurecr.io']).toEqual({
        username: 'template-puller',
        password: 'template-secret',
        auth: Buffer.from('template-puller:template-secret').toString('base64'),
      });
    });

    it('skips the field with a warning instead of writing a fake credential', async () => {
      delete process.env.ACR_USERNAME;
      delete process.env.ACR_PASSWORD;
      const { service, client } = setup();
      const events: any[] = [];

      await service.provisionSecrets({
        application: 'invhub',
        instanceName: 'dt-test',
        customer: 'sri',
        actorRef: 'user:default/test',
        role: 'platform-admin',
        onProgress: (event: any) => events.push(event),
      });

      expect(client.items.put).not.toHaveBeenCalled();
      expect(events).toContainEqual(
        expect.objectContaining({
          status: 'WARNING',
          detail: expect.stringContaining('ACR_USERNAME'),
        }),
      );
    });
  });
});
