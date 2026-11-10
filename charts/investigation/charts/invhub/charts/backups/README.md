# backups

![Version: 0.27.0](https://img.shields.io/badge/Version-0.27.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for resources required for backups

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| azureStorageAccountSecret.enabled | bool | `false` |  |
| azureStorageAccountSecret.secretName | string | `"backup-creds"` |  |
| azureStorageAccountSecret.storageAccountKey | string | `"storage-account-key"` |  |
| azureStorageAccountSecret.storageAccountName | string | `"storage-account-name"` |  |
