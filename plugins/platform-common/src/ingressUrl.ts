// Canonical ingress URL for a deployed app instance. Shared by the wizard
// (URL preview, live link) and the control-plane backend (Cloudflare DNS,
// health checks) so every layer agrees on one hostname:
//
//   https://{app}-{customer}-{suffix}.symphonyai.dev    (non-prod)
//   https://{app}-{customer}-{suffix}.symphonyai.cloud  (prod)
//
// {suffix} is the instance name with any leading app name, app alias
// (pipeline-internal instances are named `{alias}-{customer}-{env}`, e.g.
// `ih-abanca-dev`) and customer code removed.

export const NON_PROD_INGRESS_ZONE = 'symphonyai.dev';
export const PROD_INGRESS_ZONE = 'symphonyai.cloud';

const APP_INSTANCE_ALIASES: Record<string, string[]> = {
  'ai-store': ['ais'],
  detectionhub: ['dt'],
  'edb-netrevealv96': ['nr'],
  invhub: ['ih'],
  netreveal: ['nr'],
  netrevealv95: ['nr'],
  netrevealv96: ['nr', 'nr96'],
  'sales-genie': ['sg'],
  'sensaai-sanctions': ['sais'],
};

// RFC 1123 labels are capped at 63 characters.
const MAX_DNS_LABEL_LENGTH = 63;

export interface IngressTarget {
  hostname: string;
  zone: string;
  fqdn: string;
  url: string;
}

function toDnsLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripPrefix(value: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    if (prefix && value.startsWith(`${prefix}-`)) {
      return value.slice(prefix.length + 1);
    }
  }
  return value;
}

export function isProductionEnvironment(environment?: string | null): boolean {
  const normalized = (environment ?? '').trim().toLowerCase();
  return normalized === 'prod' || normalized === 'production';
}

/**
 * Returns null when the inputs cannot produce a valid hostname, so callers
 * never publish DNS records or links for a half-filled form.
 */
export function calculateIngressTarget(input: {
  application?: string | null;
  customer?: string | null;
  instanceName?: string | null;
  environment?: string | null;
}): IngressTarget | null {
  const app = toDnsLabel(input.application ?? '');
  const customer = toDnsLabel(input.customer ?? '');
  const instance = toDnsLabel(input.instanceName ?? '');
  if (!app || !customer || !instance) {
    return null;
  }

  const withoutApp = stripPrefix(instance, [
    app,
    ...(APP_INSTANCE_ALIASES[app] ?? []),
  ]);
  const suffix = stripPrefix(withoutApp, [customer]);
  const hostname = toDnsLabel(
    suffix && suffix !== customer
      ? `${app}-${customer}-${suffix}`
      : `${app}-${customer}`,
  );
  if (hostname.length > MAX_DNS_LABEL_LENGTH) {
    return null;
  }

  const zone = isProductionEnvironment(input.environment)
    ? PROD_INGRESS_ZONE
    : NON_PROD_INGRESS_ZONE;
  const fqdn = `${hostname}.${zone}`;
  return { hostname, zone, fqdn, url: `https://${fqdn}` };
}
