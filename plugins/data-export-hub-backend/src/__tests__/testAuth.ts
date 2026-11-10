import type express from 'express';

/**
 * Test doubles for Backstage auth. Requests carry `x-test-principal`:
 * - `user:<comma-separated ownership refs>` for a signed-in user;
 * - `service:<subject>` for a service or external (agent) token.
 * Missing header → no credentials. A principal type the route does not allow
 * fails the same way Backstage does (NotAllowedError).
 */
export function fakeAuth() {
  const httpAuth = {
    credentials: jest.fn(async (req: express.Request, options: { allow: string[] }) => {
      const header = req.headers['x-test-principal'] as string | undefined;
      if (!header) {
        const error = new Error('Missing credentials');
        error.name = 'AuthenticationError';
        throw error;
      }
      const [type, ...rest] = header.split(':');
      const value = rest.join(':');
      if (!options.allow.includes(type)) {
        const error = new Error(`This endpoint does not allow '${type}' credentials`);
        error.name = 'NotAllowedError';
        throw error;
      }
      return type === 'user'
        ? { principal: { type: 'user', userEntityRef: 'user:default/tester' }, groups: value ? value.split(',') : [] }
        : { principal: { type: 'service', subject: value } };
    }),
  } as any;
  const userInfo = {
    getUserInfo: jest.fn(async (credentials: any) => ({
      userEntityRef: credentials.groups.includes('group:default/other-user')
        ? 'user:default/other'
        : 'user:default/tester',
      ownershipEntityRefs: credentials.groups,
    })),
  } as any;
  return { httpAuth, userInfo };
}

export const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn((message: string) => process.stderr.write(`LOGGED ERROR: ${message}\n`)),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as any;

export const PLATFORM_ADMIN = 'user:group:default/cloudhub.dataexport.admin';
export const tenantAdmin = (tenant: string) => `user:group:default/cloudhub.dataexport.tenant.${tenant}.admin`;
export const tenantUser = (tenant: string) => `user:group:default/cloudhub.dataexport.tenant.${tenant}.user`;
export const agentToken = (objectId: string) => `service:external:data-export-agent:${objectId}`;
export const SCHEDULER = 'service:plugin:data-export-scheduler';
