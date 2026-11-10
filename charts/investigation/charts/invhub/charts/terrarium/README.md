# terrarium

![Version: 0.29.0](https://img.shields.io/badge/Version-0.29.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for terrarium component

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| calicoNetworkPolicy.egress[0].action | string | `"Allow"` |  |
| calicoNetworkPolicy.enabled | bool | `false` |  |
| calicoNetworkPolicy.ingress[0].action | string | `"Allow"` |  |
| calicoNetworkPolicy.ingress[0].destination.ports[0] | int | `8001` |  |
| calicoNetworkPolicy.ingress[0].protocol | string | `"TCP"` |  |
| calicoNetworkPolicy.ingress[0].source | object | `{}` |  |
| engineName | string | `"terrarium"` |  |
| env[0].name | string | `"terrarium_svc"` |  |
| env[0].value | string | `"terrarium"` |  |
| fullnameOverride | string | `"terrarium"` |  |
| image.pullPolicy | string | `""` |  |
| image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/terrarium"` |  |
| image.tag | string | `""` |  |
| imagePullSecrets[0].name | string | `"regcred"` |  |
| livenessProbe | object | `{}` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podDisruptionBudget.enabled | bool | `false` |  |
| podDisruptionBudget.maxUnavailable | int | `1` |  |
| podSecurityContext.runAsGroup | int | `10001` |  |
| podSecurityContext.runAsNonRoot | bool | `true` |  |
| podSecurityContext.runAsUser | int | `10001` |  |
| podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` |  |
| readinessProbe | object | `{}` |  |
| replicaCount | int | `2` |  |
| resources.limits.cpu | string | `"500m"` |  |
| resources.limits.memory | string | `"512Mi"` |  |
| resources.requests.cpu | string | `"100m"` |  |
| resources.requests.memory | string | `"228Mi"` |  |
| secrets | list | `[]` |  |
| securityContext.allowPrivilegeEscalation | bool | `false` |  |
| securityContext.capabilities.drop[0] | string | `"ALL"` |  |
| securityContext.readOnlyRootFilesystem | bool | `true` |  |
| securityContext.runAsGroup | int | `10001` |  |
| securityContext.runAsNonRoot | bool | `true` |  |
| securityContext.runAsUser | int | `10001` |  |
| service.port | int | `8080` |  |
| service.portName | string | `"engine-port"` |  |
| service.targetPort | int | `8080` |  |
| service.type | string | `"ClusterIP"` |  |
| tolerations | list | `[]` |  |
| topologySpreadConstraints.enabled | bool | `false` |  |
| topologySpreadConstraints.maxSkew | int | `1` |  |
| topologySpreadConstraints.topologyKey | string | `"kubernetes.io/hostname"` |  |
| topologySpreadConstraints.whenUnsatisfiable | string | `"ScheduleAnyway"` |  |
| volumeMounts[0].mountPath | string | `"/usr/src/app/pyodide_cache"` |  |
| volumeMounts[0].name | string | `"pyodide-cache"` |  |
| volumes[0].emptyDir.sizeLimit | string | `"256Mi"` |  |
| volumes[0].name | string | `"pyodide-cache"` |  |
