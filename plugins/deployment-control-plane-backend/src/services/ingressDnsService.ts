import dns from 'dns/promises';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { IngressTarget } from '@internal/plugin-platform-common/backend';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const DNS_RECORD_TTL_SECONDS = 300;
const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export const HEALTH_CHECK_PATHS = [
  '/health',
  '/api/health',
  '/actuator/health',
] as const;

type FetchFn = typeof fetch;

interface CloudflareEnvelope<T> {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
}

interface CloudflareDnsRecord {
  id: string;
  content: string;
}

export interface IngressDnsResult {
  status: 'SKIPPED' | 'CREATED' | 'UPDATED' | 'UNCHANGED';
  fqdn: string;
  ip: string | null;
  propagated: boolean;
  message: string;
}

export interface HealthProbeAttempt {
  path: string;
  statusCode: number | null;
  error: string | null;
}

export interface HealthProbeResult {
  healthy: boolean;
  url: string;
  healthyPath: string | null;
  attempts: HealthProbeAttempt[];
  checkedAt: string;
}

export interface IngressDnsServiceOptions {
  fetchImpl?: FetchFn;
  resolve4?: (hostname: string) => Promise<string[]>;
  sleep?: (ms: number) => Promise<void>;
  propagationAttempts?: number;
  propagationIntervalMs?: number;
  healthProbeTimeoutMs?: number;
}

/**
 * Parses CLOUDHUB_CLUSTER_INGRESS_IPS, a JSON object mapping AKS kube
 * context / cluster name to the public IP of its NGINX ingress load
 * balancer, e.g. {"uk-eng-dev":"51.12.84.190"}.
 */
export function configuredIngressIps(
  raw = process.env.CLOUDHUB_CLUSTER_INGRESS_IPS,
): Record<string, string> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('CLOUDHUB_CLUSTER_INGRESS_IPS must be a JSON object.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CLOUDHUB_CLUSTER_INGRESS_IPS must be a JSON object.');
  }
  const result: Record<string, string> = {};
  for (const [cluster, ip] of Object.entries(parsed)) {
    if (typeof ip !== 'string' || !IPV4_RE.test(ip.trim())) {
      throw new Error(
        `CLOUDHUB_CLUSTER_INGRESS_IPS has an invalid IPv4 address for ${cluster}.`,
      );
    }
    result[cluster] = ip.trim();
  }
  return result;
}

