# cn-postgres

![Version: 0.28.0](https://img.shields.io/badge/Version-0.28.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for cloudnative postgres

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| backupConfig.backup.barmanObjectStore.azureCredentials.storageAccount.key | string | `"storageAccountName"` |  |
| backupConfig.backup.barmanObjectStore.azureCredentials.storageAccount.name | string | `"backup-creds"` |  |
| backupConfig.backup.barmanObjectStore.azureCredentials.storageKey.key | string | `"storageAccountKey"` |  |
| backupConfig.backup.barmanObjectStore.azureCredentials.storageKey.name | string | `"backup-creds"` |  |
| backupConfig.backup.barmanObjectStore.destinationPath | string | `"https://sharedbackupsglobal.blob.core.windows.net/container-name/"` |  |
| backupConfig.backup.retentionPolicy | string | `"30d"` |  |
| backupConfig.enabled | bool | `false` |  |
| backupConfig.schedule | string | `"0 0 0 * * *"` |  |
| bootstrap.enabled | bool | `true` |  |
| clusterName | string | `"invhub-cnpg-postgres"` |  |
| commonAnnotations."prometheus.io/port" | string | `"9187"` |  |
| commonAnnotations."prometheus.io/scrape" | string | `"true"` |  |
| image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| image.tag | string | `"17.6"` |  |
| imagePullSecrets | list | `[]` |  |
| instances | int | `3` |  |
| metrics.enabled | bool | `true` |  |
| monitoring.customQueries | list | `[]` |  |
| monitoring.enabled | bool | `true` |  |
| monitoring.podMonitor.enabled | bool | `true` |  |
| monitoring.prometheusRule.enabled | bool | `false` |  |
| storage.size | string | `"60Gi"` |  |
