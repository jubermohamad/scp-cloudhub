import { createHash } from 'crypto';
import { silentLogger } from '../logger';
import { NonRetryableError } from '../errors';
import {
  hostKeyFingerprint,
  remoteJoin,
  SftpClientLike,
  SftpProvider,
} from './sftp';

const hostKey = Buffer.from('fake-ssh-ed25519-host-key-blob');
const goodFingerprint = `SHA256:${createHash('sha256')
  .update(hostKey)
  .digest('base64')
  .replace(/=+$/, '')}`;
const otherFingerprint = `SHA256:${createHash('sha256')
  .update('other')
  .digest('base64')
  .replace(/=+$/, '')}`;

const config = {
  host: 'sftp.example.com',
  port: '2222',
  username: 'exporter',
  remotePath: '/upload/base',
  secretRef: 'kv://my-vault/sftp-key',
  hostKeyFingerprint: goodFingerprint,
};

class FakeSftp implements SftpClientLike {
  ops: string[] = [];
  connectOptions?: any;
  existing = new Set<string>();
  verified?: boolean;
  constructor(private readonly presentedKey = hostKey) {}
  async connect(options: any) {
    this.connectOptions = options;
    this.verified = options.hostVerifier(this.presentedKey);
    if (!this.verified) throw new Error('Host denied (verification failed)');
    this.ops.push('connect');
  }
  async mkdir(p: string, recursive?: boolean) {
    this.ops.push(`mkdir ${p} ${recursive}`);
  }
  async put(local: string, remote: string) {
    this.ops.push(`put ${local} ${remote}`);
  }
  async rename(a: string, b: string) {
    this.ops.push(`rename ${a} ${b}`);
  }
  async exists(p: string) {
    return this.existing.has(p) ? '-' : false;
  }
  async delete(p: string) {
    this.ops.push(`delete ${p}`);
  }
  async stat(p: string) {
    this.ops.push(`stat ${p}`);
    return {};
  }
  async end() {
    this.ops.push('end');
  }
}

const secrets = {
  resolve: jest.fn(
    async () =>
      '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----',
  ),
};
const file = (name: string) => ({
  name,
  localPath: `/work/${name}`,
  sizeBytes: 5,
  sha256: 'e'.repeat(64),
});

describe('SftpProvider', () => {
  it('computes OpenSSH SHA256 fingerprints', () => {
    expect(hostKeyFingerprint(hostKey)).toBe(goodFingerprint);
    expect(goodFingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it('validates config and insists on a host key fingerprint', () => {
    const p = new SftpProvider(secrets);
    expect(p.validate(config)).toEqual([]);
    const { hostKeyFingerprint: _omit, ...noFingerprint } = config;
    expect(p.validate(noFingerprint).join()).toMatch(
      /hostKeyFingerprint is required/,
    );
    expect(
      p.validate({ ...config, hostKeyFingerprint: 'MD5:aa:bb' }).join(),
    ).toMatch(/SHA256/);
    expect(
      p.validate({ ...config, secretRef: 'plain-password' }).join(),
    ).toMatch(/secretRef/);
    expect(p.validate({ ...config, port: '0' }).join()).toMatch(/port/);
    expect(p.validate({ ...config, remotePath: '/a/../b' }).join()).toMatch(
      /remotePath/,
    );
  });

  it('uploads each file as .part then renames, creating directories recursively', async () => {
    const sftp = new FakeSftp();
    sftp.existing.add('/upload/base/t/job-1/manifest.json');
    const p = new SftpProvider(secrets, () => sftp);
    const delivered = await p.upload(
      [file('a.csv'), file('checksum.sha256'), file('manifest.json')],
      {
        config,
        outputPrefix: 't/job-1',
        logger: silentLogger,
      },
    );
    expect(secrets.resolve).toHaveBeenCalledWith('kv://my-vault/sftp-key');
    expect(sftp.connectOptions).toMatchObject({
      host: 'sftp.example.com',
      port: 2222,
      username: 'exporter',
    });
    expect(sftp.connectOptions.privateKey).toContain('PRIVATE KEY');
    expect(sftp.connectOptions.password).toBeUndefined();
    expect(sftp.verified).toBe(true);
    expect(sftp.ops).toEqual([
      'connect',
      'mkdir /upload/base/t/job-1 true',
      'put /work/a.csv /upload/base/t/job-1/a.csv.part',
      'rename /upload/base/t/job-1/a.csv.part /upload/base/t/job-1/a.csv',
      'put /work/checksum.sha256 /upload/base/t/job-1/checksum.sha256.part',
      'rename /upload/base/t/job-1/checksum.sha256.part /upload/base/t/job-1/checksum.sha256',
      'put /work/manifest.json /upload/base/t/job-1/manifest.json.part',
      'delete /upload/base/t/job-1/manifest.json',
      'rename /upload/base/t/job-1/manifest.json.part /upload/base/t/job-1/manifest.json',
      'end',
    ]);
    expect(delivered.map(d => d.path)).toEqual([
      '/upload/base/t/job-1/a.csv',
      '/upload/base/t/job-1/checksum.sha256',
      '/upload/base/t/job-1/manifest.json',
    ]);
  });

  it('refuses a server whose host key does not match', async () => {
    const sftp = new FakeSftp(Buffer.from('attacker-key'));
    const p = new SftpProvider(secrets, () => sftp);
    const err = await p
      .upload([file('a.csv')], {
        config,
        outputPrefix: 'x',
        logger: silentLogger,
      })
      .catch(e => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(err.message).toMatch(/host key verification failed/);
    expect(sftp.ops).not.toContain('mkdir /upload/base/x true');
  });

  it('accepts any fingerprint from a comma-separated list (key rotation)', async () => {
    const sftp = new FakeSftp();
    const p = new SftpProvider(secrets, () => sftp);
    const res = await p.healthCheck({
      ...config,
      hostKeyFingerprint: `${otherFingerprint}, ${goodFingerprint}`,
    });
    expect(res.status).toBe('HEALTHY');
    expect(sftp.ops).toEqual(['connect', 'stat /upload/base', 'end']);
  });

  it('refuses to connect without a fingerprint, even when validation is bypassed', async () => {
    const factory = jest.fn(() => new FakeSftp());
    const p = new SftpProvider(secrets, factory);
    const { hostKeyFingerprint: _omit, ...noFingerprint } = config;
    await expect(
      p.upload([file('a')], {
        config: noFingerprint,
        outputPrefix: 'x',
        logger: silentLogger,
      }),
    ).rejects.toThrow(/without hostKeyFingerprint/);
    expect(factory).not.toHaveBeenCalled();
    expect((await p.healthCheck(noFingerprint)).status).toBe('FAILED');
  });

  it('health check fails on a host key mismatch', async () => {
    const p = new SftpProvider(
      secrets,
      () => new FakeSftp(Buffer.from('other')),
    );
    const res = await p.healthCheck(config);
    expect(res.status).toBe('FAILED');
    expect(res.message).toMatch(/host key verification failed/);
  });

  it('joins remote paths safely', () => {
    expect(remoteJoin('/upload/', 'a/b/', 'c')).toBe('/upload/a/b/c');
    expect(remoteJoin('upload', 'a')).toBe('upload/a');
    expect(() => remoteJoin('/upload', '../etc')).toThrow();
  });
});