/** First non-templated `kubeContext:` value, as the deploy workflow reads it. */
export function parseKubeContext(helmfile: string): string | null {
  for (const match of helmfile.matchAll(/^\s+kubeContext:\s*(.+)$/gm)) {
    const value = match[1]
      .split('#')[0]
      .trim()
      .replace(/^["']|["']$/g, '');
    if (value && !value.includes('{{')) return value;
  }
  return null;
}

function zoneIdEnvName(zone: string): string {
  return `CLOUDFLARE_ZONE_ID_${zone.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export class IngressDnsService {
  private readonly fetchImpl: FetchFn;
  private readonly resolve4: (hostname: string) => Promise<string[]>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly propagationAttempts: number;
  private readonly propagationIntervalMs: number;
  private readonly healthProbeTimeoutMs: number;
  private readonly zoneIds = new Map<string, string>();

  constructor(
    private readonly logger: LoggerService,
    options: IngressDnsServiceOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolve4 = options.resolve4 ?? (host => dns.resolve4(host));
    this.sleep =
      options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.propagationAttempts = options.propagationAttempts ?? 10;
    this.propagationIntervalMs = options.propagationIntervalMs ?? 2000;
    this.healthProbeTimeoutMs = options.healthProbeTimeoutMs ?? 5000;
  }

  private apiToken(): string | null {
    return process.env.CLOUDFLARE_API_TOKEN?.trim() || null;
  }

  isConfigured(): boolean {
    return this.apiToken() !== null;
  }

  private async cloudflare<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${CLOUDFLARE_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiToken()}`,
        'Content-Type': 'application/json',
      },
    });
    let body: CloudflareEnvelope<T> | null = null;
    try {
      body = (await response.json()) as CloudflareEnvelope<T>;
    } catch {
      // handled below
    }
    if (!response.ok || !body?.success) {
      const detail =
        body?.errors
          ?.map(error => error.message)
          .filter(Boolean)
          .join(', ') || `HTTP ${response.status}`;
      throw new Error(`Cloudflare API ${init.method ?? 'GET'} failed: ${detail}`);
    }
    return body.result as T;
  }

  /**
   * symphonyai.dev and symphonyai.cloud are separate Cloudflare zones.
   * CLOUDFLARE_ZONE_ID_SYMPHONYAI_DEV / _CLOUD pin the IDs (needed when the
   * token lacks Zone:Read); otherwise the zone is looked up by name.
   */
  private async zoneId(zone: string): Promise<string> {
    const pinned = process.env[zoneIdEnvName(zone)]?.trim();
    if (pinned) return pinned;
    const cached = this.zoneIds.get(zone);
    if (cached) return cached;
    const zones = await this.cloudflare<Array<{ id: string; name: string }>>(
      `/zones?name=${encodeURIComponent(zone)}`,
    );
    const id = zones?.find(candidate => candidate.name === zone)?.id;
    if (!id) {
      throw new Error(
        `Cloudflare zone ${zone} is not visible to CLOUDFLARE_API_TOKEN; set ${zoneIdEnvName(
          zone,
        )}.`,
      );
    }
    this.zoneIds.set(zone, id);
    return id;
  }

  resolveIngressIp(clusterNames: Array<string | null | undefined>): {
    cluster: string;
    ip: string;
  } | null {
    const ips = configuredIngressIps();
    for (const cluster of clusterNames) {
      if (cluster && ips[cluster]) return { cluster, ip: ips[cluster] };
    }
    return null;
  }

  /**
   * Pre-flight DNS gate: upserts the A record before helmfile apply so
   * cert-manager's HTTP-01 challenge and the ingress host resolve on first
   * reconcile. Skips (does not fail) when Cloudflare is not configured, so
   * environments without DNS automation can still deploy.
   */
  async ensureARecord(input: {
    target: IngressTarget;
    clusterNames: Array<string | null | undefined>;
  }): Promise<IngressDnsResult> {
    const { fqdn, zone } = input.target;
    if (!this.apiToken()) {
      return {
        status: 'SKIPPED',
        fqdn,
        ip: null,
        propagated: false,
        message: `CLOUDFLARE_API_TOKEN is not configured; DNS for ${fqdn} was not managed by CloudHub.`,
      };
    }

    const ingress = this.resolveIngressIp(input.clusterNames);
    if (!ingress) {
      const candidates = input.clusterNames.filter(Boolean).join(', ');
      throw new Error(
        `No ingress IP is configured for cluster ${
          candidates || '(unknown)'
        }. Add it to CLOUDHUB_CLUSTER_INGRESS_IPS before deploying.`,
      );
    }

    const zoneId = await this.zoneId(zone);
    const existing = await this.cloudflare<CloudflareDnsRecord[]>(
      `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(fqdn)}`,
    );
    const record = {
      type: 'A',
      name: fqdn,
      content: ingress.ip,
      ttl: DNS_RECORD_TTL_SECONDS,
      // AKS ingress + cert-manager terminate TLS; Cloudflare must not proxy.
      proxied: false,
    };

    let status: IngressDnsResult['status'];
    const current = existing?.[0];
    if (current && current.content === ingress.ip) {
      status = 'UNCHANGED';
    } else if (current) {
      await this.cloudflare(`/zones/${zoneId}/dns_records/${current.id}`, {
        method: 'PUT',
        body: JSON.stringify(record),
      });
      status = 'UPDATED';
    } else {
      await this.cloudflare(`/zones/${zoneId}/dns_records`, {
        method: 'POST',
        body: JSON.stringify(record),
      });
      status = 'CREATED';
    }

    const propagated = await this.waitForPropagation(fqdn, ingress.ip);
    const verb = status.toLowerCase();
    return {
      status,
      fqdn,
      ip: ingress.ip,
      propagated,
      message: propagated
        ? `DNS A record ${fqdn} → ${ingress.ip} (${ingress.cluster}) ${verb} and resolving.`
        : `DNS A record ${fqdn} → ${ingress.ip} (${ingress.cluster}) ${verb}; not yet resolving locally, continuing (TTL ${DNS_RECORD_TTL_SECONDS}s).`,
    };
  }

  private async waitForPropagation(fqdn: string, ip: string): Promise<boolean> {
    for (let attempt = 0; attempt < this.propagationAttempts; attempt += 1) {
      try {
        if ((await this.resolve4(fqdn)).includes(ip)) return true;
      } catch {
        // NXDOMAIN until the record propagates
      }
      if (attempt < this.propagationAttempts - 1) {
        await this.sleep(this.propagationIntervalMs);
      }
    }
    this.logger.warn(`[control-plane] DNS for ${fqdn} did not resolve to ${ip}`);
    return false;
  }

  /**
   * One probe round over the standard health paths. Redirects are not
   * followed (a 302 to a login page is not "healthy"), and the URL is always
   * derived from the canonical ingress target, never from caller input.
   */
  async probeHealth(target: IngressTarget): Promise<HealthProbeResult> {
    const attempts: HealthProbeAttempt[] = [];
    for (const path of HEALTH_CHECK_PATHS) {
      try {
        const response = await this.fetchImpl(`${target.url}${path}`, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(this.healthProbeTimeoutMs),
        });
        attempts.push({ path, statusCode: response.status, error: null });
        if (response.status === 200) {
          return {
            healthy: true,
            url: target.url,
            healthyPath: path,
            attempts,
            checkedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        attempts.push({
          path,
          statusCode: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      healthy: false,
      url: target.url,
      healthyPath: null,
      attempts,
      checkedAt: new Date().toISOString(),
    };
  }
}
