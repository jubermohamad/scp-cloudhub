import fs from 'fs';
import nodePath from 'path';

/**
 * Release Catalog Service — Maps app versions to their auto-populated pipeline pointers.
 *
 * This service eliminates manual entry of:
 * - Helm chart versions
 * - Git commit SHAs for values files
 * - Overlay branches
 * - Sub-component versions
 *
 * When a user selects "Investigation Hub 1.415.0", CloudHub automatically derives
 * all 4 pipeline pointers + generates secrets in a single "Auto-Generate Secrets" click.
 */

/**
 * Component release pointers for a specific version.
 * Maps from version → resolved values for all pipeline fields.
 */
export interface ComponentReleasePointers {
  helmChartVersion: string;
  valuesFileCommitSha: string;
  defaultOverlayRef: string;
  subComponents: Record<string, string>;
}

/**
 * Release Catalog Matrix: app → version → pointers.
 *
 * To add a new release:
 * 1. Update investigation-hub entry with new version
 * 2. Add corresponding commit SHA from values-file branch
 * 3. Update entity_resolution_chart_version subcomponent
 * 4. Frontend preset selector in DeploymentWizard will auto-discover
 */
export const APP_RELEASE_MATRIX: Record<
  string,
  Record<string, ComponentReleasePointers>
