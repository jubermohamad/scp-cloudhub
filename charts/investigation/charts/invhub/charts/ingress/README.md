# ingress

![Version: 0.27.0](https://img.shields.io/badge/Version-0.27.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for ingress rules for Investigations Hub

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| annotations | object | `{}` |  |
| enableGlobalTlsSecret | bool | `true` |  |
| enabled | bool | `false` |  |
| host | string | `""` |  |
| ingressClassName | string | `"nginx"` |  |
| service | list | `[]` |  |
| tls | list | `[]` |  |
