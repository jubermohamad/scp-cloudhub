# invhub

![Version: 1.397.5](https://img.shields.io/badge/Version-1.397.5-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.8](https://img.shields.io/badge/AppVersion-v2026.07.8-informational?style=flat-square)

A Helm chart for installing Investigations Hub

## Requirements

| Repository | Name | Version |
|------------|------|---------|
| file://./charts/api | api-for-ui(api) | >=0.0.1 |
| file://./charts/api | api | >=0.0.1 |
| file://./charts/api | event-data-ingestion(api) | >=0.0.1 |
| file://./charts/api | search-indexing(api) | >=0.0.1 |
| file://./charts/api | api-data-ingestion(api) | >=0.0.1 |
| file://./charts/backups | backups(backups) | >=0.0.1 |
| file://./charts/cdc | cdc | >=0.0.1 |
| file://./charts/certificate | ingress-tls(certificate) | >=0.0.1 |
| file://./charts/clamavd | clamavd | >=0.0.1 |
| file://./charts/cluster-issuer | cluster-issuer | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres-invhub(cn-postgres) | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres-transactions(cn-postgres) | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres-copilotv2(cn-postgres) | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres-keycloak(cn-postgres) | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres-ai-doc-centre(cn-postgres) | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres-copilot-data-adapter(cn-postgres) | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres-copilot(cn-postgres) | >=0.0.1 |
| file://./charts/cn-postgres | cn-postgres-langfuse(cn-postgres) | >=0.0.1 |
| file://./charts/copilot-common | copilot-common | >=0.0.1 |
| file://./charts/copilot-data-adapter | copilot-data-adapter | >=0.0.1 |
| file://./charts/copilot | prompt-engine(copilot) | >=0.0.1 |
| file://./charts/copilot | context-engine(copilot) | >=0.0.1 |
| file://./charts/copilot | websearch(copilot) | >=0.0.1 |
| file://./charts/copilot | interaction-engine(copilot) | >=0.0.1 |
| file://./charts/copilotv2 | copilotv2 | >=0.0.1 |
| file://./charts/disc-api | disc-api | >=0.0.1 |
| file://./charts/disc-web | disc-web | >=0.0.1 |
| file://./charts/flows | flows | >=0.0.1 |
| file://./charts/grafana-dashboards | grafana-dashboards(grafana-dashboards) | >=0.0.1 |
| file://./charts/ingress | reporting-dashboard-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | opensearch-dashboards-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | swagger-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | jaeger-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | transac-api-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | keycloak-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | observability-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | api-notifications-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | webv2-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | minio-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | langfuse-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | copilotv2-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | copilot-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | pgadmin-ingress(ingress) | >=0.0.1 |
| file://./charts/ingress | invhub-ingress(ingress) | >=0.0.1 |
| file://./charts/invhub-secrets | invhub-secrets | >=0.0.1 |
| file://./charts/jaeger | jaeger | >=0.0.1 |
| file://./charts/kafka-cluster | kafka-cluster | >=0.0.1 |
| file://./charts/minioop | minioop-extensions | >=0.0.1 |
| file://./charts/mockserver | mockserver | >=0.0.1 |
| file://./charts/nginx-docs | graphql-api-docs(nginx-docs) | >=0.0.1 |
| file://./charts/nginx-docs | help(nginx-docs) | >=0.0.1 |
| file://./charts/opensearch-extensions | opensearch-extensions | >=0.0.1 |
| file://./charts/opentelemetry | opentelemetry | >=0.0.1 |
| file://./charts/reporting-dashboard | reporting-dashboard | >=0.0.1 |
| file://./charts/terrarium | terrarium | >=0.0.1 |
| file://./charts/transac-api | transac-api | >=0.0.1 |
| file://./charts/web | web | >=0.0.1 |
| file://./charts/web | webv2(web) | >=0.0.1 |
| https://charts.bitnami.com/bitnami | common | 2.13.4 |
| https://charts.bitnami.com/bitnami | keycloak | 25.2.0 |
| https://charts.bitnami.com/bitnami | tempo-minio(minio) | 12.1.3 |
| https://charts.bitnami.com/bitnami | redis | 18.19.4 |
| https://fluent.github.io/helm-charts | fluentd | 0.5.0 |
| https://grafana.github.io/helm-charts | grafana | 6.60.3 |
| https://grafana.github.io/helm-charts | tempo-distributed | 1.6.10 |
| https://helm.runix.net | pgadmin4 | 1.62.0 |
| https://kafbat.github.io/helm-charts | kafka-ui | 1.5.0 |
| https://langfuse.github.io/langfuse-k8s | langfuse | 0.2.0 |
| https://opensearch-project.github.io/helm-charts | opensearch | 2.17.0 |
| https://opensearch-project.github.io/helm-charts | observability-opensearch(opensearch) | 2.17.0 |
| https://opensearch-project.github.io/helm-charts | opensearch-dashboards | 2.15.1 |
| https://operator.min.io/ | minioop(tenant) | 5.0.11 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| api-data-ingestion.fullnameOverride | string | `"api-data-ingestion"` |  |
| api-data-ingestion.resources.limits.cpu | string | `"2000m"` |  |
| api-data-ingestion.resources.limits.memory | string | `"1Gi"` |  |
| api-data-ingestion.resources.requests.cpu | string | `"500m"` |  |
| api-data-ingestion.resources.requests.memory | string | `"512Mi"` |  |
| api-data-ingestion.waitForMigrations.createStateConfigMap | bool | `false` |  |
| api-for-ui.fullnameOverride | string | `"api-for-ui"` |  |
| api-for-ui.resources.limits.cpu | string | `"2000m"` |  |
| api-for-ui.resources.limits.memory | string | `"1Gi"` |  |
| api-for-ui.resources.requests.cpu | string | `"500m"` |  |
| api-for-ui.resources.requests.memory | string | `"512Mi"` |  |
| api-for-ui.waitForMigrations.createStateConfigMap | bool | `false` |  |
| api-notifications-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| api-notifications-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| api-notifications-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| api-notifications-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| api-notifications-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| api-notifications-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| api-notifications-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| api-notifications-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| api-notifications-ingress.enabled | bool | `true` |  |
| api-notifications-ingress.host | string | `"{{ include \"global.basename\" . }}-notifications.{{ include \"global.domain\" . }}"` |  |
| api-notifications-ingress.nameOverride | string | `"api-notifications"` |  |
| api-notifications-ingress.service[0].name | string | `"api-ws"` |  |
| api-notifications-ingress.service[0].pathType | string | `"Prefix"` |  |
| api-notifications-ingress.service[0].paths[0] | string | `"/"` |  |
| api-notifications-ingress.service[0].port | int | `3003` |  |
| api-notifications-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}-notifications.{{ include \"global.domain\" . }}"` |  |
| api-notifications-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| api.enabled | bool | `true` |  |
| api.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-api"` |  |
| api.image.tag | string | `"v2026.07.7"` |  |
| api.resources.limits.cpu | string | `"2000m"` |  |
| api.resources.limits.memory | string | `"1Gi"` |  |
| api.resources.requests.cpu | string | `"500m"` |  |
| api.resources.requests.memory | string | `"512Mi"` |  |
| api.waitForMigrations.createStateConfigMap | bool | `false` |  |
| backups.azureStorageAccountSecret.enabled | bool | `false` |  |
| backups.azureStorageAccountSecret.secretName | string | `"backup-creds"` |  |
| backups.azureStorageAccountSecret.storageAccountKey | string | `"storage-account-key"` |  |
| backups.azureStorageAccountSecret.storageAccountName | string | `"storage-account-name"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.dbTimezone | string | `"UTC"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.query | string | `"select * from V_IH_WLM_CUSTOMER_SCREENING_EVENTS"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.schemaPattern.oracle | string | `"APPS_EIM"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.schemaPattern.postgres | string | `"public"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.timestampColumnName.oracle | string | `"CREATION_TIMESTAMP"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.timestampColumnName.postgres | string | `"creation_timestamp"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.transforms.keyField.oracle | string | `"CUSTOMER_ID"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.transforms.keyField.postgres | string | `"customer_id"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.transforms.payloadField.oracle | string | `"PAYLOAD"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.config.transforms.payloadField.postgres | string | `"payload"` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.enabled | bool | `false` |  |
| cdc.connectors.customersScreeningWmlJdbcConnector.state | string | `"stopped"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.dbTimezone | string | `"UTC"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.query | string | `"select * from V_IH_PAYMENT_FRAUD_EVENTS"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.schemaPattern.oracle | string | `"APPS_EIM"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.schemaPattern.postgres | string | `"public"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.timestampColumnName.oracle | string | `"CREATION_TIMESTAMP"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.timestampColumnName.postgres | string | `"creation_timestamp"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.transforms.keyField.oracle | string | `"CUSTOMER_ID"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.transforms.keyField.postgres | string | `"customer_id"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.transforms.payloadField.oracle | string | `"PAYLOAD"` |  |
| cdc.connectors.paymentFraudJdbcConnector.config.transforms.payloadField.postgres | string | `"payload"` |  |
| cdc.connectors.paymentFraudJdbcConnector.enabled | bool | `false` |  |
| cdc.connectors.paymentFraudJdbcConnector.state | string | `"stopped"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.dbTimezone | string | `"UTC"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.query | string | `"select * from V_IH_SUBJECT_SCORED_EVENTS"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.schemaPattern.oracle | string | `"APPS_EIM"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.schemaPattern.postgres | string | `"public"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.timestampColumnName.oracle | string | `"UPDATE_TIMESTAMP"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.timestampColumnName.postgres | string | `"update_timestamp"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.transforms.keyField.oracle | string | `"CUSTOMER_ID"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.transforms.keyField.postgres | string | `"customer_id"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.transforms.payloadField.oracle | string | `"PAYLOAD"` |  |
| cdc.connectors.subjectScoredJdbcConnector.config.transforms.payloadField.postgres | string | `"payload"` |  |
| cdc.connectors.subjectScoredJdbcConnector.enabled | bool | `false` |  |
| cdc.connectors.subjectScoredJdbcConnector.state | string | `"stopped"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.dbTimezone | string | `"UTC"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.query | string | `"select * from V_IH_SUBJECT_UPDATED_EVENTS"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.schemaPattern.oracle | string | `"APPS_EIM"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.schemaPattern.postgres | string | `"public"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.timestampColumnName.oracle | string | `"UPDATE_TIMESTAMP"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.timestampColumnName.postgres | string | `"update_timestamp"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.transforms.keyField.oracle | string | `"CUSTOMER_ID"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.transforms.keyField.postgres | string | `"customer_id"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.transforms.payloadField.oracle | string | `"PAYLOAD"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.config.transforms.payloadField.postgres | string | `"payload"` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.enabled | bool | `false` |  |
| cdc.connectors.subjectUpdatesJdbcConnector.state | string | `"stopped"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.dbTimezone | string | `"UTC"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.query | string | `"select * from V_IH_WLM_TRANSACTION_SCREENING_EVENTS"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.schemaPattern.oracle | string | `"APPS_EIM"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.schemaPattern.postgres | string | `"public"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.timestampColumnName.oracle | string | `"CREATION_TIMESTAMP"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.timestampColumnName.postgres | string | `"creation_timestamp"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.transforms.keyField.oracle | string | `"CUSTOMER_ID"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.transforms.keyField.postgres | string | `"customer_id"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.transforms.payloadField.oracle | string | `"PAYLOAD"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.config.transforms.payloadField.postgres | string | `"payload"` |  |
| cdc.connectors.transactionScreeningJdbcConnector.enabled | bool | `false` |  |
| cdc.connectors.transactionScreeningJdbcConnector.state | string | `"stopped"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.dbTimezone | string | `"UTC"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.query | string | `"select * from V_IH_UNUSUAL_ACTIVITY_EVENTS"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.schemaPattern.oracle | string | `"APPS_EIM"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.schemaPattern.postgres | string | `"public"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.timestampColumnName.oracle | string | `"CREATION_TIMESTAMP"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.timestampColumnName.postgres | string | `"creation_timestamp"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.transforms.keyField.oracle | string | `"CUSTOMER_ID"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.transforms.keyField.postgres | string | `"customer_id"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.transforms.payloadField.oracle | string | `"PAYLOAD"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.config.transforms.payloadField.postgres | string | `"payload"` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.enabled | bool | `false` |  |
| cdc.connectors.unusualActivitiesJdbcConnector.state | string | `"stopped"` |  |
| cdc.enabled | bool | `true` |  |
| cdc.kafkaConnect.config.template.pod.imagePullSecrets[0].name | string | `"regcred"` |  |
| cdc.kafkaConnect.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-cdc"` |  |
| cdc.kafkaConnect.image.tag | string | `"v2026.07.1"` |  |
| cdc.resources.limits.cpu | string | `"250m"` |  |
| cdc.resources.limits.memory | string | `"1536Mi"` |  |
| cdc.resources.requests.cpu | string | `"50m"` |  |
| cdc.resources.requests.memory | string | `"768Mi"` |  |
| clamavd.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-clamav"` |  |
| clamavd.image.tag | string | `"clamav-v1.1.0"` |  |
| cn-postgres-ai-doc-centre.backupConfig.enabled | bool | `false` |  |
| cn-postgres-ai-doc-centre.bootstrap.config.bootstrap.initdb.database | string | `"ai-doc-centre"` |  |
| cn-postgres-ai-doc-centre.bootstrap.config.bootstrap.initdb.owner | string | `"ai-doc-centre"` |  |
| cn-postgres-ai-doc-centre.bootstrap.config.bootstrap.initdb.postInitApplicationSQL[0] | string | `"CREATE EXTENSION IF NOT EXISTS vector;"` |  |
| cn-postgres-ai-doc-centre.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-credential-ai-doc-centre-cn"` |  |
| cn-postgres-ai-doc-centre.bootstrap.enabled | bool | `true` |  |
| cn-postgres-ai-doc-centre.clusterName | string | `"cn-postgres-ai-doc-centre"` |  |
| cn-postgres-ai-doc-centre.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres-ai-doc-centre.image.tag | string | `"15.6"` |  |
| cn-postgres-ai-doc-centre.resources.limits.cpu | string | `"250m"` |  |
| cn-postgres-ai-doc-centre.resources.limits.memory | string | `"768Mi"` |  |
| cn-postgres-ai-doc-centre.resources.requests.cpu | string | `"50m"` |  |
| cn-postgres-ai-doc-centre.resources.requests.memory | string | `"384Mi"` |  |
| cn-postgres-ai-doc-centre.storage.size | string | `"100Gi"` |  |
| cn-postgres-ai-doc-centre.superuserSecret | string | `"postgres-credential-cn"` |  |
| cn-postgres-copilot-data-adapter.backupConfig.enabled | bool | `false` |  |
| cn-postgres-copilot-data-adapter.bootstrap.config.bootstrap.initdb.database | string | `"copilot"` |  |
| cn-postgres-copilot-data-adapter.bootstrap.config.bootstrap.initdb.owner | string | `"copilot"` |  |
| cn-postgres-copilot-data-adapter.bootstrap.config.bootstrap.initdb.postInitApplicationSQL[0] | string | `"CREATE EXTENSION IF NOT EXISTS vector;"` |  |
| cn-postgres-copilot-data-adapter.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-creds-copilot-data-adapter"` |  |
| cn-postgres-copilot-data-adapter.bootstrap.enabled | bool | `true` |  |
| cn-postgres-copilot-data-adapter.clusterName | string | `"cn-postgres-copilot-data-adapter"` |  |
| cn-postgres-copilot-data-adapter.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres-copilot-data-adapter.image.tag | string | `"15.6"` |  |
| cn-postgres-copilot-data-adapter.resources.limits.cpu | string | `"250m"` |  |
| cn-postgres-copilot-data-adapter.resources.limits.memory | string | `"512Mi"` |  |
| cn-postgres-copilot-data-adapter.resources.requests.cpu | string | `"50m"` |  |
| cn-postgres-copilot-data-adapter.resources.requests.memory | string | `"256Mi"` |  |
| cn-postgres-copilot-data-adapter.storage.size | string | `"100Gi"` |  |
| cn-postgres-copilot.backupConfig.enabled | bool | `false` |  |
| cn-postgres-copilot.bootstrap.config.bootstrap.initdb.database | string | `"copilot"` |  |
| cn-postgres-copilot.bootstrap.config.bootstrap.initdb.owner | string | `"copilot"` |  |
| cn-postgres-copilot.bootstrap.config.bootstrap.initdb.postInitApplicationSQL[0] | string | `"CREATE EXTENSION IF NOT EXISTS vector;"` |  |
| cn-postgres-copilot.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-credential-copilot-cn"` |  |
| cn-postgres-copilot.bootstrap.enabled | bool | `true` |  |
| cn-postgres-copilot.clusterName | string | `"cn-postgres-copilot"` |  |
| cn-postgres-copilot.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres-copilot.image.tag | string | `"15.6"` |  |
| cn-postgres-copilot.resources.limits.cpu | string | `"250m"` |  |
| cn-postgres-copilot.resources.limits.memory | string | `"1Gi"` |  |
| cn-postgres-copilot.resources.requests.cpu | string | `"50m"` |  |
| cn-postgres-copilot.resources.requests.memory | string | `"512Mi"` |  |
| cn-postgres-copilot.superuserSecret | string | `"postgres-credential-cn"` |  |
| cn-postgres-copilotv2.backupConfig.enabled | bool | `false` |  |
| cn-postgres-copilotv2.bootstrap.config.bootstrap.initdb.database | string | `"copilot"` |  |
| cn-postgres-copilotv2.bootstrap.config.bootstrap.initdb.owner | string | `"copilot"` |  |
| cn-postgres-copilotv2.bootstrap.config.bootstrap.initdb.postInitApplicationSQL[0] | string | `"CREATE EXTENSION IF NOT EXISTS vector;"` |  |
| cn-postgres-copilotv2.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-creds-copilotv2"` |  |
| cn-postgres-copilotv2.bootstrap.enabled | bool | `true` |  |
| cn-postgres-copilotv2.clusterName | string | `"cn-postgres-copilotv2"` |  |
| cn-postgres-copilotv2.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres-copilotv2.image.tag | string | `"15.6"` |  |
| cn-postgres-copilotv2.resources.limits.memory | string | `"2Gi"` |  |
| cn-postgres-copilotv2.resources.requests.cpu | string | `"1000m"` |  |
| cn-postgres-copilotv2.resources.requests.memory | string | `"2Gi"` |  |
| cn-postgres-copilotv2.storage.size | string | `"200Gi"` |  |
| cn-postgres-invhub.backupConfig.enabled | bool | `false` |  |
| cn-postgres-invhub.bootstrap.config.bootstrap.initdb.database | string | `"invhub"` |  |
| cn-postgres-invhub.bootstrap.config.bootstrap.initdb.localeCType | string | `"en_US.UTF8"` |  |
| cn-postgres-invhub.bootstrap.config.bootstrap.initdb.localeCollate | string | `"en_US.UTF8"` |  |
| cn-postgres-invhub.bootstrap.config.bootstrap.initdb.owner | string | `"invhub"` |  |
| cn-postgres-invhub.bootstrap.config.bootstrap.initdb.postInitApplicationSQL[0] | string | `"CREATE EXTENSION IF NOT EXISTS vector;"` |  |
| cn-postgres-invhub.bootstrap.config.bootstrap.initdb.postInitSQL[0] | string | `"ALTER USER invhub CREATEDB;"` |  |
| cn-postgres-invhub.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-creds"` |  |
| cn-postgres-invhub.bootstrap.enabled | bool | `true` |  |
| cn-postgres-invhub.clusterName | string | `"cn-postgres-invhub"` |  |
| cn-postgres-invhub.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres-invhub.metrics.enabled | bool | `true` |  |
| cn-postgres-invhub.resources.limits.cpu | string | `"500m"` |  |
| cn-postgres-invhub.resources.limits.memory | string | `"8Gi"` |  |
| cn-postgres-invhub.resources.requests.cpu | string | `"100m"` |  |
| cn-postgres-invhub.resources.requests.memory | string | `"4Gi"` |  |
| cn-postgres-invhub.storage.size | string | `"300Gi"` |  |
| cn-postgres-invhub.superuserSecret | string | `"postgres-credential-cn"` |  |
| cn-postgres-keycloak.backupConfig.enabled | bool | `false` |  |
| cn-postgres-keycloak.bootstrap.config.bootstrap.initdb.database | string | `"bitnami_keycloak"` |  |
| cn-postgres-keycloak.bootstrap.config.bootstrap.initdb.owner | string | `"bn_keycloak"` |  |
| cn-postgres-keycloak.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-credential-keycloak-cn"` |  |
| cn-postgres-keycloak.bootstrap.enabled | bool | `true` |  |
| cn-postgres-keycloak.clusterName | string | `"cn-postgres-keycloak"` |  |
| cn-postgres-keycloak.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres-keycloak.image.tag | string | `"15.6"` |  |
| cn-postgres-keycloak.instances | int | `3` |  |
| cn-postgres-keycloak.resources.limits.cpu | string | `"500m"` |  |
| cn-postgres-keycloak.resources.limits.memory | string | `"2Gi"` |  |
| cn-postgres-keycloak.resources.requests.cpu | string | `"100m"` |  |
| cn-postgres-keycloak.resources.requests.memory | string | `"1Gi"` |  |
| cn-postgres-keycloak.superuserSecret | string | `"postgres-credential-cn"` |  |
| cn-postgres-langfuse.backupConfig.enabled | bool | `false` |  |
| cn-postgres-langfuse.bootstrap.config.bootstrap.initdb.database | string | `"langfuse"` |  |
| cn-postgres-langfuse.bootstrap.config.bootstrap.initdb.owner | string | `"langfuse"` |  |
| cn-postgres-langfuse.bootstrap.config.bootstrap.initdb.postInitSQL[0] | string | `"ALTER USER langfuse CREATEDB;"` |  |
| cn-postgres-langfuse.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-credential-langfuse-cn"` |  |
| cn-postgres-langfuse.bootstrap.enabled | bool | `true` |  |
| cn-postgres-langfuse.clusterName | string | `"cn-postgres-langfuse"` |  |
| cn-postgres-langfuse.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres-langfuse.image.tag | string | `"15.6"` |  |
| cn-postgres-langfuse.instances | int | `3` |  |
| cn-postgres-langfuse.resources.limits.cpu | string | `"250m"` |  |
| cn-postgres-langfuse.resources.limits.memory | string | `"2560Mi"` |  |
| cn-postgres-langfuse.resources.requests.cpu | string | `"50m"` |  |
| cn-postgres-langfuse.resources.requests.memory | string | `"1536Mi"` |  |
| cn-postgres-langfuse.storage.size | string | `"50Gi"` |  |
| cn-postgres-langfuse.superuserSecret | string | `"postgres-credential-cn"` |  |
| cn-postgres-transactions.backupConfig.enabled | bool | `false` |  |
| cn-postgres-transactions.bootstrap.config.bootstrap.initdb.database | string | `"invhub-transactions"` |  |
| cn-postgres-transactions.bootstrap.config.bootstrap.initdb.localeCType | string | `"en_US.utf8"` |  |
| cn-postgres-transactions.bootstrap.config.bootstrap.initdb.localeCollate | string | `"en_US.utf8"` |  |
| cn-postgres-transactions.bootstrap.config.bootstrap.initdb.owner | string | `"invhub"` |  |
| cn-postgres-transactions.bootstrap.config.bootstrap.initdb.postInitSQL[0] | string | `"ALTER USER invhub CREATEDB;"` |  |
| cn-postgres-transactions.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-credential-transactions-cn"` |  |
| cn-postgres-transactions.bootstrap.enabled | bool | `true` |  |
| cn-postgres-transactions.clusterName | string | `"cn-postgres-transactions"` |  |
| cn-postgres-transactions.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres-transactions.image.tag | string | `"15.6"` |  |
| cn-postgres-transactions.metrics.enabled | bool | `true` |  |
| cn-postgres-transactions.resources.limits.cpu | string | `"250m"` |  |
| cn-postgres-transactions.resources.limits.memory | string | `"512Mi"` |  |
| cn-postgres-transactions.resources.requests.cpu | string | `"50m"` |  |
| cn-postgres-transactions.resources.requests.memory | string | `"256Mi"` |  |
| cn-postgres-transactions.storage.size | string | `"100Gi"` |  |
| cn-postgres-transactions.superuserSecret | string | `"postgres-credential-cn"` |  |
| cn-postgres.backupConfig.enabled | bool | `false` |  |
| cn-postgres.bootstrap.config.bootstrap.initdb.database | string | `"ayasdi"` |  |
| cn-postgres.bootstrap.config.bootstrap.initdb.owner | string | `"ayasdi"` |  |
| cn-postgres.bootstrap.config.bootstrap.initdb.postInitApplicationSQL[0] | string | `"CREATE EXTENSION IF NOT EXISTS vector;"` |  |
| cn-postgres.bootstrap.config.bootstrap.initdb.postInitSQL[0] | string | `"ALTER USER ayasdi CREATEDB;"` |  |
| cn-postgres.bootstrap.config.bootstrap.initdb.secret.name | string | `"postgres-creds"` |  |
| cn-postgres.bootstrap.enabled | bool | `true` |  |
| cn-postgres.clusterName | string | `"cn-postgres"` |  |
| cn-postgres.image.repository | string | `"ghcr.io/cloudnative-pg/postgresql"` |  |
| cn-postgres.metrics.enabled | bool | `true` |  |
| cn-postgres.resources.limits.cpu | string | `"500m"` |  |
| cn-postgres.resources.limits.memory | string | `"8Gi"` |  |
| cn-postgres.resources.requests.cpu | string | `"100m"` |  |
| cn-postgres.resources.requests.memory | string | `"4Gi"` |  |
| cn-postgres.storage.size | string | `"300Gi"` |  |
| cn-postgres.superuserSecret | string | `"postgres-credential-cn"` |  |
| config.enabled | bool | `true` |  |
| config.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-config"` |  |
| config.image.tag | string | `"v2026.07.1"` |  |
| config.imagePullSecrets[0].name | string | `"regcred"` |  |
| config.resources.limits.cpu | string | `"500m"` |  |
| config.resources.limits.memory | string | `"512Mi"` |  |
| config.resources.requests.cpu | string | `"50m"` |  |
| config.resources.requests.memory | string | `"128Mi"` |  |
| context-engine.command[0] | string | `"sh"` |  |
| context-engine.command[1] | string | `"-c"` |  |
| context-engine.command[2] | string | `"pip install sensa.resolver && uvicorn context_engine:app --host 0.0.0.0 --port 8001"` |  |
| context-engine.engineName | string | `"context-engine"` |  |
| context-engine.envFromconfigMap | bool | `true` |  |
| context-engine.env[0].name | string | `"LOG_FILE_PATH"` |  |
| context-engine.env[0].value | string | `"/var/log/context-engine"` |  |
| context-engine.env[1].name | string | `"SENSA_HOST"` |  |
| context-engine.env[1].value | string | `"None"` |  |
| context-engine.env[2].name | string | `"POSTGRESQL_URL"` |  |
| context-engine.env[2].valueFrom.secretKeyRef.key | string | `"COPILOT_DB_URL"` |  |
| context-engine.env[2].valueFrom.secretKeyRef.name | string | `"sensa-global-secrets"` |  |
| context-engine.fullnameOverride | string | `"invhub-context-engine"` |  |
| context-engine.image.pullPolicy | string | `"IfNotPresent"` |  |
| context-engine.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/context-engine"` |  |
| context-engine.image.tag | string | `"24362-patched-pypi-token"` |  |
| context-engine.imagePullSecrets[0].name | string | `"regcred"` |  |
| context-engine.livenessProbe.failureThreshold | int | `5` |  |
| context-engine.livenessProbe.httpGet.path | string | `"/context-engine/health"` |  |
| context-engine.livenessProbe.httpGet.port | int | `8001` |  |
| context-engine.livenessProbe.initialDelaySeconds | int | `10` |  |
| context-engine.livenessProbe.periodSeconds | int | `10` |  |
| context-engine.readinessProbe.failureThreshold | int | `5` |  |
| context-engine.readinessProbe.httpGet.path | string | `"/context-engine/readiness"` |  |
| context-engine.readinessProbe.httpGet.port | int | `8001` |  |
| context-engine.readinessProbe.initialDelaySeconds | int | `10` |  |
| context-engine.readinessProbe.periodSeconds | int | `10` |  |
| context-engine.replicaCount | int | `2` |  |
| context-engine.volumeMounts[0].mountPath | string | `"/pg-ca-cert"` |  |
| context-engine.volumeMounts[0].name | string | `"db-root-cert"` |  |
| context-engine.volumes[0].name | string | `"db-root-cert"` |  |
| context-engine.volumes[0].secret.items[0].key | string | `"ca.crt"` |  |
| context-engine.volumes[0].secret.items[0].path | string | `"ca.crt"` |  |
| context-engine.volumes[0].secret.secretName | string | `"cn-postgres-copilot-ca"` |  |
| context-engine.waitForDependencies.enabled | bool | `true` |  |
| context-engine.waitForDependencies.postgres.enabled | bool | `true` |  |
| context-engine.waitForDependencies.redis.enabled | bool | `true` |  |
| copilot-common.config.azureDeploymentName | string | `""` |  |
| copilot-common.config.azureDeploymentNameSupervisor | string | `""` |  |
| copilot-common.config.azureEmbeddingsDeployment | string | `""` |  |
| copilot-common.config.azureEmbeddingsEndpoint | string | `""` |  |
| copilot-common.config.azureEmbeddingsModel | string | `""` |  |
| copilot-common.config.azureOpenAIApiVersion | string | `""` |  |
| copilot-common.config.azureOpenAIApiVersionSupervisor | string | `""` |  |
| copilot-common.config.azureOpenAIEndpoint | string | `""` |  |
| copilot-common.config.openAIApiVersion | string | `""` |  |
| copilot-common.secrets.azureEmbeddingsKey | string | `""` |  |
| copilot-common.secrets.azureOpenAIKey | string | `""` |  |
| copilot-data-adapter.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-copilot-data-adapter"` |  |
| copilot-data-adapter.image.tag | string | `"v0.0.21"` |  |
| copilot-data-adapter.replicaCount | int | `2` |  |
| copilot-data-adapter.resources.limits.cpu | string | `"500m"` |  |
| copilot-data-adapter.resources.limits.memory | string | `"4Gi"` |  |
| copilot-data-adapter.resources.requests.cpu | string | `"50m"` |  |
| copilot-data-adapter.resources.requests.memory | string | `"1280Mi"` |  |
| copilot-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| copilot-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| copilot-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| copilot-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| copilot-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| copilot-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| copilot-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| copilot-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| copilot-ingress.enabled | bool | `true` |  |
| copilot-ingress.host | string | `"{{ include \"global.basename\" . }}-copilot-ie.{{ include \"global.domain\" . }}"` |  |
| copilot-ingress.nameOverride | string | `"copilot"` |  |
| copilot-ingress.service[0].name | string | `"invhub-interaction-engine"` |  |
| copilot-ingress.service[0].pathType | string | `"Prefix"` |  |
| copilot-ingress.service[0].paths[0] | string | `"/"` |  |
| copilot-ingress.service[0].port | int | `8001` |  |
| copilot-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}-copilot-ie.{{ include \"global.domain\" . }}"` |  |
| copilot-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| copilot.enabled | bool | `true` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/rewrite-target" | string | `"/$2"` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-path" | string | `"/copilot/"` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| copilotv2-ingress.annotations."nginx.ingress.kubernetes.io/use-regex" | string | `"true"` |  |
| copilotv2-ingress.enabled | bool | `true` |  |
| copilotv2-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| copilotv2-ingress.nameOverride | string | `"copilotv2"` |  |
| copilotv2-ingress.service[0].name | string | `"copilotv2"` |  |
| copilotv2-ingress.service[0].pathType | string | `"ImplementationSpecific"` |  |
| copilotv2-ingress.service[0].paths[0] | string | `"/copilot(/|$)(.*)"` |  |
| copilotv2-ingress.service[0].port | int | `3006` |  |
| copilotv2-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| copilotv2-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| copilotv2.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-copilot"` |  |
| copilotv2.image.tag | string | `"v0.0.38"` |  |
| copilotv2.initContainers.dbMigration.args[0] | string | `"upgrade"` |  |
| copilotv2.initContainers.dbMigration.args[1] | string | `"2.5.0"` |  |
| copilotv2.initContainers.dbMigration.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/eureka-copilot-v2-db-migration"` |  |
| copilotv2.initContainers.dbMigration.image.tag | string | `"2.5.0"` |  |
| copilotv2.livenessProbe.failureThreshold | int | `9` |  |
| copilotv2.livenessProbe.httpGet.path | string | `"/"` |  |
| copilotv2.livenessProbe.httpGet.port | string | `"http"` |  |
| copilotv2.livenessProbe.initialDelaySeconds | int | `120` |  |
| copilotv2.livenessProbe.periodSeconds | int | `10` |  |
| copilotv2.livenessProbe.timeoutSeconds | int | `10` |  |
| copilotv2.readinessProbe.failureThreshold | int | `9` |  |
| copilotv2.readinessProbe.httpGet.path | string | `"/"` |  |
| copilotv2.readinessProbe.httpGet.port | string | `"http"` |  |
| copilotv2.readinessProbe.initialDelaySeconds | int | `60` |  |
| copilotv2.readinessProbe.periodSeconds | int | `10` |  |
| copilotv2.readinessProbe.timeoutSeconds | int | `10` |  |
| copilotv2.replicaCount | int | `1` |  |
| copilotv2.resources.limits.cpu | string | `"500m"` |  |
| copilotv2.resources.limits.memory | string | `"4Gi"` |  |
| copilotv2.resources.requests.cpu | string | `"50m"` |  |
| copilotv2.resources.requests.memory | string | `"1280Mi"` |  |
| disc-api.enabled | bool | `true` |  |
| disc-api.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-disc-api"` |  |
| disc-api.image.tag | string | `"v2026.07.1"` |  |
| disc-web.enabled | bool | `true` |  |
| disc-web.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-disc-web"` |  |
| disc-web.image.tag | string | `"v2026.07.3"` |  |
| event-data-ingestion.fullnameOverride | string | `"event-data-ingestion"` |  |
| event-data-ingestion.resources.limits.cpu | string | `"2000m"` |  |
| event-data-ingestion.resources.limits.memory | string | `"1Gi"` |  |
| event-data-ingestion.resources.requests.cpu | string | `"500m"` |  |
| event-data-ingestion.resources.requests.memory | string | `"512Mi"` |  |
| event-data-ingestion.waitForMigrations.createStateConfigMap | bool | `false` |  |
| flows.config.austracSmrSubmissionAgentDeploymentId | string | `""` |  |
| flows.config.authClientId | string | `""` |  |
| flows.config.disclosureSubmissionAgentDeploymentId | string | `""` |  |
| flows.config.ecddAgentDeploymentId | string | `""` |  |
| flows.config.emailAgentDeploymentId | string | `""` |  |
| flows.config.evidenceBoardAgentDeploymentId | string | `""` |  |
| flows.config.initialSummaryCaseDeploymentId | string | `""` |  |
| flows.config.initialSummaryDeploymentId | string | `""` |  |
| flows.config.internalDisclosuresHostUrl | string | `"http://disc-api:3002"` |  |
| flows.config.internalFlowsAuthUrl | string | `""` |  |
| flows.config.internalFlowsUrl | string | `""` |  |
| flows.config.investigationNotesWebhookId | string | `""` |  |
| flows.config.narrativeAgentDeploymentId | string | `""` |  |
| flows.config.proxyUrl | string | `""` |  |
| flows.config.releaseId | string | `""` |  |
| flows.config.tenant | string | `""` |  |
| flows.config.url | string | `""` |  |
| flows.config.useInternalUrls | string | `"true"` |  |
| flows.config.webResearchAgentDeploymentId | string | `""` |  |
| flows.secrets.password | string | `""` |  |
| flows.secrets.username | string | `""` |  |
| fluentd.configMapConfigs[0] | string | `"fluentd-prometheus-conf"` |  |
| fluentd.enabled | bool | `false` |  |
| fluentd.env[0].name | string | `"FLUENT_ELASTICSEARCH_HOST"` |  |
| fluentd.env[0].value | string | `"observability-opensearch-cluster-master"` |  |
| fluentd.env[1].name | string | `"FLUENT_ELASTICSEARCH_PORT"` |  |
| fluentd.env[1].value | string | `"9200"` |  |
| fluentd.env[2].name | string | `"K8S_NODE_NAME"` |  |
| fluentd.env[2].valueFrom.fieldRef.fieldPath | string | `"spec.nodeName"` |  |
| fluentd.fileConfigs."01_sources.conf" | string | `"<source>\n  @type tail\n  @id in_tail_container_logs\n  @label @KUBERNETES\n  path /var/log/containers/*.log\n  pos_file /var/log/fluentd-containers.log.pos\n  tag kubernetes.*\n  read_from_head true\n  <parse>\n    @type multi_format\n    <pattern>\n      format json\n      time_key time\n      time_type string\n      time_format \"%Y-%m-%dT%H:%M:%S.%NZ\"\n      keep_time_key true\n    </pattern>\n    <pattern>\n      format regexp\n      expression /^(?<time>.+) (?<stream>stdout|stderr)( (.))? (?<log>.*)$/\n      time_format '%Y-%m-%dT%H:%M:%S.%NZ'\n      keep_time_key true\n    </pattern>\n  </parse>\n  emit_unmatched_lines true\n</source>"` |  |
| fluentd.fileConfigs."02_filters.conf" | string | `"<label @KUBERNETES>\n  <match kubernetes.var.log.containers.fluentd**>\n    @type relabel\n    @label @FLUENT_LOG\n  </match>\n  <match kubernetes.var.log.containers.**_kube-system_**>\n    @type null\n    @id ignore_kube_system_logs\n  </match>\n  <filter kubernetes.**>\n    @type kubernetes_metadata\n    @id filter_kube_metadata\n    skip_labels false\n    skip_container_metadata false\n    skip_namespace_metadata true\n    skip_master_url true\n  </filter>\n  <match **_dev_**>\n    @type relabel\n    @label @DISPATCH\n  </match>\n</label>"` |  |
| fluentd.fileConfigs."03_dispatch.conf" | string | `"<label @DISPATCH>\n  <filter **>\n    @type prometheus\n    <metric>\n      name fluentd_input_status_num_records_total\n      type counter\n      desc The total number of incoming records\n      <labels>\n        tag ${tag}\n        hostname ${hostname}\n      </labels>\n    </metric>\n  </filter>\n  <match **>\n    @type relabel\n    @label @OUTPUT\n  </match>\n</label>"` |  |
| fluentd.fileConfigs."04_outputs.conf" | string | `"<label @OUTPUT>\n  <match **>\n    @type opensearch\n    host \"observability-opensearch-cluster-master\"\n    port 9200\n    index_name fluentd\n  </match>\n</label>"` |  |
| fluentd.kind | string | `"DaemonSet"` |  |
| fluentd.metrics.serviceMonitor.enabled | bool | `true` |  |
| fluentd.plugins[0] | string | `"fluent-plugin-opensearch"` |  |
| fluentd.variant | string | `"opensearch"` |  |
| global.AGENT_BATCH_MAX_CONCURRENT_REQUESTS | int | `15` |  |
| global.AGENT_REQUESTS_BATCH_CRON | string | `"*/3 * * * *"` |  |
| global.DB_CONNECTION_LIMIT | int | `10` |  |
| global.DB_KEEPALIVES | string | `"&keepalives=1&keepalives_idle=60&keepalives_interval=10&keepalives_count=6"` |  |
| global.ENABLED_DISCLOSURE_TYPES | string | `""` |  |
| global.ENTITY_RESOLUTION_URL | string | `""` |  |
| global.EVENT_SCHEDULER_CRON | string | `"0 0-23/12 * * *"` |  |
| global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH | bool | `true` |  |
| global.INVESTIGATION_HUB_OPEN_SEARCH_URL | string | `"https://opensearch-cluster-master:9200"` |  |
| global.KAFKA_CONNECTOR_URL | string | `"http://cdc-connect-api:8083"` |  |
| global.MINIO_SSL_CA_PATH | string | `"/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"` |  |
| global.PASSWORD | string | `""` |  |
| global.SENSA_API_DOCS | bool | `true` |  |
| global.SENSA_CORS_ORIGIN | string | `""` |  |
| global.SENSA_JWT_EXPIRESIN | int | `300` |  |
| global.SENSA_JWT_REFRESH_EXPIRESIN | int | `3600` |  |
| global.SENSA_KAFKA_BOOTSTRAP | string | `"invhub-kafka-bootstrap:9093"` |  |
| global.SENSA_KAFKA_HEARTBEAT_INTERVAL | int | `15000` |  |
| global.SENSA_KAFKA_INITIAL_RETRY_TIME | int | `5000` |  |
| global.SENSA_KAFKA_MAX_BYTES | string | `"10485880"` |  |
| global.SENSA_KAFKA_RETRIES | int | `3` |  |
| global.SENSA_KAFKA_SESSION_TIMEOUT | int | `45000` |  |
| global.SENSA_KAFKA_SSL | string | `"true"` |  |
| global.SENSA_KAFKA_SSL_CA_PATH | string | `"/kafka-ca-cert/ca.crt"` |  |
| global.SENSA_LOG_LEVEL | string | `"warn"` |  |
| global.SENSA_PROMETHEUS_URL | string | `"http://prometheus:9090"` |  |
| global.SENSA_SERVICE_USER | string | `"service@symphony.ai"` |  |
| global.SENSA_THROTTLE_LIMIT | int | `100` |  |
| global.SERVICES_MANAGER_URL | string | `""` |  |
| global.basename | string | `""` |  |
| global.copilot.AZURE_DEPLOYMENT_NAME_EMBEDDING | string | `"text-embedding-ada-002"` |  |
| global.copilot.AZURE_OPENAI_ENDPOINT_GPT4O | string | `"https://changeme.openai.azure.com/"` |  |
| global.copilot.AZURE_OPENAI_ENDPOINT_GPT4O_MINI | string | `"https://changeme.openai.azure.com/"` |  |
| global.copilot.CERT_FILE_PATH | string | `""` |  |
| global.copilot.DEPLOYMENT_NAME_GPT4O | string | `"gpt-4o"` |  |
| global.copilot.DEPLOYMENT_NAME_GPT4O_MINI | string | `"gpt-4o-mini"` |  |
| global.copilot.GQL_API_KEY | string | `"INVHUB_SENSA_API_KEY_SECRET"` |  |
| global.copilot.INTROSPECTION_GQL_API_KEY | string | `"INVHUB_SENSA_API_KEY_SECRET"` |  |
| global.copilot.KEY_FILE_PATH | string | `""` |  |
| global.copilot.MODEL_NAME_GPT4O | string | `"gpt-4o"` |  |
| global.copilot.MODEL_NAME_GPT4O_MINI | string | `"gpt-4o-mini"` |  |
| global.copilot.OPENAI_API_KEY_EMBEDDING | string | `""` |  |
| global.copilot.OPENAI_API_KEY_GPT4O | string | `""` |  |
| global.copilot.OPENAI_API_KEY_GPT4O_MINI | string | `""` |  |
| global.copilot.OPENAI_API_TYPE_GPT4O | string | `"azure"` |  |
| global.copilot.OPENAI_API_TYPE_GPT4O_MINI | string | `"azure"` |  |
| global.copilot.OPENAI_API_VERSION_EMBEDDING | string | `"2023-03-15-preview"` |  |
| global.copilot.OPENAI_API_VERSION_GPT4O | string | `"2024-02-15-preview"` |  |
| global.copilot.OPENAI_API_VERSION_GPT4O_MINI | string | `"2024-02-15-preview"` |  |
| global.copilot.OPENAI_CLIENT_ID | string | `""` |  |
| global.copilot.OPENAI_ENDPOINT_EMBEDDING | string | `"https://changeme.openai.azure.com/"` |  |
| global.copilot.OPENAI_MODEL_NAME_EMBEDDING | string | `"text-embedding-ada-002"` |  |
| global.copilot.OPENAI_TOKEN_URL | string | `""` |  |
| global.copilot.SERPAPI_API_KEY | string | `"INVHUB_SERPAPI_API_KEY"` |  |
| global.csvMaxExportRecords | int | `10000` |  |
| global.dbConnectTimeout | int | `4` |  |
| global.dbPoolTimeout | int | `4` |  |
| global.domain | string | `""` |  |
| global.emailFrom | string | `""` |  |
| global.emailFromName | string | `""` |  |
| global.emailHost | string | `""` |  |
| global.emailPassword | string | `""` |  |
| global.emailPort | string | `""` |  |
| global.emailUsername | string | `""` |  |
| global.enableNodeInspect | bool | `false` |  |
| global.eurekaVersion | string | `"v1.8.3"` |  |
| global.externalHttpsPort | int | `443` |  |
| global.googleMapsApiKey | string | `""` |  |
| global.ingressTlsSecretName | string | `"ingress-tls"` |  |
| global.internalApiBaseUrl | string | `""` |  |
| global.networkPolicy.defaultDeny | bool | `false` |  |
| global.networkPolicy.enabled | bool | `false` |  |
| global.networkPolicy.ingressNamespace | string | `"ingress-nginx"` |  |
| global.pendoAccountId | string | `""` |  |
| global.pendoApiKey | string | `""` |  |
| global.remoteDataDbHost | string | `""` |  |
| global.remoteDataDbName | string | `""` |  |
| global.remoteDataDbPassword | string | `""` |  |
| global.remoteDataDbPort | string | `""` |  |
| global.remoteDataDbSslSelfSigned | bool | `false` |  |
| global.remoteDataDbType | string | `""` |  |
| global.remoteDataDbUseSsl | bool | `false` |  |
| global.remoteDataDbUsername | string | `""` |  |
| global.secrets.adoptExisting | bool | `false` |  |
| global.secrets.rotationId | string | `""` |  |
| global.separateApiResponsibilities | bool | `false` |  |
| global.services.kafkaBootstrap | string | `""` |  |
| global.services.kafkaPort | int | `9093` |  |
| global.services.minio | string | `""` |  |
| global.services.minioPort | int | `9000` |  |
| global.services.opensearchMaster | string | `""` |  |
| global.services.opensearchPort | int | `9200` |  |
| global.services.postgresPort | int | `5432` |  |
| global.services.postgresRw | string | `""` |  |
| global.services.redisMaster | string | `""` |  |
| global.services.redisPort | int | `6379` |  |
| grafana."grafana.ini".server.root_url | string | `"http://localhost:3000/grafana"` |  |
| grafana."grafana.ini".server.serve_from_sub_path | bool | `true` |  |
| grafana.admin.existingSecret | string | `"grafana-creds"` |  |
| grafana.admin.passwordKey | string | `"admin-password"` |  |
| grafana.admin.userKey | string | `"admin-user"` |  |
| grafana.dashboardProviders."dashboardproviders.yaml".apiVersion | int | `1` |  |
| grafana.dashboardProviders."dashboardproviders.yaml".providers[0].disableDeletion | bool | `false` |  |
| grafana.dashboardProviders."dashboardproviders.yaml".providers[0].editable | bool | `true` |  |
| grafana.dashboardProviders."dashboardproviders.yaml".providers[0].folder | string | `""` |  |
| grafana.dashboardProviders."dashboardproviders.yaml".providers[0].name | string | `"default"` |  |
| grafana.dashboardProviders."dashboardproviders.yaml".providers[0].options.path | string | `"/var/lib/grafana/dashboards/default"` |  |
| grafana.dashboardProviders."dashboardproviders.yaml".providers[0].orgId | int | `1` |  |
| grafana.dashboardProviders."dashboardproviders.yaml".providers[0].type | string | `"file"` |  |
| grafana.dashboardsConfigMaps.default | string | `"grafana-dashboards"` |  |
| grafana.datasources."datasources.yaml".apiVersion | int | `1` |  |
| grafana.datasources."datasources.yaml".datasources[0].basicAuth | bool | `false` |  |
| grafana.datasources."datasources.yaml".datasources[0].name | string | `"Tempo"` |  |
| grafana.datasources."datasources.yaml".datasources[0].type | string | `"tempo"` |  |
| grafana.datasources."datasources.yaml".datasources[0].url | string | `"http://tempo-query-frontend:3100"` |  |
| grafana.datasources."datasources.yaml".datasources[1].access | string | `"proxy"` |  |
| grafana.datasources."datasources.yaml".datasources[1].name | string | `"Prometheus"` |  |
| grafana.datasources."datasources.yaml".datasources[1].type | string | `"prometheus"` |  |
| grafana.datasources."datasources.yaml".datasources[1].url | string | `"http://infra-prometheus-prometheus.infra:9090"` |  |
| grafana.fullnameOverride | string | `"grafana"` |  |
| grafana.global.imagePullSecrets[0].name | string | `"regcred"` |  |
| grafana.rbac.namespaced | bool | `true` |  |
| grafana.resources.limits.cpu | string | `"250m"` |  |
| grafana.resources.limits.memory | string | `"512Mi"` |  |
| grafana.resources.requests.cpu | string | `"50m"` |  |
| grafana.resources.requests.memory | string | `"256Mi"` |  |
| grafana.testFramework.enabled | bool | `false` |  |
| graphql-api-docs.enabled | bool | `true` |  |
| graphql-api-docs.env[0].name | string | `"NGINX_BASE_PATH_REWRITE"` |  |
| graphql-api-docs.env[0].value | string | `"docs-graphql"` |  |
| graphql-api-docs.fullnameOverride | string | `"graphql-api-docs"` |  |
| graphql-api-docs.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-graphql-api-docs"` |  |
| graphql-api-docs.image.tag | string | `"v2026.07.1"` |  |
| graphql-api-docs.readinessProbe.httpGet.path | string | `"/"` |  |
| graphql-api-docs.readinessProbe.httpGet.port | string | `"http"` |  |
| help.enabled | bool | `true` |  |
| help.env[0].name | string | `"NGINX_BASE_PATH_REWRITE"` |  |
| help.env[0].value | string | `"help"` |  |
| help.fullnameOverride | string | `"help"` |  |
| help.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-help-center"` |  |
| help.image.tag | string | `"v2026.07.1"` |  |
| help.readinessProbe.httpGet.path | string | `"/health"` |  |
| help.readinessProbe.httpGet.port | string | `"http"` |  |
| infra.enabled | bool | `true` |  |
| ingress-tls.enabled | bool | `false` |  |
| ingress-tls.host | string | `"example.com"` |  |
| ingress-tls.issuerRef.kind | string | `"ClusterIssuer"` |  |
| ingress-tls.issuerRef.name | string | `"letsencrypt-production"` |  |
| ingress-tls.organization | string | `"SymphonyAI Financial Services"` |  |
| interaction-engine.command[0] | string | `"sh"` |  |
| interaction-engine.command[1] | string | `"-c"` |  |
| interaction-engine.command[2] | string | `"pip install sensa.resolver && uvicorn interaction_engine:app --host 0.0.0.0 --port 8001"` |  |
| interaction-engine.engineName | string | `"interaction-engine"` |  |
| interaction-engine.envFromconfigMap | bool | `true` |  |
| interaction-engine.env[0].name | string | `"LOG_FILE_PATH"` |  |
| interaction-engine.env[0].value | string | `"/var/log/interaction-engine"` |  |
| interaction-engine.fullnameOverride | string | `"invhub-interaction-engine"` |  |
| interaction-engine.image.pullPolicy | string | `"IfNotPresent"` |  |
| interaction-engine.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/interaction-engine"` |  |
| interaction-engine.image.tag | string | `"24362-patched-pypi-token"` |  |
| interaction-engine.imagePullSecrets[0].name | string | `"regcred"` |  |
| interaction-engine.livenessProbe.failureThreshold | int | `5` |  |
| interaction-engine.livenessProbe.httpGet.path | string | `"/interaction-engine/health"` |  |
| interaction-engine.livenessProbe.httpGet.port | int | `8001` |  |
| interaction-engine.livenessProbe.initialDelaySeconds | int | `10` |  |
| interaction-engine.livenessProbe.periodSeconds | int | `10` |  |
| interaction-engine.readinessProbe.failureThreshold | int | `5` |  |
| interaction-engine.readinessProbe.httpGet.path | string | `"/interaction-engine/readiness"` |  |
| interaction-engine.readinessProbe.httpGet.port | int | `8001` |  |
| interaction-engine.readinessProbe.initialDelaySeconds | int | `10` |  |
| interaction-engine.readinessProbe.periodSeconds | int | `10` |  |
| interaction-engine.waitForDependencies.enabled | bool | `true` |  |
| interaction-engine.waitForDependencies.redis.enabled | bool | `true` |  |
| interaction-engine.waitForDependencies.terrarium.enabled | bool | `true` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/proxy-body-size" | string | `"21m"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-path" | string | `"/"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| invhub-ingress.annotations."nginx.ingress.kubernetes.io/use-regex" | string | `"true"` |  |
| invhub-ingress.enabled | bool | `true` |  |
| invhub-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| invhub-ingress.nameOverride | string | `"invhub"` |  |
| invhub-ingress.service[0].name | string | `"web"` |  |
| invhub-ingress.service[0].pathType | string | `"Prefix"` |  |
| invhub-ingress.service[0].paths[0] | string | `"/"` |  |
| invhub-ingress.service[0].port | int | `8080` |  |
| invhub-ingress.service[1].name | string | `"api"` |  |
| invhub-ingress.service[1].pathType | string | `"ImplementationSpecific"` |  |
| invhub-ingress.service[1].paths[0] | string | `"/graphql"` |  |
| invhub-ingress.service[1].paths[10] | string | `"/v1/roles"` |  |
| invhub-ingress.service[1].paths[11] | string | `"/v1/saml"` |  |
| invhub-ingress.service[1].paths[12] | string | `"/v1/screen-definition"` |  |
| invhub-ingress.service[1].paths[13] | string | `"/v1/screen-locale"` |  |
| invhub-ingress.service[1].paths[14] | string | `"/v1/transaction-message-type-definition"` |  |
| invhub-ingress.service[1].paths[15] | string | `"/v1/service-discovery"` |  |
| invhub-ingress.service[1].paths[16] | string | `"/v1/setup"` |  |
| invhub-ingress.service[1].paths[17] | string | `"/v1/subject-search"` |  |
| invhub-ingress.service[1].paths[18] | string | `"/v1/subject-task-types"` |  |
| invhub-ingress.service[1].paths[19] | string | `"/v1/upload"` |  |
| invhub-ingress.service[1].paths[1] | string | `"/v1/auth"` |  |
| invhub-ingress.service[1].paths[20] | string | `"/v1/user-config"` |  |
| invhub-ingress.service[1].paths[21] | string | `"/v1/users"` |  |
| invhub-ingress.service[1].paths[22] | string | `"/v1/event-types"` |  |
| invhub-ingress.service[1].paths[23] | string | `"/v1/config-manager"` |  |
| invhub-ingress.service[1].paths[24] | string | `"/v1/metrics/genai-tokens"` |  |
| invhub-ingress.service[1].paths[25] | string | `"/v1/user-screen-preferences"` |  |
| invhub-ingress.service[1].paths[26] | string | `"/v1/event-validation"` |  |
| invhub-ingress.service[1].paths[27] | string | `"/v1/reporting(/?)"` |  |
| invhub-ingress.service[1].paths[28] | string | `"/v1/watchlist(/?)"` |  |
| invhub-ingress.service[1].paths[29] | string | `"/v2/subjects(/?)"` |  |
| invhub-ingress.service[1].paths[2] | string | `"/v1/subjects(/?)"` |  |
| invhub-ingress.service[1].paths[30] | string | `"/v1/config/export"` |  |
| invhub-ingress.service[1].paths[31] | string | `"/v1/config/import"` |  |
| invhub-ingress.service[1].paths[32] | string | `"/v1/dlq/metrics"` |  |
| invhub-ingress.service[1].paths[33] | string | `"/v1/dlq/reprocess"` |  |
| invhub-ingress.service[1].paths[34] | string | `"/v1/agent-output/latest"` |  |
| invhub-ingress.service[1].paths[3] | string | `"/v1/queues"` |  |
| invhub-ingress.service[1].paths[4] | string | `"/v1/health"` |  |
| invhub-ingress.service[1].paths[5] | string | `"/v1/index-manager"` |  |
| invhub-ingress.service[1].paths[6] | string | `"/v1/open-investigations"` |  |
| invhub-ingress.service[1].paths[7] | string | `"/v1/open-investigations-worklist"` |  |
| invhub-ingress.service[1].paths[8] | string | `"/v1/open-actions-worklist"` |  |
| invhub-ingress.service[1].paths[9] | string | `"/v1/organisation-unit"` |  |
| invhub-ingress.service[1].port | int | `3001` |  |
| invhub-ingress.service[2].name | string | `"disc-api"` |  |
| invhub-ingress.service[2].pathType | string | `"Prefix"` |  |
| invhub-ingress.service[2].paths[0] | string | `"/v1/disclosures"` |  |
| invhub-ingress.service[2].port | int | `3002` |  |
| invhub-ingress.service[3].name | string | `"disc-web"` |  |
| invhub-ingress.service[3].pathType | string | `"Prefix"` |  |
| invhub-ingress.service[3].paths[0] | string | `"/disclosures-web"` |  |
| invhub-ingress.service[3].port | int | `80` |  |
| invhub-ingress.service[4].name | string | `"help"` |  |
| invhub-ingress.service[4].pathType | string | `"Prefix"` |  |
| invhub-ingress.service[4].paths[0] | string | `"/help"` |  |
| invhub-ingress.service[4].port | int | `80` |  |
| invhub-ingress.service[5].name | string | `"graphql-api-docs"` |  |
| invhub-ingress.service[5].pathType | string | `"Prefix"` |  |
| invhub-ingress.service[5].paths[0] | string | `"/docs-graphql"` |  |
| invhub-ingress.service[5].port | int | `80` |  |
| invhub-ingress.service[6].name | string | `"kafka-ui"` |  |
| invhub-ingress.service[6].pathType | string | `"Prefix"` |  |
| invhub-ingress.service[6].paths[0] | string | `"/kafka-ui"` |  |
| invhub-ingress.service[6].port | int | `80` |  |
| invhub-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| invhub-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-path" | string | `"/jaeger"` |  |
| jaeger-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| jaeger-ingress.enabled | bool | `false` |  |
| jaeger-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| jaeger-ingress.nameOverride | string | `"jaeger"` |  |
| jaeger-ingress.service[0].name | string | `"jaeger-query"` |  |
| jaeger-ingress.service[0].pathType | string | `"Prefix"` |  |
| jaeger-ingress.service[0].paths[0] | string | `"/jaeger"` |  |
| jaeger-ingress.service[0].port | int | `16686` |  |
| jaeger-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| jaeger-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| kafka-cluster.kafka.resources.limits.cpu | string | `"500m"` |  |
| kafka-cluster.kafka.resources.limits.memory | string | `"4Gi"` |  |
| kafka-cluster.kafka.resources.requests.cpu | string | `"100m"` |  |
| kafka-cluster.kafka.resources.requests.memory | string | `"2Gi"` |  |
| kafka-cluster.kafka.storage.size | string | `"200Gi"` |  |
| kafka-cluster.name | string | `"invhub"` |  |
| kafka-cluster.replicas | int | `3` |  |
| kafka-cluster.zookeeper.resources.limits.cpu | string | `"250m"` |  |
| kafka-cluster.zookeeper.resources.limits.memory | string | `"1536Mi"` |  |
| kafka-cluster.zookeeper.resources.requests.cpu | string | `"50m"` |  |
| kafka-cluster.zookeeper.resources.requests.memory | string | `"768Mi"` |  |
| kafka-cluster.zookeeper.storage.size | string | `"200Gi"` |  |
| kafka-ui.envs.config.SERVER_SERVLET_CONTEXT_PATH | string | `"/kafka-ui"` |  |
| kafka-ui.existingSecret | string | `"kafka-ui-creds"` |  |
| kafka-ui.fullnameOverride | string | `"kafka-ui"` |  |
| kafka-ui.image.registry | string | `"ghcr.io"` |  |
| kafka-ui.image.repository | string | `"kafbat/kafka-ui"` |  |
| kafka-ui.resources.limits.cpu | string | `"250m"` |  |
| kafka-ui.resources.limits.memory | string | `"1Gi"` |  |
| kafka-ui.resources.requests.cpu | string | `"50m"` |  |
| kafka-ui.resources.requests.memory | string | `"512Mi"` |  |
| kafka-ui.yamlApplicationConfig.auth.type | string | `"LOGIN_FORM"` |  |
| kafka-ui.yamlApplicationConfig.kafka.clusters[0].bootstrapServers | string | `"invhub-kafka-bootstrap:9092"` |  |
| kafka-ui.yamlApplicationConfig.kafka.clusters[0].kafkaconnect[0].address | string | `"http://cdc-connect-api:8083"` |  |
| kafka-ui.yamlApplicationConfig.kafka.clusters[0].kafkaconnect[0].name | string | `"cdc"` |  |
| kafka-ui.yamlApplicationConfig.kafka.clusters[0].name | string | `"invhub"` |  |
| kafka-ui.yamlApplicationConfig.management.health.ldap.enabled | bool | `false` |  |
| keycloak-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| keycloak-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| keycloak-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| keycloak-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| keycloak-ingress.enabled | bool | `true` |  |
| keycloak-ingress.host | string | `"{{ include \"global.basename\" . }}-auth.{{ include \"global.domain\" . }}"` |  |
| keycloak-ingress.nameOverride | string | `"keycloak"` |  |
| keycloak-ingress.service[0].name | string | `"invhub-keycloak"` |  |
| keycloak-ingress.service[0].pathType | string | `"Prefix"` |  |
| keycloak-ingress.service[0].paths[0] | string | `"/"` |  |
| keycloak-ingress.service[0].port | int | `80` |  |
| keycloak-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}-auth.{{ include \"global.domain\" . }}"` |  |
| keycloak-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| keycloak.auth.adminUser | string | `"admin"` |  |
| keycloak.auth.existingSecret | string | `"keycloak-creds"` |  |
| keycloak.auth.passwordSecretKey | string | `"password"` |  |
| keycloak.calicoNetworkPolicy.enabled | bool | `false` |  |
| keycloak.externalDatabase.database | string | `"bitnami_keycloak"` |  |
| keycloak.externalDatabase.existingSecret | string | `"postgres-credential-keycloak-cn"` |  |
| keycloak.externalDatabase.existingSecretPasswordKey | string | `"password"` |  |
| keycloak.externalDatabase.extraParams | string | `"sslmode=verify-full&sslrootcert=/pg-ca-cert/ca.crt"` |  |
| keycloak.externalDatabase.host | string | `"cn-postgres-keycloak-rw"` |  |
| keycloak.externalDatabase.port | int | `5432` |  |
| keycloak.externalDatabase.user | string | `"bn_keycloak"` |  |
| keycloak.extraEnvVars[0].name | string | `"KC_PROXY_HEADERS"` |  |
| keycloak.extraEnvVars[0].value | string | `"xforwarded"` |  |
| keycloak.extraVolumeMounts[0].mountPath | string | `"/pg-ca-cert"` |  |
| keycloak.extraVolumeMounts[0].name | string | `"db-root-cert"` |  |
| keycloak.extraVolumeMounts[0].readOnly | bool | `true` |  |
| keycloak.extraVolumes[0].name | string | `"db-root-cert"` |  |
| keycloak.extraVolumes[0].secret.items[0].key | string | `"ca.crt"` |  |
| keycloak.extraVolumes[0].secret.items[0].path | string | `"ca.crt"` |  |
| keycloak.extraVolumes[0].secret.secretName | string | `"cn-postgres-keycloak-ca"` |  |
| keycloak.fullnameOverride | string | `"invhub-keycloak"` |  |
| keycloak.global.imagePullSecrets[0] | string | `"regcred"` |  |
| keycloak.global.imageRegistry | string | `"symphonyfs.azurecr.io"` |  |
| keycloak.global.security.allowInsecureImages | bool | `true` |  |
| keycloak.postgresql.enabled | bool | `false` |  |
| keycloak.proxy | string | `"edge"` |  |
| langfuse-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| langfuse-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| langfuse-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| langfuse-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| langfuse-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| langfuse-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| langfuse-ingress.enabled | bool | `true` |  |
| langfuse-ingress.host | string | `"{{ include \"global.basename\" . }}-langfuse.{{ include \"global.domain\" . }}"` |  |
| langfuse-ingress.nameOverride | string | `"langfuse"` |  |
| langfuse-ingress.service[0].name | string | `"langfuse"` |  |
| langfuse-ingress.service[0].pathType | string | `"Prefix"` |  |
| langfuse-ingress.service[0].paths[0] | string | `"/"` |  |
| langfuse-ingress.service[0].port | int | `3000` |  |
| langfuse-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}-langfuse.{{ include \"global.domain\" . }}"` |  |
| langfuse-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| langfuse.fullnameOverride | string | `"langfuse"` |  |
| langfuse.langfuse.nextauth.url | string | `"{{ include \"global.basename\" . }}-langfuse.{{ include \"global.domain\" . }}"` |  |
| langfuse.langfuse.nodeEnv | string | `"production"` |  |
| langfuse.postgresql.auth.database | string | `"langfuse"` |  |
| langfuse.postgresql.auth.username | string | `"langfuse"` |  |
| langfuse.postgresql.deploy | bool | `false` |  |
| langfuse.postgresql.host | string | `"cn-postgres-langfuse-rw"` |  |
| migrations.backoffLimit | int | `3` |  |
| migrations.dbRootCert.key | string | `"ca.crt"` |  |
| migrations.dbRootCert.mountPath | string | `""` |  |
| migrations.dbRootCert.secretName | string | `""` |  |
| migrations.flowsConfigMapName | string | `"flows"` |  |
| migrations.flowsSecretName | string | `"flows"` |  |
| migrations.image.pullPolicy | string | `""` |  |
| migrations.image.repository | string | `""` |  |
| migrations.image.tag | string | `""` |  |
| migrations.imagePullSecrets[0].name | string | `"regcred"` |  |
| migrations.kafkaRootCert.key | string | `"ca.crt"` |  |
| migrations.kafkaRootCert.mountPath | string | `""` |  |
| migrations.kafkaRootCert.secretName | string | `""` |  |
| migrations.nodeSelector | object | `{}` |  |
| migrations.osRootCert.key | string | `"ca.crt"` |  |
| migrations.osRootCert.mountPath | string | `""` |  |
| migrations.osRootCert.secretName | string | `""` |  |
| migrations.podSecurityContext.fsGroup | int | `10001` |  |
| migrations.podSecurityContext.runAsGroup | int | `10001` |  |
| migrations.podSecurityContext.runAsNonRoot | bool | `true` |  |
| migrations.podSecurityContext.runAsUser | int | `10001` |  |
| migrations.podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` |  |
| migrations.resources.limits.cpu | string | `"500m"` |  |
| migrations.resources.limits.memory | string | `"512Mi"` |  |
| migrations.resources.requests.cpu | string | `"100m"` |  |
| migrations.resources.requests.memory | string | `"256Mi"` |  |
| migrations.securityContext.allowPrivilegeEscalation | bool | `false` |  |
| migrations.securityContext.capabilities.drop[0] | string | `"ALL"` |  |
| migrations.securityContext.readOnlyRootFilesystem | bool | `true` |  |
| migrations.securityContext.runAsGroup | int | `10001` |  |
| migrations.securityContext.runAsNonRoot | bool | `true` |  |
| migrations.securityContext.runAsUser | int | `10001` |  |
| migrations.timeout | int | `2400` |  |
| migrations.tolerations | list | `[]` |  |
| migrations.ttlSecondsAfterFinished | int | `86400` |  |
| migrations.waitForDependencies.enabled | bool | `true` |  |
| migrations.waitForDependencies.image | string | `"docker.io/curlimages/curl:8.11.1"` |  |
| migrations.waitForDependencies.imagePullPolicy | string | `"IfNotPresent"` |  |
| migrations.waitForDependencies.kafka.enabled | bool | `true` |  |
| migrations.waitForDependencies.kafka.port | int | `9093` |  |
| migrations.waitForDependencies.kafka.service | string | `""` |  |
| migrations.waitForDependencies.minio.enabled | bool | `true` |  |
| migrations.waitForDependencies.minio.port | int | `9000` |  |
| migrations.waitForDependencies.minio.service | string | `""` |  |
| migrations.waitForDependencies.opensearch.enabled | bool | `true` |  |
| migrations.waitForDependencies.opensearch.port | int | `9200` |  |
| migrations.waitForDependencies.opensearch.service | string | `""` |  |
| migrations.waitForDependencies.postgres.enabled | bool | `true` |  |
| migrations.waitForDependencies.postgres.port | int | `5432` |  |
| migrations.waitForDependencies.postgres.service | string | `""` |  |
| migrations.waitForDependencies.redis.enabled | bool | `true` |  |
| migrations.waitForDependencies.redis.port | int | `6379` |  |
| migrations.waitForDependencies.redis.service | string | `""` |  |
| migrations.waitForDependencies.resources.limits.cpu | string | `"100m"` |  |
| migrations.waitForDependencies.resources.limits.memory | string | `"64Mi"` |  |
| migrations.waitForDependencies.resources.requests.cpu | string | `"10m"` |  |
| migrations.waitForDependencies.resources.requests.memory | string | `"16Mi"` |  |
| migrations.waitForDependencies.timeoutSeconds | int | `1200` |  |
| migrations.waitForTlsSecrets.enabled | bool | `true` |  |
| migrations.waitForTlsSecrets.image | string | `"docker.io/curlimages/curl:8.11.1"` |  |
| migrations.waitForTlsSecrets.imagePullPolicy | string | `"IfNotPresent"` |  |
| migrations.waitForTlsSecrets.resources.limits.cpu | string | `"100m"` |  |
| migrations.waitForTlsSecrets.resources.limits.memory | string | `"64Mi"` |  |
| migrations.waitForTlsSecrets.resources.requests.cpu | string | `"10m"` |  |
| migrations.waitForTlsSecrets.resources.requests.memory | string | `"16Mi"` |  |
| migrations.waitForTlsSecrets.timeoutSeconds | int | `900` |  |
| minio-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| minio-ingress.annotations."nginx.ingress.kubernetes.io/backend-protocol" | string | `"HTTPS"` |  |
| minio-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| minio-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| minio-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| minio-ingress.enabled | bool | `true` |  |
| minio-ingress.host | string | `"{{ include \"global.basename\" . }}-minio-console.{{ include \"global.domain\" . }}"` |  |
| minio-ingress.nameOverride | string | `"minio"` |  |
| minio-ingress.service[0].name | string | `"minio-console"` |  |
| minio-ingress.service[0].pathType | string | `"Prefix"` |  |
| minio-ingress.service[0].paths[0] | string | `"/"` |  |
| minio-ingress.service[0].port | int | `9443` |  |
| minio-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}-minio-console.{{ include \"global.domain\" . }}"` |  |
| minio-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| minioWebhooks.enabled | bool | `true` |  |
| minioWebhooks.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-minio-client"` |  |
| minioWebhooks.image.tag | string | `"v0.4-rollbackv0.1"` |  |
| minioWebhooks.imagePullSecrets[0].name | string | `"regcred"` |  |
| minioWebhooks.resources.limits.cpu | string | `"250m"` |  |
| minioWebhooks.resources.limits.memory | string | `"256Mi"` |  |
| minioWebhooks.resources.requests.cpu | string | `"50m"` |  |
| minioWebhooks.resources.requests.memory | string | `"64Mi"` |  |
| minioop.backupConfig.enabled | bool | `false` |  |
| minioop.calicoNetworkPolicy.enabled | bool | `false` |  |
| minioop.env[0].name | string | `"MINIO_PROMETHEUS_AUTH_TYPE"` |  |
| minioop.env[0].value | string | `"public"` |  |
| minioop.metrics.enabled | bool | `true` |  |
| minioop.metrics.protocol | string | `"https"` |  |
| minioop.mirror.image.repository | string | `"rclone/rclone"` |  |
| minioop.mirror.image.tag | string | `"sha-f554fb1"` |  |
| minioop.tenant.buckets[0].name | string | `"os-snapshots"` |  |
| minioop.tenant.buckets[1].name | string | `"backups"` |  |
| minioop.tenant.certificate.certConfig.commonName | string | `"minio"` |  |
| minioop.tenant.certificate.certConfig.dnsNames[0] | string | `"*.cluster.local"` |  |
| minioop.tenant.certificate.certConfig.dnsNames[1] | string | `"minio"` |  |
| minioop.tenant.certificate.requestAutoCert | bool | `true` |  |
| minioop.tenant.configuration.name | string | `"minio-creds-operator"` |  |
| minioop.tenant.image.repository | string | `"quay.io/minio/minio"` |  |
| minioop.tenant.name | string | `"minio"` |  |
| minioop.tenant.pools[0].name | string | `"pool-main"` |  |
| minioop.tenant.pools[0].resources.limits.cpu | string | `"500m"` |  |
| minioop.tenant.pools[0].resources.limits.memory | string | `"2Gi"` |  |
| minioop.tenant.pools[0].resources.requests.cpu | string | `"100m"` |  |
| minioop.tenant.pools[0].resources.requests.memory | string | `"1Gi"` |  |
| minioop.tenant.pools[0].servers | int | `4` |  |
| minioop.tenant.pools[0].size | string | `"200G"` |  |
| minioop.tenant.pools[0].storageClassName | string | `"managed-csi-xfs-standardssd-lrs"` |  |
| minioop.tenant.pools[0].volumesPerServer | int | `2` |  |
| mockserver.enabled | bool | `false` |  |
| mockserver.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-mockserver"` |  |
| mockserver.image.tag | string | `"v2026.07.1"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/proxy-body-size" | string | `"21m"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-path" | string | `"/grafana"` |  |
| observability-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| observability-ingress.enabled | bool | `true` |  |
| observability-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| observability-ingress.nameOverride | string | `"observability"` |  |
| observability-ingress.service[0].name | string | `"grafana"` |  |
| observability-ingress.service[0].pathType | string | `"Prefix"` |  |
| observability-ingress.service[0].paths[0] | string | `"/grafana"` |  |
| observability-ingress.service[0].port | int | `80` |  |
| observability-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| observability-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| observabilityAlerts.annotations | object | `{}` |  |
| observabilityAlerts.enabled | bool | `false` |  |
| observabilityAlerts.kafka.enabled | bool | `true` |  |
| observabilityAlerts.kafka.for | string | `"10m"` |  |
| observabilityAlerts.labels | object | `{}` |  |
| observabilityAlerts.minioWebhooks.enabled | bool | `true` |  |
| observabilityAlerts.minioWebhooks.for | string | `"0m"` |  |
| observabilityAlerts.opensearch.enabled | bool | `true` |  |
| observabilityAlerts.opensearch.for | string | `"10m"` |  |
| observabilityAlerts.postgresql.enabled | bool | `true` |  |
| observabilityAlerts.postgresql.for | string | `"10m"` |  |
| observabilityAlerts.postgresql.maxConnectionsUtilizationPercent | int | `80` |  |
| opensearch-dashboards-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| opensearch-dashboards-ingress.annotations."nginx.ingress.kubernetes.io/backend-protocol" | string | `"HTTPS"` |  |
| opensearch-dashboards-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| opensearch-dashboards-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| opensearch-dashboards-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| opensearch-dashboards-ingress.enabled | bool | `false` |  |
| opensearch-dashboards-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| opensearch-dashboards-ingress.nameOverride | string | `"opensearch-dashboards"` |  |
| opensearch-dashboards-ingress.service[0].name | string | `"opensearch-dashboards"` |  |
| opensearch-dashboards-ingress.service[0].pathType | string | `"Prefix"` |  |
| opensearch-dashboards-ingress.service[0].paths[0] | string | `"/opensearch-dashboards"` |  |
| opensearch-dashboards-ingress.service[0].port | int | `5601` |  |
| opensearch-dashboards-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| opensearch-dashboards-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| opensearch-dashboards.config."opensearch_dashboards.yml" | string | `"server.host: '0.0.0.0'\nserver.ssl.enabled: true\nserver.ssl.key: /usr/share/opensearch-dashboards/config/dashboards-certs/tls.key\nserver.ssl.certificate: /usr/share/opensearch-dashboards/config/dashboards-certs/tls.crt\nserver.ssl.certificateAuthorities: [ \"/usr/share/opensearch-dashboards/config/dashboards-certs/ca.crt\" ]\nopensearch.hosts: [https://opensearch-cluster-master:9200]\nopensearch.ssl.verificationMode: certificate\nopensearch.ssl.certificateAuthorities: [ \"/usr/share/opensearch-dashboards/config/os-certs/ca.crt\" ]\nopensearch.requestHeadersAllowlist: [\"securitytenant\",\"Authorization\"]\nopensearch_security.multitenancy.enabled: false\nopensearch_security.readonly_mode.roles: [admin]\nopensearch_security.cookie.secure: true\nopensearch_security.auth.type: [\"basicauth\"]\n"` |  |
| opensearch-dashboards.config.ssl.certificate | string | `"/usr/share/opensearch-dashboards/config/dashboards-certs/tls.crt"` |  |
| opensearch-dashboards.config.ssl.enabled | bool | `true` |  |
| opensearch-dashboards.config.ssl.key | string | `"/usr/share/opensearch-dashboards/config/dashboards-certs/tls.key"` |  |
| opensearch-dashboards.dashboardAnnotations."secret.reloader.stakater.com/reload" | string | `"opensearch-cluster-dashboards-certs"` |  |
| opensearch-dashboards.enabled | bool | `false` |  |
| opensearch-dashboards.extraEnvs[0].name | string | `"SERVER_BASEPATH"` |  |
| opensearch-dashboards.extraEnvs[0].value | string | `"/opensearch-dashboards"` |  |
| opensearch-dashboards.extraEnvs[1].name | string | `"SERVER_REWRITEBASEPATH"` |  |
| opensearch-dashboards.extraEnvs[1].value | string | `"true"` |  |
| opensearch-dashboards.fullnameOverride | string | `"opensearch-dashboards"` |  |
| opensearch-dashboards.opensearchHosts | string | `"https://opensearch-cluster-master:9200"` |  |
| opensearch-dashboards.secretMounts[0].name | string | `"opensearch-cluster-dashboards-certs"` |  |
| opensearch-dashboards.secretMounts[0].path | string | `"/usr/share/opensearch-dashboards/config/dashboards-certs"` |  |
| opensearch-dashboards.secretMounts[0].secretName | string | `"opensearch-cluster-dashboards-certs"` |  |
| opensearch-dashboards.secretMounts[1].name | string | `"opensearch-cluster-certs"` |  |
| opensearch-dashboards.secretMounts[1].path | string | `"/usr/share/opensearch-dashboards/config/os-certs"` |  |
| opensearch-dashboards.secretMounts[1].secretName | string | `"opensearch-cluster-certs"` |  |
| opensearch-dashboards.serverHost | string | `"0.0.0.0"` |  |
| opensearch.calicoNetworkPolicy.enabled | bool | `false` |  |
| opensearch.clusterName | string | `"opensearch-cluster"` |  |
| opensearch.config."log4j2.properties" | string | `"appender.console.type = Console\nappender.console.name = console\nappender.console.layout.type = OpenSearchJsonLayout\nappender.console.layout.type_name = json_logger\nrootLogger.level = info\nrootLogger.appenderRef.console.ref = console\n"` |  |
| opensearch.config."opensearch.yml" | string | `"cluster.name: opensearch-cluster\nnetwork.host: 0.0.0.0\nplugins:\n  security:\n    ssl:\n      transport:\n        pemcert_filepath: /usr/share/opensearch/config/certs/tls.crt\n        pemkey_filepath:  /usr/share/opensearch/config/certs/tls.key\n        pemtrustedcas_filepath: /usr/share/opensearch/config/certs/ca.crt\n        enforce_hostname_verification: false\n      http:\n        enabled: true\n        pemcert_filepath: /usr/share/opensearch/config/certs/tls.crt\n        pemkey_filepath: /usr/share/opensearch/config/certs/tls.key\n        pemtrustedcas_filepath: /usr/share/opensearch/config/certs/ca.crt\n    allow_unsafe_democertificates: false\n    allow_default_init_securityindex: true\n    nodes_dn:\n      - CN=opensearch-nodes,O=INVHUB\n    audit.type: internal_opensearch\n    enable_snapshot_restore_privilege: true\n    check_snapshot_restore_write_privileges: true\n    restapi:\n      roles_enabled: [\"all_access\", \"security_rest_api_access\"]\n    system_indices:\n      enabled: true\n      indices:\n        [\n          \".opendistro-alerting-config\",\n          \".opendistro-alerting-alert*\",\n          \".opendistro-anomaly-results*\",\n          \".opendistro-anomaly-detector*\",\n          \".opendistro-anomaly-checkpoints\",\n          \".opendistro-anomaly-detection-state\",\n          \".opendistro-reports-*\",\n          \".opendistro-notifications-*\",\n          \".opendistro-notebooks\",\n          \".opendistro-asynchronous-search-response*\",\n        ]\n"` |  |
| opensearch.extraEnvs[0].name | string | `"DISABLE_INSTALL_DEMO_CONFIG"` |  |
| opensearch.extraEnvs[0].value | string | `"true"` |  |
| opensearch.extraEnvs[1].name | string | `"OPENSEARCH_INITIAL_ADMIN_PASSWORD"` |  |
| opensearch.extraEnvs[1].valueFrom.secretKeyRef.key | string | `"INVESTIGATION_HUB_OPEN_SEARCH_PASSWORD"` |  |
| opensearch.extraEnvs[1].valueFrom.secretKeyRef.name | string | `"opensearch-basic-auth"` |  |
| opensearch.global.dockerRegistry | string | `""` |  |
| opensearch.image.repository | string | `"opensearchproject/opensearch"` |  |
| opensearch.imagePullSecrets[0].name | string | `"regcred"` |  |
| opensearch.initResources.limits.cpu | string | `"250m"` |  |
| opensearch.initResources.limits.memory | string | `"128Mi"` |  |
| opensearch.initResources.requests.cpu | string | `"50m"` |  |
| opensearch.initResources.requests.memory | string | `"64Mi"` |  |
| opensearch.masterService | string | `"opensearch-cluster-master"` |  |
| opensearch.nodeGroup | string | `"master"` |  |
| opensearch.openSearchAnnotations."secret.reloader.stakater.com/reload" | string | `"opensearch-cluster-certs"` |  |
| opensearch.opensearchJavaOpts | string | `"-Xmx2g -Xms2g"` |  |
| opensearch.plugins.enabled | bool | `true` |  |
| opensearch.plugins.installList[0] | string | `"https://github.com/opensearch-project/opensearch-prometheus-exporter/releases/download/2.11.1.0/prometheus-exporter-2.11.1.0.zip"` |  |
| opensearch.replicas | int | `3` |  |
| opensearch.resources.limits.cpu | string | `"1000m"` |  |
| opensearch.resources.limits.memory | string | `"6Gi"` |  |
| opensearch.resources.requests.cpu | string | `"250m"` |  |
| opensearch.resources.requests.memory | string | `"4Gi"` |  |
| opensearch.secretMounts[0].name | string | `"opensearch-cluster-certs"` |  |
| opensearch.secretMounts[0].path | string | `"/usr/share/opensearch/config/certs"` |  |
| opensearch.secretMounts[0].secretName | string | `"opensearch-cluster-certs"` |  |
| opensearch.secretMounts[1].name | string | `"opensearch-cluster-admin-certs"` |  |
| opensearch.secretMounts[1].path | string | `"/usr/share/opensearch/config/admin-certs"` |  |
| opensearch.secretMounts[1].secretName | string | `"opensearch-cluster-admin-certs"` |  |
| opensearch.sysctlInit.enabled | bool | `true` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/proxy-body-size" | string | `"21m"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-path" | string | `"/"` |  |
| pgadmin-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| pgadmin-ingress.enabled | bool | `true` |  |
| pgadmin-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| pgadmin-ingress.nameOverride | string | `"pgadmin"` |  |
| pgadmin-ingress.service[0].name | string | `"pgadmin"` |  |
| pgadmin-ingress.service[0].pathType | string | `"Prefix"` |  |
| pgadmin-ingress.service[0].paths[0] | string | `"/pgadmin"` |  |
| pgadmin-ingress.service[0].port | int | `80` |  |
| pgadmin-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| pgadmin-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| pgadmin4.VolumePermissions.enabled | bool | `true` |  |
| pgadmin4.env.contextPath | string | `"/pgadmin"` |  |
| pgadmin4.env.email | string | `"pgadmin@fseng.net"` |  |
| pgadmin4.env.variables[0].name | string | `"PGADMIN_REPLACE_SERVERS_ON_STARTUP"` |  |
| pgadmin4.env.variables[0].value | string | `"True"` |  |
| pgadmin4.env.variables[1].name | string | `"PGADMIN_CONFIG_PROXY_X_HOST_COUNT"` |  |
| pgadmin4.env.variables[1].value | string | `"0"` |  |
| pgadmin4.env.variables[2].name | string | `"PGADMIN_CONFIG_PROXY_X_PORT_COUNT"` |  |
| pgadmin4.env.variables[2].value | string | `"0"` |  |
| pgadmin4.existingSecret | string | `"postgres-creds"` |  |
| pgadmin4.extraInitContainers | string | `"- name: create-storage-paths\n  image: '{{ include \"pgadmin.image\" . }}'\n  command:\n    - /bin/sh\n    - -c\n    - >\n      mkdir -p\n      /var/lib/pgadmin/storage/pgadmin_fseng.net\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-ca-cert\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-copilot-ca\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-copilotv2-ca\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-copilot-data-adapter-ca\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-keycloak-ca\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-langfuse-ca\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-transactions-ca\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-ai-doc-centre-ca\n      /var/lib/pgadmin/storage/pgadmin_fseng.net/pg-invhub-migration-ca\n  volumeMounts:\n    - name: pgadmin-data\n      mountPath: /var/lib/pgadmin\n  securityContext:\n    runAsUser: 5050\n"` |  |
| pgadmin4.extraSecretMounts[0].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-ca-cert"` |  |
| pgadmin4.extraSecretMounts[0].name | string | `"pgadmin-secret-config"` |  |
| pgadmin4.extraSecretMounts[0].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[0].secret | string | `"cn-postgres-ca"` |  |
| pgadmin4.extraSecretMounts[0].subPath | string | `""` |  |
| pgadmin4.extraSecretMounts[1].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-copilot-ca"` |  |
| pgadmin4.extraSecretMounts[1].name | string | `"pgadmin-copilot-ca"` |  |
| pgadmin4.extraSecretMounts[1].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[1].secret | string | `"{{- if (default false (index .Values.featureToggles \"copilot\")) -}} cn-postgres-copilot-ca {{- else -}} cn-postgres-ca {{- end -}}"` |  |
| pgadmin4.extraSecretMounts[1].subPath | string | `""` |  |
| pgadmin4.extraSecretMounts[2].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-copilotv2-ca"` |  |
| pgadmin4.extraSecretMounts[2].name | string | `"pgadmin-copilotv2-ca"` |  |
| pgadmin4.extraSecretMounts[2].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[2].secret | string | `"{{- if (default false (index .Values.featureToggles \"copilotv2\")) -}} cn-postgres-copilotv2-ca {{- else -}} cn-postgres-ca {{- end -}}"` |  |
| pgadmin4.extraSecretMounts[2].subPath | string | `""` |  |
| pgadmin4.extraSecretMounts[3].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-copilot-data-adapter-ca"` |  |
| pgadmin4.extraSecretMounts[3].name | string | `"pgadmin-copilot-data-adapter-ca"` |  |
| pgadmin4.extraSecretMounts[3].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[3].secret | string | `"{{- if (default false (index .Values.featureToggles \"copilotv2\")) -}} cn-postgres-copilot-data-adapter-ca {{- else -}} cn-postgres-ca {{- end -}}"` |  |
| pgadmin4.extraSecretMounts[3].subPath | string | `""` |  |
| pgadmin4.extraSecretMounts[4].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-keycloak-ca"` |  |
| pgadmin4.extraSecretMounts[4].name | string | `"pgadmin-keycloak-ca"` |  |
| pgadmin4.extraSecretMounts[4].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[4].secret | string | `"{{- if (default false (index .Values.featureToggles \"keycloak\")) -}} cn-postgres-keycloak-ca {{- else -}} cn-postgres-ca {{- end -}}"` |  |
| pgadmin4.extraSecretMounts[4].subPath | string | `""` |  |
| pgadmin4.extraSecretMounts[5].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-langfuse-ca"` |  |
| pgadmin4.extraSecretMounts[5].name | string | `"pgadmin-langfuse-ca"` |  |
| pgadmin4.extraSecretMounts[5].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[5].secret | string | `"{{- if (default false (index .Values.featureToggles \"langfuse\")) -}} cn-postgres-langfuse-ca {{- else -}} cn-postgres-ca {{- end -}}"` |  |
| pgadmin4.extraSecretMounts[5].subPath | string | `""` |  |
| pgadmin4.extraSecretMounts[6].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-transactions-ca"` |  |
| pgadmin4.extraSecretMounts[6].name | string | `"pgadmin-transactions-ca"` |  |
| pgadmin4.extraSecretMounts[6].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[6].secret | string | `"{{- if (default false (index .Values.featureToggles \"transactions-api\")) -}} cn-postgres-transactions-ca {{- else -}} cn-postgres-ca {{- end -}}"` |  |
| pgadmin4.extraSecretMounts[6].subPath | string | `""` |  |
| pgadmin4.extraSecretMounts[7].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-ai-doc-centre-ca"` |  |
| pgadmin4.extraSecretMounts[7].name | string | `"pgadmin-ai-doc-centre-ca"` |  |
| pgadmin4.extraSecretMounts[7].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[7].secret | string | `"{{- if (default false (index .Values.featureToggles \"ai-doc-centre\")) -}} cn-postgres-ai-doc-centre-ca {{- else -}} cn-postgres-ca {{- end -}}"` |  |
| pgadmin4.extraSecretMounts[7].subPath | string | `""` |  |
| pgadmin4.extraSecretMounts[8].mountPath | string | `"/var/lib/pgadmin/storage/pgadmin_fseng.net/pg-invhub-migration-ca"` |  |
| pgadmin4.extraSecretMounts[8].name | string | `"pgadmin-invhub-migration-ca"` |  |
| pgadmin4.extraSecretMounts[8].readOnly | bool | `true` |  |
| pgadmin4.extraSecretMounts[8].secret | string | `"{{- if (default false (index .Values.featureToggles \"invhub-db-migration\")) -}} cn-postgres-invhub-ca {{- else -}} cn-postgres-ca {{- end -}}"` |  |
| pgadmin4.extraSecretMounts[8].subPath | string | `""` |  |
| pgadmin4.featureToggles.ai-doc-centre | bool | `false` |  |
| pgadmin4.featureToggles.copilot | bool | `true` |  |
| pgadmin4.featureToggles.copilotv2 | bool | `true` |  |
| pgadmin4.featureToggles.invhub-db-migration | bool | `false` |  |
| pgadmin4.featureToggles.keycloak | bool | `false` |  |
| pgadmin4.featureToggles.langfuse | bool | `false` |  |
| pgadmin4.featureToggles.transactions-api | bool | `false` |  |
| pgadmin4.fullnameOverride | string | `"pgadmin"` |  |
| pgadmin4.imagePullSecrets[0].name | string | `"regcred"` |  |
| pgadmin4.resources.limits.cpu | string | `"250m"` |  |
| pgadmin4.resources.limits.memory | string | `"512Mi"` |  |
| pgadmin4.resources.requests.cpu | string | `"50m"` |  |
| pgadmin4.resources.requests.memory | string | `"256Mi"` |  |
| pgadmin4.serverDefinitions.enabled | bool | `true` |  |
| pgadmin4.serverDefinitions.existingConfigmap | string | `"pgadmin-server-definitions"` |  |
| pgadmin4.serverDefinitions.resourceType | string | `"ConfigMap"` |  |
| pgadmin4.serviceAccount.automountServiceAccountToken | bool | `false` |  |
| pgadmin4.serviceAccount.create | bool | `true` |  |
| pgadmin4.serviceAccount.name | string | `"pgadmin"` |  |
| pgadmin4.startupProbe.failureThreshold | int | `60` |  |
| pgadmin4.startupProbe.periodSeconds | int | `10` |  |
| pgadmin4.startupProbe.timeoutSeconds | int | `5` |  |
| pgadmin4.strategy.type | string | `"Recreate"` |  |
| pgadmin4.templatedPodAnnotations | string | `"checksum/pgadmin-values: {{ toJson .Values | sha256sum }}\n"` |  |
| pgadmin4.test.resources.limits.cpu | string | `"50m"` |  |
| pgadmin4.test.resources.limits.memory | string | `"32Mi"` |  |
| pgadmin4.test.resources.requests.cpu | string | `"25m"` |  |
| pgadmin4.test.resources.requests.memory | string | `"16Mi"` |  |
| prompt-engine.command[0] | string | `"sh"` |  |
| prompt-engine.command[1] | string | `"-c"` |  |
| prompt-engine.command[2] | string | `"uvicorn application:app --host 0.0.0.0 --port 8001"` |  |
| prompt-engine.engineName | string | `"prompt-engine"` |  |
| prompt-engine.envFromconfigMap | bool | `true` |  |
| prompt-engine.env[0].name | string | `"LOG_FILE_PATH"` |  |
| prompt-engine.env[0].value | string | `"/var/log/genai-engine"` |  |
| prompt-engine.fullnameOverride | string | `"invhub-prompt-engine"` |  |
| prompt-engine.image.pullPolicy | string | `"IfNotPresent"` |  |
| prompt-engine.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/sensa-genai-copilot"` |  |
| prompt-engine.image.tag | string | `"v2025.11"` |  |
| prompt-engine.imagePullSecrets[0].name | string | `"regcred"` |  |
| prompt-engine.livenessProbe.failureThreshold | int | `5` |  |
| prompt-engine.livenessProbe.httpGet.path | string | `"/prompt-engine/health"` |  |
| prompt-engine.livenessProbe.httpGet.port | int | `8001` |  |
| prompt-engine.livenessProbe.initialDelaySeconds | int | `10` |  |
| prompt-engine.livenessProbe.periodSeconds | int | `10` |  |
| prompt-engine.readinessProbe.failureThreshold | int | `5` |  |
| prompt-engine.readinessProbe.httpGet.path | string | `"/prompt-engine/readiness"` |  |
| prompt-engine.readinessProbe.httpGet.port | int | `8001` |  |
| prompt-engine.readinessProbe.initialDelaySeconds | int | `10` |  |
| prompt-engine.readinessProbe.periodSeconds | int | `10` |  |
| prompt-engine.replicaCount | int | `2` |  |
| prompt-engine.resources.limits.cpu | string | `"250m"` |  |
| prompt-engine.resources.limits.memory | string | `"2560Mi"` |  |
| prompt-engine.resources.requests.cpu | string | `"50m"` |  |
| prompt-engine.resources.requests.memory | string | `"2Gi"` |  |
| prompt-engine.waitForDependencies.enabled | bool | `true` |  |
| prompt-engine.waitForDependencies.postgres.enabled | bool | `true` |  |
| prompt-engine.waitForDependencies.redis.enabled | bool | `true` |  |
| prompt-engine.waitForDependencies.terrarium.enabled | bool | `true` |  |
| redis.auth.enabled | bool | `false` |  |
| redis.auth.existingSecret | string | `"redis-creds"` |  |
| redis.auth.existingSecretPasswordKey | string | `"password"` |  |
| redis.calicoNetworkPolicy.enabled | bool | `false` |  |
| redis.fullnameOverride | string | `"redis"` |  |
| redis.global.imagePullSecrets[0] | string | `"regcred"` |  |
| redis.global.imageRegistry | string | `"symphonyfs.azurecr.io"` |  |
| redis.global.security.allowInsecureImages | bool | `true` |  |
| redis.image.tag | string | `"7.2.11-patched-debian-12-r9"` |  |
| redis.master.disableCommands | list | `[]` |  |
| redis.master.resources.limits.cpu | string | `"250m"` |  |
| redis.master.resources.limits.memory | string | `"256Mi"` |  |
| redis.master.resources.requests.cpu | string | `"50m"` |  |
| redis.master.resources.requests.memory | string | `"128Mi"` |  |
| redis.metrics.enabled | bool | `true` |  |
| redis.metrics.resources.limits.cpu | string | `"250m"` |  |
| redis.metrics.resources.limits.memory | string | `"128Mi"` |  |
| redis.metrics.resources.requests.cpu | string | `"50m"` |  |
| redis.metrics.resources.requests.memory | string | `"64Mi"` |  |
| redis.metrics.serviceMonitor.enabled | bool | `true` |  |
| redis.replica.disableCommands | list | `[]` |  |
| redis.replica.resources.limits.cpu | string | `"250m"` |  |
| redis.replica.resources.limits.memory | string | `"256Mi"` |  |
| redis.replica.resources.requests.cpu | string | `"50m"` |  |
| redis.replica.resources.requests.memory | string | `"128Mi"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-path" | string | `"/"` |  |
| reporting-dashboard-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| reporting-dashboard-ingress.enabled | bool | `true` |  |
| reporting-dashboard-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| reporting-dashboard-ingress.nameOverride | string | `"reporting-dashboard"` |  |
| reporting-dashboard-ingress.service[0].name | string | `"reporting-dashboard"` |  |
| reporting-dashboard-ingress.service[0].pathType | string | `"ImplementationSpecific"` |  |
| reporting-dashboard-ingress.service[0].paths[0] | string | `"/reporting"` |  |
| reporting-dashboard-ingress.service[0].port | int | `3001` |  |
| reporting-dashboard-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| reporting-dashboard-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| reporting-dashboard.enabled | bool | `true` |  |
| reporting-dashboard.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-reporting-poc"` |  |
| reporting-dashboard.image.tag | string | `"v1.10.8"` |  |
| search-indexing.fullnameOverride | string | `"search-indexing"` |  |
| search-indexing.resources.limits.cpu | string | `"2000m"` |  |
| search-indexing.resources.limits.memory | string | `"1Gi"` |  |
| search-indexing.resources.requests.cpu | string | `"500m"` |  |
| search-indexing.resources.requests.memory | string | `"512Mi"` |  |
| search-indexing.waitForMigrations.createStateConfigMap | bool | `false` |  |
| swagger-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| swagger-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| swagger-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| swagger-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| swagger-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| swagger-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| swagger-ingress.enabled | bool | `true` |  |
| swagger-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| swagger-ingress.nameOverride | string | `"swagger"` |  |
| swagger-ingress.service[0].name | string | `"api"` |  |
| swagger-ingress.service[0].pathType | string | `"Prefix"` |  |
| swagger-ingress.service[0].paths[0] | string | `"/docs-api"` |  |
| swagger-ingress.service[0].port | int | `3001` |  |
| swagger-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| swagger-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| tags.ai-doc-centre | bool | `false` |  |
| tags.copilotv2 | bool | `true` |  |
| tags.invhub-db-migration | bool | `false` |  |
| tags.keycloak | bool | `false` |  |
| tags.langfuse | bool | `false` |  |
| tags.logs | bool | `false` |  |
| tags.metrics | bool | `false` |  |
| tags.separate-api-responsibilities | bool | `false` |  |
| tags.traces | bool | `false` |  |
| tags.transactions-api | bool | `false` |  |
| tags.webv2 | bool | `false` |  |
| tempo-distributed.compactor.extraArgs[0] | string | `"-config.expand-env=true"` |  |
| tempo-distributed.compactor.extraEnv[0].name | string | `"MINIO_USER"` |  |
| tempo-distributed.compactor.extraEnv[0].valueFrom.secretKeyRef.key | string | `"root-user"` |  |
| tempo-distributed.compactor.extraEnv[0].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.compactor.extraEnv[1].name | string | `"MINIO_PASSWORD"` |  |
| tempo-distributed.compactor.extraEnv[1].valueFrom.secretKeyRef.key | string | `"root-password"` |  |
| tempo-distributed.compactor.extraEnv[1].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.distributor.extraArgs[0] | string | `"-config.expand-env=true"` |  |
| tempo-distributed.distributor.extraEnv[0].name | string | `"MINIO_USER"` |  |
| tempo-distributed.distributor.extraEnv[0].valueFrom.secretKeyRef.key | string | `"root-user"` |  |
| tempo-distributed.distributor.extraEnv[0].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.distributor.extraEnv[1].name | string | `"MINIO_PASSWORD"` |  |
| tempo-distributed.distributor.extraEnv[1].valueFrom.secretKeyRef.key | string | `"root-password"` |  |
| tempo-distributed.distributor.extraEnv[1].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.fullnameOverride | string | `"tempo"` |  |
| tempo-distributed.global.image.pullSecrets[0] | string | `"regcred"` |  |
| tempo-distributed.ingester.extraArgs[0] | string | `"-config.expand-env=true"` |  |
| tempo-distributed.ingester.extraEnv[0].name | string | `"MINIO_USER"` |  |
| tempo-distributed.ingester.extraEnv[0].valueFrom.secretKeyRef.key | string | `"root-user"` |  |
| tempo-distributed.ingester.extraEnv[0].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.ingester.extraEnv[1].name | string | `"MINIO_PASSWORD"` |  |
| tempo-distributed.ingester.extraEnv[1].valueFrom.secretKeyRef.key | string | `"root-password"` |  |
| tempo-distributed.ingester.extraEnv[1].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.querier.extraArgs[0] | string | `"-config.expand-env=true"` |  |
| tempo-distributed.querier.extraEnv[0].name | string | `"MINIO_USER"` |  |
| tempo-distributed.querier.extraEnv[0].valueFrom.secretKeyRef.key | string | `"root-user"` |  |
| tempo-distributed.querier.extraEnv[0].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.querier.extraEnv[1].name | string | `"MINIO_PASSWORD"` |  |
| tempo-distributed.querier.extraEnv[1].valueFrom.secretKeyRef.key | string | `"root-password"` |  |
| tempo-distributed.querier.extraEnv[1].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.queryFrontend.extraArgs[0] | string | `"-config.expand-env=true"` |  |
| tempo-distributed.queryFrontend.extraEnv[0].name | string | `"MINIO_USER"` |  |
| tempo-distributed.queryFrontend.extraEnv[0].valueFrom.secretKeyRef.key | string | `"root-user"` |  |
| tempo-distributed.queryFrontend.extraEnv[0].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.queryFrontend.extraEnv[1].name | string | `"MINIO_PASSWORD"` |  |
| tempo-distributed.queryFrontend.extraEnv[1].valueFrom.secretKeyRef.key | string | `"root-password"` |  |
| tempo-distributed.queryFrontend.extraEnv[1].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.storage.trace.backend | string | `"s3"` |  |
| tempo-distributed.storage.trace.s3.access_key | string | `"${MINIO_USER}"` |  |
| tempo-distributed.storage.trace.s3.bucket | string | `"tempo-traces"` |  |
| tempo-distributed.storage.trace.s3.endpoint | string | `"tempo-minio:9000"` |  |
| tempo-distributed.storage.trace.s3.insecure | bool | `true` |  |
| tempo-distributed.storage.trace.s3.secret_key | string | `"${MINIO_PASSWORD}"` |  |
| tempo-distributed.tempo.extraArgs[0] | string | `"-config.expand-env=true"` |  |
| tempo-distributed.tempo.extraEnv[0].name | string | `"MINIO_USER"` |  |
| tempo-distributed.tempo.extraEnv[0].valueFrom.secretKeyRef.key | string | `"root-user"` |  |
| tempo-distributed.tempo.extraEnv[0].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.tempo.extraEnv[1].name | string | `"MINIO_PASSWORD"` |  |
| tempo-distributed.tempo.extraEnv[1].valueFrom.secretKeyRef.key | string | `"root-password"` |  |
| tempo-distributed.tempo.extraEnv[1].valueFrom.secretKeyRef.name | string | `"tempo-minio-creds"` |  |
| tempo-distributed.traces.otlp.grpc.enabled | bool | `true` |  |
| tempo-distributed.traces.otlp.http.enabled | bool | `true` |  |
| tempo-minio.auth.existingSecret | string | `"tempo-minio-creds"` |  |
| tempo-minio.defaultBuckets | string | `"tempo-traces"` |  |
| tempo-minio.fullnameOverride | string | `"tempo-minio"` |  |
| tempo-minio.global.imagePullSecrets[0] | string | `"regcred"` |  |
| tempo-minio.metrics.prometheusAuthType | string | `"public"` |  |
| tempo-minio.metrics.serviceMonitor.enabled | bool | `true` |  |
| tempo-minio.mode | string | `"standalone"` |  |
| tempo-minio.persistence.size | string | `"200Gi"` |  |
| terrarium.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/terrarium"` |  |
| terrarium.image.tag | string | `"v2025.11"` |  |
| terrarium.resources.limits.cpu | string | `"2"` |  |
| terrarium.resources.limits.memory | string | `"2Gi"` |  |
| terrarium.resources.requests.cpu | string | `"500m"` |  |
| terrarium.resources.requests.memory | string | `"768Mi"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/proxy-body-size" | string | `"21m"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-path" | string | `"/"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| transac-api-ingress.annotations."nginx.ingress.kubernetes.io/use-regex" | string | `"true"` |  |
| transac-api-ingress.enabled | bool | `true` |  |
| transac-api-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| transac-api-ingress.nameOverride | string | `"transac-api"` |  |
| transac-api-ingress.service[0].name | string | `"transac-api"` |  |
| transac-api-ingress.service[0].pathType | string | `"ImplementationSpecific"` |  |
| transac-api-ingress.service[0].paths[0] | string | `"/v1/subjects/events/transactions"` |  |
| transac-api-ingress.service[0].paths[1] | string | `"/v1/subjects/events/[^/]+/status"` |  |
| transac-api-ingress.service[0].port | int | `3004` |  |
| transac-api-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| transac-api-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| transac-api.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-transactions-api"` |  |
| transac-api.image.tag | string | `"v2025.09"` |  |
| web.enabled | bool | `true` |  |
| web.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-web"` |  |
| web.image.tag | string | `"v2026.07.1"` |  |
| websearch.command[0] | string | `"sh"` |  |
| websearch.command[1] | string | `"-c"` |  |
| websearch.command[2] | string | `"uvicorn server:app --host 0.0.0.0 --port 8001"` |  |
| websearch.config.SEARCH_TERMS_ADDITIONAL | string | `""` |  |
| websearch.config.SEARCH_TERMS_OVERRIDE | string | `""` |  |
| websearch.engineName | string | `"websearch"` |  |
| websearch.envFromconfigMap | bool | `true` |  |
| websearch.fullnameOverride | string | `"invhub-websearch"` |  |
| websearch.image.pullPolicy | string | `"IfNotPresent"` |  |
| websearch.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-websearch-py"` |  |
| websearch.image.tag | string | `"v1.8.3"` |  |
| websearch.imagePullSecrets[0].name | string | `"regcred"` |  |
| websearch.replicaCount | int | `2` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/affinity" | string | `"cookie"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/proxy-body-size" | string | `"21m"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/proxy-connect-timeout" | string | `"60"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/proxy-read-timeout" | string | `"3600"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/proxy-send-timeout" | string | `"3600"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-expires" | string | `"172800"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-max-age" | string | `"172800"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-name" | string | `"stickcookie"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/session-cookie-path" | string | `"/webv2/"` |  |
| webv2-ingress.annotations."nginx.ingress.kubernetes.io/ssl-redirect" | string | `"true"` |  |
| webv2-ingress.enabled | bool | `true` |  |
| webv2-ingress.host | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| webv2-ingress.nameOverride | string | `"webv2"` |  |
| webv2-ingress.service[0].name | string | `"webv2"` |  |
| webv2-ingress.service[0].pathType | string | `"Prefix"` |  |
| webv2-ingress.service[0].paths[0] | string | `"/si2"` |  |
| webv2-ingress.service[0].port | int | `8080` |  |
| webv2-ingress.tls[0].hosts[0] | string | `"{{ include \"global.basename\" . }}.{{ include \"global.domain\" . }}"` |  |
| webv2-ingress.tls[0].secretName | string | `"ingress-tls"` |  |
| webv2.fullnameOverride | string | `"webv2"` |  |
| webv2.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-web"` |  |
| webv2.image.tag | string | `"v2-ih-poc.5"` |  |
| webv2.replicaCount | int | `2` |  |
