# minioop-extensions

![Version: 0.28.0](https://img.shields.io/badge/Version-0.28.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for Minio Operator

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| backupConfig.enabled | bool | `false` |  |
| backupConfig.mirror.mirrorObjectStore.azureCredentials.storageAccount.key | string | `"storageAccountName"` |  |
| backupConfig.mirror.mirrorObjectStore.azureCredentials.storageAccount.name | string | `"backup-creds"` |  |
| backupConfig.mirror.mirrorObjectStore.azureCredentials.storageKey.key | string | `"storageAccountKey"` |  |
| backupConfig.mirror.mirrorObjectStore.azureCredentials.storageKey.name | string | `"backup-creds"` |  |
| backupConfig.mirror.mirrorObjectStore.bucketsToMirror[0] | string | `"event-ingestion"` |  |
| backupConfig.mirror.mirrorObjectStore.bucketsToMirror[1] | string | `"subject-attachment"` |  |
| backupConfig.mirror.mirrorObjectStore.bucketsToMirror[2] | string | `"subject-attachment-staging"` |  |
| backupConfig.mirror.mirrorObjectStore.bucketsToMirror[3] | string | `"subject-events"` |  |
| backupConfig.mirror.mirrorObjectStore.destinationPath | string | `"container-name/minio"` |  |
| backupConfig.schedule | string | `"0 0 * * *"` |  |
| mirror.image.repository | string | `"rclone/rclone"` |  |
| mirror.image.tag | string | `"sha-f554fb1"` |  |
