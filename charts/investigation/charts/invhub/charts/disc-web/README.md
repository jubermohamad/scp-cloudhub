# disc-web

![Version: 0.34.0](https://img.shields.io/badge/Version-0.34.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for installing Disclosure Web

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| flowsConfigMapName | string | `"flows"` |  |
| flowsSecretName | string | `"flows"` |  |
| fullnameOverride | string | `"disc-web"` |  |
| global.VITE_LOCAL_SERVICE_DISCOVERY | string | `"false"` |  |
| image.pullPolicy | string | `""` |  |
| image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-disc-web"` |  |
| image.tag | string | `""` |  |
| imagePullSecrets[0].name | string | `"regcred"` |  |
| livenessProbe.httpGet.path | string | `"/"` |  |
| livenessProbe.httpGet.port | string | `"http"` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations."configmap.reloader.stakater.com/reload" | string | `"flows"` |  |
| podDisruptionBudget.enabled | bool | `false` |  |
| podDisruptionBudget.maxUnavailable | int | `1` |  |
| podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` |  |
| readinessProbe.httpGet.path | string | `"/"` |  |
| readinessProbe.httpGet.port | string | `"http"` |  |
| replicaCount | int | `1` |  |
| resources.limits.cpu | string | `"200m"` |  |
| resources.limits.memory | string | `"256Mi"` |  |
| resources.requests.cpu | string | `"20m"` |  |
| resources.requests.memory | string | `"64Mi"` |  |
| securityContext.allowPrivilegeEscalation | bool | `false` |  |
| securityContext.readOnlyRootFilesystem | bool | `true` |  |
| service.port | int | `80` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| tls.enabled | bool | `true` |  |
| tolerations | list | `[]` |  |
| topologySpreadConstraints.enabled | bool | `false` |  |
| topologySpreadConstraints.maxSkew | int | `1` |  |
| topologySpreadConstraints.topologyKey | string | `"kubernetes.io/hostname"` |  |
| topologySpreadConstraints.whenUnsatisfiable | string | `"ScheduleAnyway"` |  |