> = {
  'common-res': {
    '2.1.3': {
      helmChartVersion: '2.1.3',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '2.1.0': {
      helmChartVersion: '2.1.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '2.0.1': {
      helmChartVersion: '2.0.1',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '2.0.0': {
      helmChartVersion: '2.0.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '1.6.0': {
      helmChartVersion: '1.6.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '1.5.0': {
      helmChartVersion: '1.5.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  'investigation-hub': {
    '1.415.0': {
      helmChartVersion: '1.415.0',
      // Commit SHA from https://github.com/SymphonyAI/investigation-hub/commits/values-files-1.415.0
      valuesFileCommitSha: 'c67127e1cdc4fe8bd2d4957e8492040b59b58169',
      defaultOverlayRef: 'main',
      subComponents: {
        entity_resolution_chart_version: '1.415.0',
      },
    },
    '1.411.0': {
      helmChartVersion: '1.411.0',
      valuesFileCommitSha: 'e441c092bb83011a09dc281903498acbd12048aa',
      defaultOverlayRef: 'main',
      subComponents: {
        entity_resolution_chart_version: '1.411.0',
      },
    },
    '1.408.0': {
      helmChartVersion: '1.408.0',
      valuesFileCommitSha: '918237dbce827361829038472910384758291028',
      defaultOverlayRef: 'main',
      subComponents: {
        entity_resolution_chart_version: '1.408.0',
      },
    },
  },
  detectionhub: {
    '1.4.0': {
      helmChartVersion: '1.4.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {
        entity_resolution_chart_version: '1.4.0',
      },
    },
    '1.3.2': {
      helmChartVersion: '1.3.2',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {
        entity_resolution_chart_version: '1.3.2',
      },
    },
    '1.2.0': {
      helmChartVersion: '1.2.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {
        entity_resolution_chart_version: '1.2.0',
      },
    },
  },
  flows: {
    '0.9.4': {
      helmChartVersion: '0.9.4',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '0.9.1': {
      helmChartVersion: '0.9.1',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '0.1.30': {
      helmChartVersion: '0.1.30',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  'ai-store': {
    '2.3.1': {
      helmChartVersion: '2.3.1',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '2.2.0': {
      helmChartVersion: '2.2.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '2.1.0': {
      helmChartVersion: '2.1.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '1.2.5': {
      helmChartVersion: '1.2.5',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  netrevealv96: {
    '9.6.1': {
      helmChartVersion: '9.6.1',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '9.6.0': {
      helmChartVersion: '9.6.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  netrevealv95: {
    '9.5.1': {
      helmChartVersion: '9.5.1',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '9.5.0': {
      helmChartVersion: '9.5.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  netreveal: {
    '9.4.0': {
      helmChartVersion: '9.4.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '9.3.0': {
      helmChartVersion: '9.3.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  datadog: {
    '3.10.0': {
      helmChartVersion: '3.10.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '3.9.0': {
      helmChartVersion: '3.9.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  velero: {
    '5.1.0': {
      helmChartVersion: '5.1.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '5.0.0': {
      helmChartVersion: '5.0.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  dxv: {
    '1.0.1': {
      helmChartVersion: '1.0.1',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '1.0.0': {
      helmChartVersion: '1.0.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  tailscale: {
    '1.0.0': {
      helmChartVersion: '1.0.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
  'sales-genie': {
    '0.5.0': {
      helmChartVersion: '0.5.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
    '0.4.0': {
      helmChartVersion: '0.4.0',
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: {},
    },
  },
};

// scripts-repo app ids (scp/apps/<id>, apps/<id>) that share a catalog entry.
const APP_CATALOG_ALIASES: Record<string, string> = {
  invhub: 'investigation-hub',
  investigation: 'investigation-hub',
  'sri-investigation': 'investigation-hub',
  detection: 'detectionhub',
  'sri-detection': 'detectionhub',
  'sri-data': 'flows',
  'edb-common-res': 'common-res',
  'edb-netrevealv96': 'netrevealv96',
  'netreveal-v96': 'netrevealv96',
};

function catalogFor(
  appName: string,
): Record<string, ComponentReleasePointers> | undefined {
  const key = appName.trim().toLowerCase();
  return APP_RELEASE_MATRIX[APP_CATALOG_ALIASES[key] ?? key];
}

function compareVersionsDesc(left: string, right: string): number {
  const parse = (v: string) => v.split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const LOCAL_CHART_PATHS: Record<string, string[]> = {
  'common-res': ['charts/common/charts/common-res/Chart.yaml', 'charts/common/Chart.yaml'],
  'edb-common-res': ['charts/common/charts/edb-common-res/Chart.yaml'],
  'investigation-hub': ['charts/investigation/charts/invhub/Chart.yaml', 'charts/investigation/Chart.yaml'],
  detectionhub: ['charts/detection/charts/detectionhub/Chart.yaml', 'charts/detection/Chart.yaml'],
  flows: ['charts/data/Chart.yaml', 'charts/data/charts/sensa-data-pipeline/Chart.yaml'],
  'ai-store': ['charts/detection/charts/ai-store/Chart.yaml'],
  netrevealv96: ['charts/detection/charts/netrevealv96/Chart.yaml', 'charts/detection/charts/edb-netrevealv96/Chart.yaml'],
  netrevealv95: ['charts/detection/charts/netrevealv95/Chart.yaml'],
  netreveal: ['charts/detection/charts/netreveal/Chart.yaml'],
  datadog: ['charts/platform/charts/datadog/Chart.yaml'],
  velero: ['charts/platform/charts/velero/Chart.yaml'],
  tailscale: ['charts/platform/charts/tailscale/Chart.yaml'],
  dxv: ['charts/data/charts/dxv/Chart.yaml'],
};

/**
 * Discovers any locally vendored Helm chart versions from the repository's
 * `charts/` directory if present.
 */
function discoverLocalChartVersion(appName: string): string | null {
  const key = appName.trim().toLowerCase();
  const canonicalApp = APP_CATALOG_ALIASES[key] ?? key;
  const relPaths = LOCAL_CHART_PATHS[canonicalApp] ?? LOCAL_CHART_PATHS[key];
  if (!relPaths) return null;

  const baseDirs = [
    process.cwd(),
    nodePath.resolve(process.cwd(), '..'),
    '/app',
  ];

  for (const base of baseDirs) {
    for (const rel of relPaths) {
      const fullPath = nodePath.resolve(base, rel);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const match = content.match(/^version:\s*['"]?([^\s'"#]+)/m);
          if (match?.[1]) {
            return match[1].trim();
          }
        } catch {
          // ignore read error
        }
      }
    }
  }

  return null;
}

/** Catalogued chart versions for an app, newest first. */
export function listCatalogVersions(appName: string): string[] {
  const versions = new Set<string>();

  // 1. Main catalog matrix entries
  const catalog = catalogFor(appName);
  if (catalog) {
    for (const v of Object.keys(catalog)) {
      versions.add(v);
    }
  }

  // 2. Live discovery from local vendored charts/ if present and newer than catalog (or when catalog is empty)
  const localVer = discoverLocalChartVersion(appName);
  if (localVer) {
    const catalogVersions = catalog ? Object.keys(catalog).sort(compareVersionsDesc) : [];
    const highestCatalogVer = catalogVersions[0];
    if (!highestCatalogVer || compareVersionsDesc(localVer, highestCatalogVer) < 0) {
      versions.add(localVer);
    }
  }

  // 3. Environment variable overrides (e.g. DEPLOYMENT_PORTAL_CHART_VERSIONS)
  const envRaw = process.env.DEPLOYMENT_PORTAL_CHART_VERSIONS?.trim();
  if (envRaw) {
    for (const v of envRaw.split(',').map(s => s.trim()).filter(Boolean)) {
      versions.add(v);
    }
  }

  return Array.from(versions).sort(compareVersionsDesc);
}

/**
 * Resolves the release pointers for a given app and version.
 *
 * Apps without a catalog entry get the requested chart version verbatim with
 * branch-based refs, rather than another app's pointers. A catalogued app
 * asked for an unknown version (or 'latest') falls back to its newest release.
 */
export function resolveReleasePointers(
  appName: string,
  version: string,
): ComponentReleasePointers {
  const requested = version.trim();
  const appCatalog = catalogFor(appName);
  if (!appCatalog) {
    const chartVersion = requested || 'latest';
    return {
      helmChartVersion: chartVersion,
      valuesFileCommitSha: 'main',
      defaultOverlayRef: 'main',
      subComponents: { entity_resolution_chart_version: chartVersion },
    };
  }

  const release = appCatalog[requested];
  if (release) {
    return release;
  }
  const latestVersion = listCatalogVersions(appName)[0];
  return appCatalog[latestVersion];
}

/**
 * Auto-populate all pipeline pointers for a target namespace.
 *
 * Returns an array of pipeline field → value mappings that should be written to 1Password.
 * Called during "Auto-Generate Secrets" to fill in all 4 required pipeline refs.
 *
 * @param appName Application name (e.g., "investigation-hub")
 * @param version Target release version (e.g., "1.415.0")
 * @param namespace Target instance namespace (e.g., "invhub-dt-juber-poc03")
 * @returns Array of field → value tuples ready for 1Password write
 */
export function getAutoPopulatedPipelineRefs(
  appName: string = 'investigation-hub',
  version: string = '1.415.0',
  namespace: string,
): Array<{
  label: string;
  value: string;
  sectionId: string;
}> {
  const release = resolveReleasePointers(appName, version);

  return [
    {
      label: `${namespace}__helm_chart_version`,
      value: release.helmChartVersion,
      sectionId: 'pipeline_refs',
    },
    {
      label: `${namespace}__helm_chart_values_file_ref`,
      value: release.valuesFileCommitSha,
      sectionId: 'pipeline_refs',
    },
    {
      label: `${namespace}__project_overlay_files_ref`,
      value: release.defaultOverlayRef,
      sectionId: 'pipeline_refs',
    },
    {
      label: `${namespace}__entity_resolution_chart_version`,
      value:
        release.subComponents.entity_resolution_chart_version ||
        release.helmChartVersion,
      sectionId: 'pipeline_refs',
    },
  ];
}

/**
 * Checks if a field name matches a known pipeline reference field.
 * Used to determine if auto-population should apply.
 *
 * @param fieldName Field name (e.g., "invhub-dt-poc__helm_chart_version")
 * @returns true if field should use release catalog auto-population
 */
export function isPipelineRefField(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();
  const pipelineRefPatterns = [
    '__helm_chart_version',
    '__helm_chart_values_file_ref',
    '__project_overlay_files_ref',
    '__entity_resolution_chart_version',
  ];
  return pipelineRefPatterns.some(pattern =>
    lowerField.endsWith(pattern),
  );
}

/**
 * Extracts namespace from a field name.
 * Example: "invhub-dt-juber-poc03__helm_chart_version" → "invhub-dt-juber-poc03"
 */
export function extractNamespaceFromField(fieldName: string): string {
  const idx = fieldName.lastIndexOf('__');
  if (idx === -1) return '';
  return fieldName.substring(0, idx);
}
