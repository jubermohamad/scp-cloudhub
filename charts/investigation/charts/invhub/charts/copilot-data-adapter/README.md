# copilot-data-adapter

![Version: 0.31.0](https://img.shields.io/badge/Version-0.31.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for Copilot data adapter

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
| dbRootCert.secretName | string | `"cn-postgres-copilot-data-adapter-ca"` |  |
| extraEnv | list | `[]` |  |
| extraSecretEnv | list | `[]` |  |
| fullnameOverride | string | `"copilot-data-adapter"` |  |
| image.pullPolicy | string | `""` |  |
| image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-copilot-data-adapter"` |  |
| image.tag | string | `""` |  |
| imagePullSecrets[0].name | string | `"regcred"` |  |
| livenessProbe.failureThreshold | int | `6` |  |
| livenessProbe.httpGet.path | string | `"/api/v1"` |  |
| livenessProbe.httpGet.port | string | `"http"` |  |
| livenessProbe.initialDelaySeconds | int | `30` |  |
| livenessProbe.periodSeconds | int | `12` |  |
| livenessProbe.timeoutSeconds | int | `10` |  |
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
| readinessProbe.httpGet.path | string | `"/api/v1"` |  |
| readinessProbe.httpGet.port | string | `"http"` |  |
| readinessProbe.initialDelaySeconds | int | `10` |  |
| readinessProbe.periodSeconds | int | `12` |  |
| readinessProbe.timeoutSeconds | int | `10` |  |
| replicaCount | int | `1` |  |
| resources.limits.cpu | string | `"1"` |  |
| resources.limits.memory | string | `"2Gi"` |  |
| resources.requests.cpu | string | `"200m"` |  |
| resources.requests.memory | string | `"512Mi"` |  |
| secrets.bearerToken | string | `"bearer_token"` |  |
| securityContext.allowPrivilegeEscalation | bool | `false` |  |
| securityContext.capabilities.drop[0] | string | `"ALL"` |  |
| securityContext.readOnlyRootFilesystem | bool | `true` |  |
| securityContext.runAsGroup | int | `10001` |  |
| securityContext.runAsNonRoot | bool | `true` |  |
| securityContext.runAsUser | int | `10001` |  |
| service.port | int | `8000` |  |
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
| waitForDependencies.postgres.service | string | `"cn-postgres-copilot-data-adapter-rw"` |  |
| waitForDependencies.resources.limits.cpu | string | `"100m"` |  |
| waitForDependencies.resources.limits.memory | string | `"64Mi"` |  |
| waitForDependencies.resources.requests.cpu | string | `"10m"` |  |
| waitForDependencies.resources.requests.memory | string | `"16Mi"` |  |
| waitForDependencies.timeoutSeconds | int | `1200` |  |
