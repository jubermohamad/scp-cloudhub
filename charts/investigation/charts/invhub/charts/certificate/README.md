# certificate

![Version: 0.27.0](https://img.shields.io/badge/Version-0.27.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for ingress tls certificate

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| host | string | `"example.com"` |  |
| issuerRef.kind | string | `"ClusterIssuer"` |  |
| issuerRef.name | string | `"letsencrypt-staging"` |  |
| organization | string | `"Example Company Name"` |  |
