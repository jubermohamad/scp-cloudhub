# copilotv2

![Version: 0.31.0](https://img.shields.io/badge/Version-0.31.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for Copilot v2

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| copilotCommonConfigMapName | string | `"copilot-common"` |  |
| copilotCommonSecretName | string | `"copilot-common"` |  |
| dbRootCert.key | string | `"ca.crt"` |  |
| dbRootCert.mountPath | string | `"/pg-ca-cert"` |  |
| dbRootCert.secretName | string | `"cn-postgres-copilotv2-ca"` |  |
| extraEnv | list | `[]` |  |
| extraSecretEnv | list | `[]` |  |
| fullnameOverride | string | `"copilotv2"` |  |
| image.pullPolicy | string | `""` |  |
| image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-copilot"` |  |
| image.tag | string | `""` |  |
| imagePullSecrets[0].name | string | `"regcred"` |  |
| initContainers.dbMigration.args[0] | string | `"upgrade"` |  |
| initContainers.dbMigration.args[1] | string | `"2.5.0"` |  |
| initContainers.dbMigration.image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/eureka-copilot-v2-db-migration"` |  |
| initContainers.dbMigration.image.tag | string | `"2.5.0"` |  |
| initContainers.dbMigration.resources.limits.cpu | string | `"500m"` |  |
| initContainers.dbMigration.resources.limits.memory | string | `"512Mi"` |  |
| initContainers.dbMigration.resources.requests.cpu | string | `"100m"` |  |
| initContainers.dbMigration.resources.requests.memory | string | `"256Mi"` |  |
| initContainers.dbMigration.securityContext.allowPrivilegeEscalation | bool | `false` |  |
| initContainers.dbMigration.securityContext.capabilities.drop[0] | string | `"ALL"` |  |
| initContainers.dbMigration.securityContext.readOnlyRootFilesystem | bool | `true` |  |
| initContainers.dbMigration.securityContext.runAsGroup | int | `10001` |  |
| initContainers.dbMigration.securityContext.runAsNonRoot | bool | `true` |  |
| initContainers.dbMigration.securityContext.runAsUser | int | `10001` |  |
| livenessProbe.failureThreshold | int | `6` |  |
| livenessProbe.httpGet.path | string | `"/v2/liveness"` |  |
| livenessProbe.httpGet.port | string | `"http"` |  |
| livenessProbe.initialDelaySeconds | int | `60` |  |
| livenessProbe.periodSeconds | int | `10` |  |
| livenessProbe.timeoutSeconds | int | `5` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations."configmap.reloader.stakater.com/reload" | string | `"copilot-common"` |  |
| podAnnotations."secret.reloader.stakater.com/reload" | string | `"copilot-common"` |  |
| podDisruptionBudget.enabled | bool | `false` |  |
| podDisruptionBudget.maxUnavailable | int | `1` |  |
| podSecurityContext.runAsGroup | int | `10001` |  |
| podSecurityContext.runAsNonRoot | bool | `true` |  |
| podSecurityContext.runAsUser | int | `10001` |  |
| podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` |  |
| readinessProbe.failureThreshold | int | `6` |  |
| readinessProbe.httpGet.path | string | `"/v2/readiness"` |  |
| readinessProbe.httpGet.port | string | `"http"` |  |
| readinessProbe.initialDelaySeconds | int | `20` |  |
| readinessProbe.periodSeconds | int | `10` |  |
| readinessProbe.timeoutSeconds | int | `5` |  |
| replicaCount | int | `1` |  |
| resources.limits.cpu | string | `"1"` |  |
| resources.limits.memory | string | `"2Gi"` |  |
| resources.requests.cpu | string | `"200m"` |  |
| resources.requests.memory | string | `"512Mi"` |  |
| securityContext.allowPrivilegeEscalation | bool | `false` |  |
| securityContext.capabilities.drop[0] | string | `"ALL"` |  |
| securityContext.readOnlyRootFilesystem | bool | `true` |  |
| securityContext.runAsGroup | int | `10001` |  |
| securityContext.runAsNonRoot | bool | `true` |  |
| securityContext.runAsUser | int | `10001` |  |
| service.port | int | `3006` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| tolerations | list | `[]` |  |
| topologySpreadConstraints.enabled | bool | `false` |  |
| topologySpreadConstraints.maxSkew | int | `1` |  |
| topologySpreadConstraints.topologyKey | string | `"kubernetes.io/hostname"` |  |
| topologySpreadConstraints.whenUnsatisfiable | string | `"ScheduleAnyway"` |  |
| waitForDependencies.enabled | bool | `true` |  |
| waitForDependencies.image | string | `"docker.io/curlimages/curl:8.11.1"` |  |
| waitForDependencies.imagePullPolicy | string | `"IfNotPresent"` |  |
| waitForDependencies.postgres.enabled | bool | `true` |  |
| waitForDependencies.postgres.port | int | `5432` |  |
| waitForDependencies.postgres.service | string | `"cn-postgres-copilotv2-rw"` |  |
| waitForDependencies.resources.limits.cpu | string | `"100m"` |  |
| waitForDependencies.resources.limits.memory | string | `"64Mi"` |  |
| waitForDependencies.resources.requests.cpu | string | `"10m"` |  |
| waitForDependencies.resources.requests.memory | string | `"16Mi"` |  |
| waitForDependencies.terrarium.enabled | bool | `true` |  |
| waitForDependencies.terrarium.port | int | `8080` |  |
| waitForDependencies.terrarium.service | string | `"terrarium"` |  |
| waitForDependencies.timeoutSeconds | int | `1200` |  |
