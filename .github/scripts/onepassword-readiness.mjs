import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const application = process.env.APPLICATION?.trim();
const instanceName = process.env.INSTANCE_NAME?.trim();
const customer = process.env.CUSTOMER?.trim();
const requireReferences =
  process.env.CLOUDHUB_1PASSWORD_REQUIRE_REFS !== 'false';
const vault = process.env.CLOUDHUB_1PASSWORD_VAULT?.trim() || 'Customers';
const files = [
  `apps/${application}/${instanceName}/overrides.gotmpl`,
  `apps/${application}/${instanceName}/namespace.overrides.gotmpl`,
  `apps/${application}/${instanceName}/helmfile.yaml`,
  `apps/${application}/overrides.gotmpl`,
  `apps/${application}/namespace.overrides.gotmpl`,
  `apps/${application}/helmfile.yaml`,
].filter(existsSync);

const result = {
  ready: false,
  checkedAt: new Date().toISOString(),
  cached: false,
  cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
  application,
  instanceName,
  customer,
  includePipelineRefs: true,
  filesScanned: files,
  referencesDiscovered: 0,
  findings: [],
  missing: [],
  placeholders: [],
  filePlaceholders: [],
  summary: '',
};

function finding(reference, status, message, section, field) {
  return {
    reference,
    normalizedReference: reference,
    vault,
    item: customer,
    section,
    field,
    status,
    message,
    sources: [],
  };
}

async function op(args) {
  const { stdout } = await execFileAsync('op', args, {
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function parseReference(raw) {
  const value = raw.replace(/^ref\+/i, '');
  if (!value.toLowerCase().startsWith('op://')) return null;
  const parts = value.slice(5).split('/').filter(Boolean);
  if (parts.length < 3) return null;
  return {
    reference: value,
    vault: parts[0],
    item: parts[1],
    section: parts.length > 3 ? parts.slice(2, -1).join('/') : null,
    field: parts.at(-1),
  };
}

async function checkReference(parsed) {
  try {
    const item = JSON.parse(
      await op([
        'item',
        'get',
        parsed.item,
        '--vault',
        parsed.vault,
        '--format',
        'json',
      ]),
    );
    const fields = Array.isArray(item.fields) ? item.fields : [];
    const field = fields.find(
      candidate =>
        (candidate.label || candidate.id) === parsed.field &&
        (!parsed.section ||
          (candidate.section?.label || candidate.section?.id) ===
            parsed.section),
    );
    if (!field) {
      return finding(
        parsed.reference,
        'MISSING',
        `Field '${parsed.field}' is missing in 1Password.`,
        parsed.section,
        parsed.field,
      );
    }
    const value = await op(['read', parsed.reference]);
    if (!value)
      return finding(
        parsed.reference,
        'EMPTY',
        'Field exists in 1Password but is empty.',
        parsed.section,
        parsed.field,
      );
    if (/\bUPDATE_ME[A-Z0-9_-]*\b/i.test(value)) {
      return finding(
        parsed.reference,
        'PLACEHOLDER',
        'Field value is still a placeholder.',
        parsed.section,
        parsed.field,
      );
    }
    return finding(
      parsed.reference,
      'READY',
      'Reference is present and populated.',
      parsed.section,
      parsed.field,
    );
  } catch (error) {
    return finding(
      parsed.reference,
      'MISSING',
      `Reference is missing or unreadable in 1Password: ${error.message}`,
      parsed.section,
      parsed.field,
    );
  }
}

await op(['--version']);
await op(['whoami', '--format', 'json']);
const references = new Map();
for (const file of files) {
  const content = await readFile(file, 'utf8');
  content.split(/\r?\n/).forEach((line, index) => {
    for (const raw of line.match(/(?:ref\+)?op:\/\/[^\s'"`)\]}>,]+/g) || []) {
      const parsed = parseReference(raw);
      if (parsed && !references.has(parsed.reference)) {
        parsed.source = { path: file, line: index + 1 };
        references.set(parsed.reference, parsed);
      }
    }
    for (const match of line.matchAll(/\bUPDATE_ME[A-Z0-9_-]*\b/g)) {
      result.filePlaceholders.push({
        path: file,
        line: index + 1,
        token: match[0],
      });
    }
  });
}
for (const parsed of references.values()) {
  const current = await checkReference(parsed);
  current.sources = [parsed.source];
  result.findings.push(current);
  if (current.status === 'MISSING' || current.status === 'ERROR')
    result.missing.push(current);
  if (current.status === 'EMPTY' || current.status === 'PLACEHOLDER')
    result.placeholders.push(current);
}
result.referencesDiscovered = result.findings.length;
result.ready =
  result.findings.every(item => item.status === 'READY') &&
  result.placeholders.length === 0 &&
  result.filePlaceholders.length === 0 &&
  (!requireReferences || result.referencesDiscovered > 0);
if (result.ready) {
  result.summary = `Ready. ${result.referencesDiscovered} secret reference(s) verified in 1Password.`;
} else if (result.missing.length) {
  result.summary = `${result.missing.length} secret reference(s) are missing from 1Password.`;
} else if (result.placeholders.length || result.filePlaceholders.length) {
  result.summary = `${
    result.placeholders.length + result.filePlaceholders.length
  } placeholder secret value(s) must be populated before deploy.`;
} else {
  result.summary = '1Password readiness could not be verified.';
}

console.log(
  `CLOUDHUB_READINESS_RESULT=${Buffer.from(
    JSON.stringify(result),
    'utf8',
  ).toString('base64')}`,
);
