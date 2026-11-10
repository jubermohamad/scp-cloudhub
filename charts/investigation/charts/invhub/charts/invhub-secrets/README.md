# invhub-secrets

![Version: 0.40.0](https://img.shields.io/badge/Version-0.40.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for creating Investigations Hub Kubernetes secrets

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| copilotv2.copilot.dbname | string | `"copilot"` |  |
| copilotv2.copilot.host | string | `"cn-postgres-copilotv2-rw"` |  |
| copilotv2.copilot.port | string | `"5432"` |  |
| copilotv2.copilot.username | string | `"copilot"` |  |
| copilotv2.copilotDataAdapter.dbname | string | `"copilot"` |  |
| copilotv2.copilotDataAdapter.host | string | `"cn-postgres-copilot-data-adapter-rw"` |  |
| copilotv2.copilotDataAdapter.port | string | `"5432"` |  |
| copilotv2.copilotDataAdapter.username | string | `"copilot"` |  |
| global.COPILOT_DB_HOST | string | `"cn-postgres-copilot-rw"` |  |
| global.COPILOT_DB_SSLMODE | string | `"sslmode=verify-full"` |  |
| global.COPILOT_DB_SSLROOTCERT | string | `"&sslrootcert=/pg-ca-cert/ca.crt"` |  |
| global.COPILOT_DB_TYPE | string | `"postgres"` |  |
| global.COPILOT_DB_USER | string | `"copilot"` |  |
| global.DB_HOST | string | `"cn-postgres-rw"` |  |
| global.DB_NAME | string | `"ayasdi"` |  |
| global.DB_PORT | string | `"5432"` |  |
| global.DB_SSLMODE | string | `"sslmode=verify-full"` |  |
| global.DB_SSLROOTCERT | string | `"&sslrootcert=/pg-ca-cert/ca.crt"` |  |
| global.DB_TYPE | string | `"postgres"` |  |
| global.DB_USER | string | `"ayasdi"` |  |
| global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH | bool | `true` |  |
| global.MINIO_USER | string | `"minio"` |  |
| global.PASSWORD | string | `""` |  |
| global.TRANSACTIONS_API_DB_HOST | string | `"cn-postgres-transactions-rw"` |  |
| global.TRANSACTIONS_API_DB_NAME | string | `"invhub-transactions"` |  |
| global.TRANSACTIONS_API_DB_PORT | string | `"5432"` |  |
| global.TRANSACTIONS_API_DB_SSLMODE | string | `"sslmode=verify-full"` |  |
| global.TRANSACTIONS_API_DB_SSLROOTCERT | string | `"&sslrootcert=/pg-ca-cert/ca.crt"` |  |
| global.TRANSACTIONS_API_DB_TYPE | string | `"postgres"` |  |
| global.TRANSACTIONS_API_DB_USER | string | `"invhub"` |  |
| global.secrets.adoptExisting | bool | `false` |  |
| global.secrets.rotationId | string | `""` |  |
