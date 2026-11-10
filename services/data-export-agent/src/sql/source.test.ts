import { NonRetryableError } from '../errors';
import { FakeSourceClient } from '../__fixtures__/fakes';
import {
  applyGuardrails,
  GUARDRAIL_STATEMENTS,
  SourceConnector,
  sslOptions,
} from './source';

const pg = {
  host: 'replica',
  port: 5432,
  database: 'app',
  user: 'mi-role',
  sslMode: 'verify-full' as const,
};

describe('applyGuardrails', () => {
  it('runs the guardrails in order, then checks read-only', async () => {
    const client = new FakeSourceClient();
    await applyGuardrails(client);
    expect(client.statements.map(s => s.text)).toEqual([
      'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;',
      "SET statement_timeout='7200s';",
      'SHOW transaction_read_only',
    ]);
    expect(GUARDRAIL_STATEMENTS).toHaveLength(2);
  });

  it('refuses a session that is not read-only', async () => {
    const client = new FakeSourceClient();
    client.readOnly = 'off';
    await expect(applyGuardrails(client)).rejects.toThrow(NonRetryableError);
    await expect(applyGuardrails(client)).rejects.toThrow(/not read-only/);
  });

  it('strictly forbids connecting to writer or primary endpoints', async () => {
    const connector = new SourceConnector({
      pg: { ...pg, host: 'postgres-rw.internal' },
      tokens: { getToken: async () => 'token' },
      clientFactory: () => new FakeSourceClient(),
    });
    await expect(connector.connect()).rejects.toThrow(/strictly prohibited from connecting to writer/);
  });
});

describe('SourceConnector', () => {
  it('uses an AAD token for the PG scope as the password on every connection', async () => {
    const getToken = jest
      .fn()
      .mockResolvedValueOnce('token-1')
      .mockResolvedValueOnce('token-2');
    const configs: any[] = [];
    const connector = new SourceConnector({
      pg,
      tokens: { getToken },
      clientFactory: config => {
        configs.push(config);
        return new FakeSourceClient();
      },
    });
    await connector.connect();
    await connector.connect();
    expect(await configs[0].password()).toBe('token-1');
    expect(await configs[1].password()).toBe('token-2');
    expect(getToken).toHaveBeenCalledWith(
      'https://ossrdbms-aad.database.windows.net/.default',
    );
    expect(configs[0]).toMatchObject({
      host: 'replica',
      user: 'mi-role',
      database: 'app',
      ssl: { rejectUnauthorized: true },
    });
  });

  it('closes the connection when the guardrails fail', async () => {
    const client = new FakeSourceClient();
    client.readOnly = 'off';
    const connector = new SourceConnector({
      pg,
      tokens: { getToken: async () => 't' },
      clientFactory: () => client,
    });
    await expect(connector.connect()).rejects.toThrow(/not read-only/);
    expect(client.ended).toBe(true);
  });
});

describe('sslOptions', () => {
  it('maps PGSSLMODE', () => {
    expect(sslOptions({ sslMode: 'disable' })).toBe(false);
    expect(sslOptions({ sslMode: 'require' })).toEqual({
      rejectUnauthorized: false,
    });
    expect(sslOptions({ sslMode: 'verify-full' })).toEqual({
      rejectUnauthorized: true,
      ca: undefined,
    });
    const verifyCa = sslOptions(
      { sslMode: 'verify-ca', sslRootCertPath: '/ca.pem' },
      () => 'PEM',
    ) as any;
    expect(verifyCa.ca).toBe('PEM');
    expect(verifyCa.checkServerIdentity()).toBeUndefined();
  });
});
