# ADLS structure

ADLS Gen2 is the primary destination. Agents write with their workload identity into the destination's file system (default `data-export-hub`), under the optional `path` prefix configured on the destination.

```
<file system: data-export-hub>/
└── [<path>/]
    └── tenant/
        └── <tenant>/                          e.g. metrobank
            └── exports/
                └── <profile-slug>/            e.g. daily-cases-1a2b3c4d
                    └── <yyyy>/<mm>/<dd>/       scheduled date (UTC)
                        └── <jobId>/
                            ├── NR_V_CASES.parquet
                            ├── checksum.sha256
                            └── manifest.json   written last
```

| Segment | Source | Why |
|---|---|---|
| `tenant/<tenant>` | The job's tenant (control plane) | Isolation boundary; grant consumer access here |
| `<profile-slug>` | Profile name, slugified, plus the first 8 characters of the profile id | Readable, and stable across renames. A rename starts a new folder; retention keeps applying to the old one until it expires. |
| `<yyyy>/<mm>/<dd>` | The job's scheduled date | Partition pruning; retention works per day folder |
| `<jobId>` | The job | Hourly, retried and manual runs on the same day never overwrite each other |

This adds the profile and job segments to the layout in the original requirement, which was `tenant/<tenant>/exports/yyyy/mm/dd`. Without them, several exports or hourly runs on the same day would write over one another.

## Files

| File | Content |
|---|---|
| `<datasetId>.parquet` | Parquet; compression inside the file (SNAPPY default, GZIP, or none) |
| `<datasetId>.csv[.gz]`, `.tsv[.gz]` | Header row; gzip when compression is GZIP |
| `<datasetId>.jsonl[.gz]` | Newline-delimited JSON objects |
| `checksum.sha256` | `sha256sum` format: `<hex>  <file name>` per data file. Verify with `sha256sum -c checksum.sha256`. |
| `manifest.json` | See [manifest format](manifest-format.md) |

**Completeness rule:** a job folder is complete only when `manifest.json` exists. Consumers should list job folders, skip those without a manifest, verify checksums, and then load.

## Retention

When a profile sets `retentionDays`, the agent deletes day folders older than that under the profile's folder after each successful run. Retention never crosses the profile folder.

## SFTP

SFTP destinations use the same relative layout under `remotePath`. Files are uploaded as `<name>.part` and renamed when complete, and the manifest still goes last.
