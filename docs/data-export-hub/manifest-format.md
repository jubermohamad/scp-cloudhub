# Manifest format

Every completed job writes `manifest.json` into its job folder, after the data files and `checksum.sha256`. It is also stored on the job in CloudHub, and can be downloaded from the job detail page or `GET /jobs/{id}/manifest`.

```json
{
  "manifestVersion": 1,
  "tenant": "metrobank",
  "profile": "daily-cases",
  "profileId": "1a2b3c4d-…",
  "dataset": "NR_V_CASES",
  "runId": "5f0c…",
  "attempt": 1,
  "status": "COMPLETED",
  "exportMode": "INCREMENTAL",
  "format": "PARQUET",
  "compression": "SNAPPY",
  "records": 124550,
  "bytes": 34567211,
  "watermark": { "column": "UPDATED_AT", "from": "2026-10-19T02:00:00Z", "to": "2026-10-20T01:59:58Z" },
  "startedAt": "2026-10-20T02:00:04Z",
  "completedAt": "2026-10-20T02:03:41Z",
  "files": [
    { "name": "NR_V_CASES.parquet", "sha256": "…", "bytes": 34567211, "records": 124550 }
  ],
  "generatedBy": { "agent": "aks-metro-prod-data-export-agent", "version": "1.0.0", "cluster": "aks-metro-prod" }
}
```

| Field | Meaning |
|---|---|
| `manifestVersion` | Format version. Additive changes keep version 1; breaking changes increment it. |
| `tenant`, `profile`, `profileId`, `dataset` | What was exported, and for whom |
| `runId`, `attempt` | The CloudHub job id, and which attempt produced the files |
| `status` | Always `COMPLETED`. Failed attempts never write a manifest. |
| `exportMode`, `format`, `compression` | How the data was produced |
| `records`, `bytes` | Totals across data files |
| `watermark` | For INCREMENTAL: column and the range delivered (`from` exclusive for GREATER_THAN). Nulls otherwise. |
| `files[]` | Data files with SHA-256, size and record count |
| `generatedBy` | Agent, version and cluster that produced the delivery |

The contract is the `Manifest` type in `services/data-export-agent/src/protocol.ts`.
