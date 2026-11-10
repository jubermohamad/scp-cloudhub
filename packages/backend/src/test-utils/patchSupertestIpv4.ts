import { Server as TlsServer } from 'tls';
import type { Server } from 'http';

type PatchedSupertest = {
  _server?: Server;
  _cloudhubServerPath?: string;
  _cloudhubProtocol?: 'http' | 'https';
  url?: string;
  end?: (fn?: (err?: Error | null, res?: unknown) => void) => unknown;
  serverAddress: (app: any, path: string) => string;
};

export function patchSupertestIpv4() {
  const marker = '__cloudhubSupertestIpv4PatchApplied';
  const globalState = globalThis as Record<string, unknown>;

  if (globalState[marker]) {
    return;
  }

  // supertest defaults to app.listen(0) on the OS default interface. Some
  // environments only expose loopback via localhost and not a hard-coded IPv4
  // literal, so bind to localhost and keep the request URL aligned with the
  // active loopback family. The Node runtime may not report the port until the
  // listener emits the 'listening' event, so we defer the actual request until
  // that event fires.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SupertestTest = require('supertest/lib/test');
  const proto = SupertestTest.prototype as PatchedSupertest;
  const originalEnd = proto.end;

  proto.serverAddress = function serverAddress(app: any, path: string) {
    const resolved = app && typeof app.address === 'function' ? app.address() : null;
    if (resolved && typeof resolved !== 'string') {
      const protocol = app instanceof TlsServer ? 'https' : 'http';
      return `${protocol}://localhost:${resolved.port}${path}`;
    }

    const protocol = app instanceof TlsServer ? 'https' : 'http';
    this._cloudhubServerPath = path;
    this._cloudhubProtocol = protocol;

    const server = app.listen(0, 'localhost');
    this._server = server;

    return `${protocol}://localhost:0${path}`;
  };

  proto.end = function end(fn?: (err?: Error | null, res?: unknown) => void) {
    const server = this._server;
    if (!server || typeof server.once !== 'function') {
      return originalEnd?.call(this, fn);
    }

    const finalize = () => {
      const boundAddress = server.address();
      const port = boundAddress && typeof boundAddress !== 'string' ? boundAddress.port : null;
      if (port !== null && this._cloudhubProtocol && this._cloudhubServerPath) {
        this.url = `${this._cloudhubProtocol}://localhost:${port}${this._cloudhubServerPath}`;
      }
      return originalEnd?.call(this, fn);
    };

    const boundAddress = server.address();
    if (boundAddress && typeof boundAddress !== 'string') {
      return finalize();
    }

    server.once('listening', finalize);
    server.once('error', finalize);
    return this;
  };

  globalState[marker] = true;
}
