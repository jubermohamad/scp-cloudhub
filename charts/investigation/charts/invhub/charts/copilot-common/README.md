# copilot-common

![Version: 0.24.0](https://img.shields.io/badge/Version-0.24.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for common resources used by Copilot applications

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| config.azureDeploymentName | string | `""` |  |
| config.azureDeploymentNameSupervisor | string | `""` |  |
| config.azureEmbeddingsDeployment | string | `""` |  |
| config.azureEmbeddingsEndpoint | string | `""` |  |
| config.azureEmbeddingsModel | string | `""` |  |
| config.azureOpenAIApiVersion | string | `""` |  |
| config.azureOpenAIApiVersionSupervisor | string | `""` |  |
| config.azureOpenAIEndpoint | string | `""` |  |
| config.openAIApiVersion | string | `""` |  |
| fullnameOverride | string | `"copilot-common"` |  |
| nameOverride | string | `""` |  |
| secrets.azureEmbeddingsKey | string | `""` |  |
| secrets.azureOpenAIKey | string | `""` |  |
| secrets.tavilyApiKey | string | `""` |  |
