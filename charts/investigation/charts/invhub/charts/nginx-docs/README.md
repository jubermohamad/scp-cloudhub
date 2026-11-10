# nginx-docs

![Version: 0.27.0](https://img.shields.io/badge/Version-0.27.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for Documentation

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| calicoNetworkPolicy.egress[0].action | string | `"Allow"` |  |
| calicoNetworkPolicy.enabled | bool | `false` |  |
| calicoNetworkPolicy.ingress[0].action | string | `"Allow"` |  |
| calicoNetworkPolicy.ingress[0].destination.ports[0] | int | `80` |  |
| calicoNetworkPolicy.ingress[0].protocol | string | `"TCP"` |  |
| calicoNetworkPolicy.ingress[0].source | object | `{}` |  |
| fullnameOverride | string | `""` |  |
| image.pullPolicy | string | `""` |  |
| image.tag | string | `"master"` |  |
| imagePullSecrets[0].name | string | `"regcred"` |  |
| livenessProbe | object | `{}` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podDisruptionBudget.enabled | bool | `false` |  |
| podDisruptionBudget.maxUnavailable | int | `1` |  |
| podSecurityContext | object | `{}` |  |
| readinessProbe.initialDelaySeconds | int | `10` |  |
| readinessProbe.periodSeconds | int | `20` |  |
| readinessProbe.successThreshold | int | `1` |  |
| readinessProbe.timeoutSeconds | int | `10` |  |
| replicaCount | int | `1` |  |
| resources.limits.cpu | string | `"200m"` |  |
| resources.limits.memory | string | `"256Mi"` |  |
| resources.requests.cpu | string | `"20m"` |  |
| resources.requests.memory | string | `"64Mi"` |  |
| securityContext | object | `{}` |  |
| service.port | int | `80` |  |
| service.type | string | `"ClusterIP"` |  |
| tolerations | list | `[]` |  |
| topologySpreadConstraints.enabled | bool | `false` |  |
| topologySpreadConstraints.maxSkew | int | `1` |  |
| topologySpreadConstraints.topologyKey | string | `"kubernetes.io/hostname"` |  |
| topologySpreadConstraints.whenUnsatisfiable | string | `"ScheduleAnyway"` |  |
