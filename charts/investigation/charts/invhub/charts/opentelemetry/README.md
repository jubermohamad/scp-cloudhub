# opentelemetry

![Version: 0.26.0](https://img.shields.io/badge/Version-0.26.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for Cluster Issuers for opentelemetry resources

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| jaegerUrl | string | `"jaeger-collector:4317"` |  |
| otelCollectorUrl | string | `"http://otel-collector-collector:4317"` |  |
| tempoUrl | string | `"tempo-distributor:4317"` |  |
