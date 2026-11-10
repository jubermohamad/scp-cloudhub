# opensearch-extensions

![Version: 0.13.0](https://img.shields.io/badge/Version-0.13.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

OpenSearch auxiliary resources (Certificates, ServiceMonitor)

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| certificates.admin.duration | string | `"8760h"` |  |
| certificates.admin.renewBefore | string | `"720h"` |  |
| certificates.ca.duration | string | `"87600h"` |  |
| certificates.ca.renewBefore | string | `"17520h"` |  |
| certificates.dashboard.duration | string | `"8760h"` |  |
| certificates.dashboard.renewBefore | string | `"720h"` |  |
| certificates.nodes.duration | string | `"17520h"` |  |
| certificates.nodes.renewBefore | string | `"2190h"` |  |
| clusterName | string | `"opensearch-cluster"` |  |
| nodeGroup | string | `"master"` |  |
