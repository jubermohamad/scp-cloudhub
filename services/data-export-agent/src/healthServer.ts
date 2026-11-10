/**
 * Liveness and readiness endpoints for the kubelet. The agent has no other
 * inbound traffic, so this server answers only GET /healthz and GET /readyz.
 */
import http from 'http';

export interface HealthState {
  /** false once the agent loop is wedged and the pod should be restarted. */
  isLive(): boolean;
  /** true after a recent successful heartbeat. */
  isReady(): boolean;
}

export function startHealthServer(
  port: number,
  state: HealthState,
  host = '0.0.0.0',
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    const reply = (ok: boolean) => {
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'unavailable' }));
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
    } else if (url === '/healthz') {
      reply(state.isLive());
    } else if (url === '/readyz') {
      reply(state.isReady());
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
