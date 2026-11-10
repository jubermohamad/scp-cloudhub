import { createDataExportApi, DataExportApiError, toQueryString } from '../api';
import {
  canCancelJob,
  canCreateInAnyTenant,
  canManageTenant,
  canRetryJob,
  hasNoAccess,
  manageableTenants,
} from '../utils';
import { HUB_NAV, hubPaths, sectionForPath } from '../routes';
import type { Me } from '../types';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const page = { items: [], total: 0, page: 0, pageSize: 25 };

describe('createDataExportApi', () => {
  it('calls the data-export plugin with the expected path and method', async () => {
    const backendFetch = jest.fn(async () => jsonResponse(202, []));
    const api = createDataExportApi(backendFetch);

    await api.runExportNow('11111111-1111-4111-8111-111111111111');

    expect(backendFetch).toHaveBeenCalledWith(
      'data-export',
      '/exports/11111111-1111-4111-8111-111111111111/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('serialises paged list queries and drops empty filters', async () => {
    const backendFetch = jest.fn(
      async (_plugin: string, _path: string, _init?: RequestInit) =>
        jsonResponse(200, page),
    );
    const api = createDataExportApi(backendFetch);

    await api.listJobs({
      page: 2,
      pageSize: 50,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      status: 'FAILED',
      exportId: undefined,
      search: '',
    });

    expect(backendFetch).toHaveBeenCalledWith(
      'data-export',
      '/jobs?page=2&pageSize=50&sortBy=createdAt&sortOrder=desc&status=FAILED',
      expect.anything(),
    );
  });

  it('keeps zero and false values in query strings', () => {
    expect(toQueryString({ page: 0, includeRetired: false })).toBe(
      '?page=0&includeRetired=false',
    );
    expect(toQueryString({})).toBe('');
  });

  it('surfaces server validation details on the thrown error', async () => {
    const backendFetch = jest.fn(async () =>
      jsonResponse(400, {
        error: 'Validation failed',
        details: ['tenant is required'],
      }),
    );
    const api = createDataExportApi(backendFetch);

    await expect(api.createExport({} as never)).rejects.toMatchObject({
      status: 400,
      message: 'Validation failed',
      details: ['tenant is required'],
    });
  });

  it('returns undefined for 204 responses such as delete', async () => {
    const backendFetch = jest.fn(async () => jsonResponse(204, undefined));
    const api = createDataExportApi(backendFetch);
    await expect(api.deleteExport('abc')).resolves.toBeUndefined();
  });

  it('downloads manifests and logs as raw text', async () => {
    const backendFetch = jest.fn(
      async () => new Response('line 1\nline 2', { status: 200 }),
    );
    const api = createDataExportApi(backendFetch);
    await expect(api.downloadLogs('job-1')).resolves.toBe('line 1\nline 2');
    expect(backendFetch).toHaveBeenCalledWith(
      'data-export',
      '/jobs/job-1/logs',
    );
  });

  it('exposes DataExportApiError with an HTTP status', () => {
    const error = new DataExportApiError(403, 'Forbidden');
    expect(error.status).toBe(403);
    expect(error.name).toBe('DataExportApiError');
  });
});

describe('tenant permissions in the UI', () => {
  const tenantAdmin: Me = {
    actor: 'u',
    isPlatformAdmin: false,
    tenantAdminOf: ['visa'],
    tenantMemberOf: ['tabcorp', 'visa'],
  };
  const tenantUser: Me = {
    actor: 'r',
    isPlatformAdmin: false,
    tenantAdminOf: [],
    tenantMemberOf: ['visa'],
  };
  const platformAdmin: Me = {
    actor: 'p',
    isPlatformAdmin: true,
    tenantAdminOf: [],
    tenantMemberOf: [],
  };
  const outsider: Me = {
    actor: 'o',
    isPlatformAdmin: false,
    tenantAdminOf: [],
    tenantMemberOf: [],
  };

  it('mirrors the backend manage rule, including shared resources', () => {
    expect(canManageTenant(tenantAdmin, 'visa')).toBe(true);
    expect(canManageTenant(tenantAdmin, 'tabcorp')).toBe(false);
    expect(canManageTenant(tenantAdmin, null)).toBe(false);
    expect(canManageTenant(tenantUser, 'visa')).toBe(false);
    expect(canManageTenant(platformAdmin, null)).toBe(true);
    expect(canManageTenant(undefined, 'visa')).toBe(false);
  });

  it('offers tenant admins their own tenants and platform admins every visible tenant', () => {
    expect(manageableTenants(tenantAdmin, ['zeta', 'acme'])).toEqual(['visa']);
    expect(manageableTenants(platformAdmin, ['zeta', 'acme', 'zeta'])).toEqual([
      'acme',
      'zeta',
    ]);
    expect(manageableTenants(undefined, ['acme'])).toEqual([]);
  });

  it('only lets admins create', () => {
    expect(canCreateInAnyTenant(tenantAdmin)).toBe(true);
    expect(canCreateInAnyTenant(platformAdmin)).toBe(true);
    expect(canCreateInAnyTenant(tenantUser)).toBe(false);
    expect(canCreateInAnyTenant(undefined)).toBe(false);
  });

  it('offers retry for failed or cancelled jobs and cancel for live ones', () => {
    const job = (status: Parameters<typeof canRetryJob>[1]['status']) => ({
      status,
      tenantId: 'visa',
    });
    expect(canRetryJob(tenantAdmin, job('FAILED'))).toBe(true);
    expect(canRetryJob(tenantAdmin, job('CANCELLED'))).toBe(true);
    expect(canRetryJob(tenantAdmin, job('COMPLETED'))).toBe(false);
    expect(canRetryJob(tenantUser, job('FAILED'))).toBe(false);
    for (const status of [
      'CREATED',
      'QUEUED',
      'ASSIGNED',
      'RUNNING',
      'UPLOADING',
    ] as const) {
      expect(canCancelJob(tenantAdmin, job(status))).toBe(true);
    }
    expect(canCancelJob(tenantAdmin, job('COMPLETED'))).toBe(false);
    expect(
      canCancelJob(tenantAdmin, { status: 'RUNNING', tenantId: 'other' }),
    ).toBe(false);
  });

  it('flags callers with no tenant access', () => {
    expect(hasNoAccess(outsider)).toBe(true);
    expect(hasNoAccess(tenantUser)).toBe(false);
    expect(hasNoAccess(platformAdmin)).toBe(false);
    expect(hasNoAccess(undefined)).toBe(false);
  });
});

describe('hub routes', () => {
  it('maps pathnames to their section, including detail pages', () => {
    expect(sectionForPath('/data-export-hub')).toBe('exports');
    expect(sectionForPath('/data-export-hub/')).toBe('exports');
    expect(sectionForPath('/dashboard')).toBe('dashboard');
    expect(sectionForPath('/data-export-hub/executions')).toBe('executions');
    expect(sectionForPath('/data-export-hub/datasets/abc')).toBe('datasets');
    expect(sectionForPath('/data-export-hub/unknown')).toBe('exports');
  });

  it('keeps the customer-centric hub tabs on Data Export Hub and encodes detail ids', () => {
    expect(HUB_NAV.map(item => item.label)).toEqual([
      'Exports',
      'Executions',
      'Clusters',
      'Agents',
      'Administration',
    ]);
    expect(
      HUB_NAV.filter(item => item.adminOnly).map(item => item.key),
    ).toEqual(['administration']);
    expect(hubPaths.dashboard).toBe('/dashboard');
    expect(hubPaths.datasetDetail('a/b')).toBe(
      '/data-export-hub/datasets/a%2Fb',
    );
  });
});
