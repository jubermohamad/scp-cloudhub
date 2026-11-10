# clamavd

![Version: 0.28.0](https://img.shields.io/badge/Version-0.28.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for ClamAV deamon

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.labelSelector.matchExpressions[0].key | string | `"app.kubernetes.io/name"` |  |
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.labelSelector.matchExpressions[0].operator | string | `"In"` |  |
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.labelSelector.matchExpressions[0].values[0] | string | `"clamavd"` |  |
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.topologyKey | string | `"topology.kubernetes.io/zone"` |  |
| affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight | int | `100` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| calicoNetworkPolicy.egress[0].action | string | `"Allow"` |  |
| calicoNetworkPolicy.enabled | bool | `false` |  |
| calicoNetworkPolicy.ingress[0].action | string | `"Allow"` |  |
| calicoNetworkPolicy.ingress[0].destination.ports[0] | int | `3310` |  |
| calicoNetworkPolicy.ingress[0].protocol | string | `"TCP"` |  |
| calicoNetworkPolicy.ingress[0].source | object | `{}` |  |
| fullnameOverride | string | `"clamavd"` |  |
| global.CLAMAV_MAX_FILE_SIZE | string | `"35M"` |  |
| global.CLAMAV_MAX_SCAN_SIZE | string | `"35M"` |  |
| global.CLAMAV_STREAM_MAX_LENGTH | string | `"35M"` |  |
| image.pullPolicy | string | `""` |  |
| image.repository | string | `"symphonyfs.azurecr.io/symphonysensa/invhub-clamav"` |  |
| image.tag | string | `"master"` |  |
| imagePullSecrets[0].name | string | `"regcred"` |  |
| livenessProbe | object | `{}` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podDisruptionBudget.enabled | bool | `false` |  |
| podDisruptionBudget.maxUnavailable | int | `1` |  |
| podSecurityContext.fsGroup | int | `101` |  |
| podSecurityContext.runAsGroup | int | `101` |  |
| podSecurityContext.runAsNonRoot | bool | `true` |  |
| podSecurityContext.runAsUser | int | `100` |  |
| podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` |  |
| readinessProbe.initialDelaySeconds | int | `180` |  |
| readinessProbe.tcpSocket.port | string | `"clamavd"` |  |
| replicaCount | int | `1` |  |
| resources.limits.cpu | int | `1` |  |
| resources.limits.memory | string | `"6Gi"` |  |
| resources.requests.cpu | string | `"100m"` |  |
| resources.requests.memory | string | `"4Gi"` |  |
| securityContext.allowPrivilegeEscalation | bool | `false` |  |
| securityContext.capabilities.drop[0] | string | `"ALL"` |  |
| securityContext.readOnlyRootFilesystem | bool | `true` |  |
| securityContext.runAsGroup | int | `101` |  |
| securityContext.runAsNonRoot | bool | `true` |  |
| securityContext.runAsUser | int | `100` |  |
| service.port | int | `3310` |  |
| service.portName | string | `"http"` |  |
| service.targetPort | int | `3310` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| tolerations | list | `[]` |  |
| topologySpreadConstraints.enabled | bool | `false` |  |
| topologySpreadConstraints.maxSkew | int | `1` |  |
| topologySpreadConstraints.topologyKey | string | `"kubernetes.io/hostname"` |  |
| topologySpreadConstraints.whenUnsatisfiable | string | `"ScheduleAnyway"` |  |
