import type { Queryable } from './db';

export interface ExportPackageRecord {
  id: string;
  packageCode: string;
  packageName: string;
  description: string;
  datasetIds: string[];
  enabled: boolean;
  createdAt: string;
}

export interface StandardPackageDefinition {
  packageCode: string;
  packageName: string;
  description: string;
  datasetIds: string[];
}

export const STANDARD_NETREVEAL_PACKAGES: readonly StandardPackageDefinition[] = [
  {
    packageCode: 'alerting-detection',
    packageName: 'Alerting & Detection',
    description:
      'Alert generation, AML monitoring, escalations and detection reporting.',
    datasetIds: [
      'NR_AML_ALERT_HEADER',
      'NR_AML_MON_ALERT',
      'NR_EXT_ALERTS',
      'NR_FSCS',
    ],
  },
  {
    packageCode: 'case-center-wlm',
    packageName: 'Case Center & Watchlist Management (WLM)',
    description:
      'Cases, investigations, watchlist matches and analyst workflows.',
    datasetIds: [
      'NR_V_CASES',
      'NR_V_CC_ALERTS',
      'NR_CUSTOMER_CASES',
      'NR_WLM_SWIFT_MATCH_DETAILS',
      'NR_WLM_SUBJECT_MATCH_DETAILS',
    ],
  },
  {
    packageCode: 'customer-data-cdd-worldcheck',
    packageName: 'Customer Data, Due Diligence (CDD) & World-Check',
    description:
      'Customer entities, due diligence, risk ratings and world-check screening.',
    datasetIds: [
      'NR_CUSTOMERS',
      'NR_CUSTOMER_DYNAMIC',
      'NR_CUSTOMER_CDD_RISK',
      'NR_CDD_HISTORY',
      'NR_WC_DATA',
      'NR_WC_LIST_ROW',
    ],
  },
  {
    packageCode: 'workflow-audit',
    packageName: 'Workflow Actions, Notes & Audit Trail',
    description:
      'Workflow history, analyst notes, status transitions and audit evidence.',
    datasetIds: [
      'NR_WORKFLOW_NOTE',
      'NR_WORKFLOW_ACTION_LOG',
      'NR_WORKFLOW_ACTIONS',
      'NR_WORKFLOW_STATUSES',
    ],
  },
  {
    packageCode: 'core-references',
    packageName: 'Accounts, Ingestion Audit & Core References',
    description:
      'Reference data, acquisition processing and account relationships.',
    datasetIds: [
      'NR_ACCOUNTS',
      'NR_USERS',
      'NR_LIST_DEFINITION',
      'NR_DOMAIN_REPORTING_REASON',
      'NR_ACQ_BATCH_PROCESS',
    ],
  },
] as const;

export class PackagesService {
  constructor(private readonly db: Queryable) {}

  async list(): Promise<ExportPackageRecord[]> {
    const rows = await this.db.query<{
      id: string;
      package_code: string;
      package_name: string;
      description: string;
      dataset_ids: string[];
      enabled: boolean;
      created_at: Date;
    }>(
      `SELECT id, package_code, package_name, description, dataset_ids, enabled, created_at
         FROM data_export.export_packages
        WHERE enabled = TRUE
        ORDER BY package_name ASC`,
    );
    if (rows.rows.length === 0) {
      return STANDARD_NETREVEAL_PACKAGES.map(pkg => ({
        id: pkg.packageCode,
        packageCode: pkg.packageCode,
        packageName: pkg.packageName,
        description: pkg.description,
        datasetIds: pkg.datasetIds,
        enabled: true,
        createdAt: new Date().toISOString(),
      }));
    }
    return rows.rows.map(r => ({
      id: r.id,
      packageCode: r.package_code,
      packageName: r.package_name,
      description: r.description,
      datasetIds: r.dataset_ids ?? [],
      enabled: r.enabled,
      createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    }));
  }

  async get(packageCode: string): Promise<ExportPackageRecord | null> {
    const rows = await this.db.query<{
      id: string;
      package_code: string;
      package_name: string;
      description: string;
      dataset_ids: string[];
      enabled: boolean;
      created_at: Date;
    }>(
      `SELECT id, package_code, package_name, description, dataset_ids, enabled, created_at
         FROM data_export.export_packages
        WHERE (package_code = $1 OR id::text = $1) AND enabled = TRUE`,
      [packageCode],
    );
    if (rows.rows.length === 0) {
      const fallback = STANDARD_NETREVEAL_PACKAGES.find(
        p => p.packageCode === packageCode,
      );
      if (!fallback) return null;
      return {
        id: fallback.packageCode,
        packageCode: fallback.packageCode,
        packageName: fallback.packageName,
        description: fallback.description,
        datasetIds: fallback.datasetIds,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
    }
    const r = rows.rows[0];
    return {
      id: r.id,
      packageCode: r.package_code,
      packageName: r.package_name,
      description: r.description,
      datasetIds: r.dataset_ids ?? [],
      enabled: r.enabled,
      createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    };
  }
}
