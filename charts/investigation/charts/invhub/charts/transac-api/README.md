# transac-api

![Version: 0.30.0](https://img.shields.io/badge/Version-0.30.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for installing Investigations Hub

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.labelSelector.matchExpressions[0].key | string | `"app.kubernetes.io/name"` |  |
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.labelSelector.matchExpressions[0].operator | string | `"In"` |  |
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.labelSelector.matchExpressions[0].values[0] | string | `"transac-api"` |  |
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.topologyKey | string | `"topology.kubernetes.io/zone"` |  |
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight | int | `100` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| calicoNetworkPolicy.egress[0].action | string | `"Allow"` |  |
| calicoNetworkPolicy.enabled | bool | `false` |  |
| calicoNetworkPolicy.ingress[0].action | string | `"Allow"` |  |
| calicoNetworkPolicy.ingress[0].destination.ports[0] | int | `3004` |  |
| calicoNetworkPolicy.ingress[0].protocol | string | `"TCP"` |  |
| calicoNetworkPolicy.ingress[0].source | object | `{}` |  |
| dbRootCert.key | string | `"ca.crt"` |  |
| dbRootCert.mountPath | string | `"/pg-ca-cert"` |  |
| dbRootCert.secretName | string | `"cn-postgres-transactions-ca"` |  |
| fullnameOverride | string | `"transac-api"` |  |
| global.API_DOCS | bool | `true` |  |
| global.API_PORT | int | `3004` |  |
| global.INVESTIGATION_HUB_SERVICE_ACCOUNT_EMAIL | string | `"transactionsService@symphony.ai"` |  |
| global.MINIO_SSL_CA_PATH | string | `"/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"` |  |
| global.NODE_ENV | string | `"production"` |  |
| global.SENSA_HEALTH_THROTTLE_LIMIT | int | `20` |  |
| global.SENSA_KAFKA_BOOTSTRAP | string | `"invhub-kafka-bootstrap:9093"` |  |
| global.SENSA_KAFKA_HEARTBEAT_INTERVAL | int | `15000` |  |
| global.SENSA_KAFKA_INITIAL_RETRY_TIME | int | `5000` |  |
| global.SENSA_KAFKA_MAX_BYTES | string | `"10485880"` |  |
| global.SENSA_KAFKA_RETRIES | int | `3` |  |
| global.SENSA_KAFKA_SESSION_TIMEOUT | int | `45000` |  |
| global.SENSA_KAFKA_SSL | string | `"true"` |  |
| global.SENSA_KAFKA_SSL_CA_PATH | string | `"/kafka-ca-cert/ca.crt"` |  |
| global.SENSA_LOG_LEVEL | string | `"info"` |  |
| global.SENSA_REDIS_URL | string | `"redis://redis-master:6379"` |  |
| global.SENSA_THROTTLE_LIMIT | int | `100` |  |
| global.SENSA_THROTTLE_TTL | int | `60` |  |
| image.pullPolicy | string | `""` |  |
| image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-transactions-api"` |  |
| image.tag | string | `""` |  |
| imagePullSecrets[0].name | string | `"regcred"` |  |
| kafkaRootCert.key | string | `"ca.crt"` |  |
| kafkaRootCert.mountPath | string | `"/kafka-ca-cert"` |  |
| kafkaRootCert.secretName | string | `"invhub-clients-ca-cert"` |  |
| livenessProbe | object | `{}` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podDisruptionBudget.enabled | bool | `false` |  |
| podDisruptionBudget.maxUnavailable | int | `1` |  |
| podSecurityContext | object | `{}` |  |
| readinessProbe.httpGet.path | string | `"/v1/health/liveness"` |  |
| readinessProbe.httpGet.port | string | `"transac-api"` |  |
| readinessProbe.initialDelaySeconds | int | `10` |  |
| readinessProbe.periodSeconds | int | `20` |  |
| readinessProbe.successThreshold | int | `1` |  |
| readinessProbe.timeoutSeconds | int | `10` |  |
| replicaCount | int | `2` |  |
| resources | object | `{}` |  |
| securityContext | object | `{}` |  |
| service.ports[0].name | string | `"transac-api"` |  |
| service.ports[0].port | int | `3004` |  |
| service.ports[0].protocol | string | `"TCP"` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| tolerations | list | `[]` |  |
| topologySpreadConstraints.enabled | bool | `false` |  |
| topologySpreadConstraints.maxSkew | int | `1` |  |
| topologySpreadConstraints.topologyKey | string | `"kubernetes.io/hostname"` |  |
| topologySpreadConstraints.whenUnsatisfiable | string | `"ScheduleAnyway"` |  |
