import { randomUUID } from 'crypto';
import type { Queryable } from '../db';

/** Test-only catalog rows; CloudHub does not create these during runtime startup. */
export const NETREVEAL_TEST_DATASETS = [
  { datasetId: 'NR_V_CASES', displayName: 'NetReveal Cases', category: 'CASES' },
  { datasetId: 'NR_V_CC_ALERTS', displayName: 'NetReveal CC Alerts', category: 'ALERTS' },
  { datasetId: 'NR_CUSTOMERS', displayName: 'NetReveal Customers', category: 'CUSTOMERS' },
  { datasetId: 'NR_WORKFLOW_NOTE', displayName: 'NetReveal Workflow Notes', category: 'WORKFLOW' },
  {
    datasetId: 'NR_WLM_SWIFT_MATCH_DETAILS',
    displayName: 'NetReveal WLM SWIFT Match Details',
    category: 'SCREENING',
  },
  { datasetId: 'NR_CUSTOMER_DYNAMIC', displayName: 'NetReveal Customer Dynamic', category: 'CDD' },
] as const;

export async function insertNetRevealTestDatasets(db: Queryable): Promise<void> {
  const created = new Map<string, string>();
  for (const dataset of NETREVEAL_TEST_DATASETS) {
    const id = randomUUID();
    const result = await db.query(
      `INSERT INTO data_export.datasets (id, dataset_id, display_name, business_description, source_product, category,
         classification, contains_pii, contains_sensitive_data)
       VALUES ($1, $2, $3, 'Test fixture', 'NETREVEAL', $4, 'CONFIDENTIAL', TRUE, TRUE)
       ON CONFLICT (dataset_id) DO NOTHING`,
      [id, dataset.datasetId, dataset.displayName, dataset.category],
    );
    if ((result.rowCount ?? 0) > 0) created.set(dataset.datasetId, id);
  }

  const datasetId = created.get('NR_CUSTOMER_DYNAMIC');
  const dependsOnId = created.get('NR_CUSTOMERS');
  if (datasetId && dependsOnId) {
    await db.query(
      `INSERT INTO data_export.dataset_dependencies (dataset_id, depends_on_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [datasetId, dependsOnId],
    );
  }
}
