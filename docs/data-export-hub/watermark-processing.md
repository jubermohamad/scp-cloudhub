# Watermark processing

Incremental exports deliver only rows added or changed since the last successful export. Progress is kept as a watermark: the highest value of the dataset's watermark column that was delivered.

## Where watermarks live

`data_export.watermarks` has one row per **export profile and dataset**. Two profiles exporting the same dataset for the same tenant each keep their own watermark, so one can never make the other skip rows. The row records `tenant_id`, `last_success_value`, `last_job_id` and `updated_at`.

## Flow

1. **Claim.** The control plane reads the watermark for `(profile, dataset)`, records it on the job as `watermark_from`, and sends it to the agent as `watermark.lastSuccessValue`. On the first run it is null.
2. **Extract.** The agent wraps the dataset template:

   ```sql
   SELECT * FROM (<sql_template>) AS src
   WHERE src."<watermark_column>" > $1      -- >= for GREATER_OR_EQUAL
   ORDER BY src."<watermark_column>"
   ```

   With no watermark yet, it exports everything, still ordered. It tracks the maximum watermark value it writes.
3. **Deliver.** It uploads the files and the manifest. The manifest records `watermark.from` and `watermark.to`.
4. **Complete.** The agent sends `watermarkValue`, and the control plane marks the job `COMPLETED` and upserts the watermark **in the same database transaction**.

The watermark therefore moves **only after a successful completion**. Every failure leaves it unchanged: the query, the upload, the agent dying, or the job being cancelled. The next attempt re-exports from the same point.

## Strategies

| Strategy | Predicate | Use when |
|---|---|---|
| `GREATER_THAN` (default) | `col > last` | The column is strictly increasing (sequence, high-precision timestamp) |
| `GREATER_OR_EQUAL` | `col >= last` | Several rows can share the boundary value (e.g. second-precision timestamps). Consumers must de-duplicate on the dataset's primary keys, because boundary rows are delivered again. |

## Operating watermarks

- **Re-export from a point.** Update `last_success_value` for the profile and dataset, or delete the row to start again from the beginning. Do it while no job for that profile is running, and record the change in your change ticket.
- **Changing the watermark column** of a dataset invalidates existing watermarks. Reset them deliberately.
- `FULL` and `SNAPSHOT` exports ignore watermarks.
