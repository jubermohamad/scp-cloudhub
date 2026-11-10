# copilot

![Version: 0.39.0](https://img.shields.io/badge/Version-0.39.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for Kubernetes

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
| command[0] | string | `"sh"` |  |
| command[1] | string | `"-c"` |  |
| command[2] | string | `"uvicorn application:app --host 0.0.0.0 --port 8001"` |  |
| config | object | `{}` |  |
| engineName | string | `"copilot"` |  |
| envFromconfigMap | bool | `false` |  |
| fullnameOverride | string | `""` |  |
| global.copilot."METADATA_OVERRIDE_DIMENSIONS_TRANSACTION_TXNTYPE.INSTRUMENT_VALID_VALUES" | string | `"FORCUR,CASH,WIRE,CARD,OTHER,CHEQUE,MOBILEPAYMENT,TRANSF.PROP.ENT,COMISI. Y GTOS,TRANSF EXTRANJE,TRANSF.PROP.ENT,TRANSF.OTRA ENT,RCBS VARIOS,GIFTCARD,MARKETPLACE"` |  |
| global.copilot.AML_DETECTIONS_FILTER_ROWS | string | `"100"` |  |
| global.copilot.AML_DETECTIONS_INITIALSUMMARY_FILTER_ROWS | string | `"100"` |  |
| global.copilot.AML_DETECTION_FILTER_ROWS | string | `"100"` |  |
| global.copilot.AML_DETECTION_INITIALSUMMARY_FILTER_ROWS | string | `"100"` |  |
| global.copilot.AUTH_TYPE | string | `""` |  |
| global.copilot.AZURE_OPENAI_ENDPOINT_GPT35_16K | string | `"https://invhub-shared-oai.openai.azure.com/"` |  |
| global.copilot.AZURE_OPENAI_ENDPOINT_GPT4 | string | `"https://invhub-shared-oai.openai.azure.com/"` |  |
| global.copilot.AZURE_OPENAI_ENDPOINT_GPT4O | string | `"https://invhub-shared-oai.openai.azure.com/"` |  |
| global.copilot.AZURE_OPENAI_ENDPOINT_GPT4O_MINI | string | `"https://invhub-shared-apim-oai.azure-api.net/"` |  |
| global.copilot.AZURE_OPENAI_ENDPOINT_GPT4_32K | string | `"https://invhub-shared-oai.openai.azure.com/"` |  |
| global.copilot.CHAT_ENGINE | string | `"GPT4_demo_32"` |  |
| global.copilot.COMPONENT_LLM_MAPPING | string | `"{\"PLANNER\": \"gpt4o\",\"FOLLOW_UP\": \"gpt4o\"}"` |  |
| global.copilot.CONTEXT_ENGINE_TIMEOUT | string | `"300"` |  |
| global.copilot.CONTEXT_ENGINE_URL | string | `"http://invhub-context-engine:8001"` |  |
| global.copilot.CONTEXT_EXPIRE_TIME | string | `"3600"` |  |
| global.copilot.CUSTOM_PROMPTS_DIRECTORY | string | `"/app/genai/custom_prompts"` |  |
| global.copilot.DATA_ADAPTER_CLASS | string | `"sensa_data_adapter.sensa_data_adapter.SensaDataAdapter"` |  |
| global.copilot.DB_TYPE | string | `"postgresql"` |  |
| global.copilot.DEFAULT_API_RESULT_LIMIT | string | `"1000000"` |  |
| global.copilot.DEFAULT_FOLLOW_UP | string | `"HEURISTIC"` |  |
| global.copilot.DELAY | string | `"5"` |  |
| global.copilot.DEPLOYMENT_NAME_GPT35_16K | string | `"gpt-35-turbo_1106"` |  |
| global.copilot.DEPLOYMENT_NAME_GPT4 | string | `"gpt-4_1106-Preview"` |  |
| global.copilot.DEPLOYMENT_NAME_GPT4O | string | `"gpt-4o"` |  |
| global.copilot.DEPLOYMENT_NAME_GPT4O_MINI | string | `"gpt-4o-mini"` |  |
| global.copilot.DEPLOYMENT_NAME_GPT4_32K | string | `"GPT4_demo_32"` |  |
| global.copilot.DISABLE_CACHE | string | `"False"` |  |
| global.copilot.DISABLE_CALLBACKS | string | `"False"` |  |
| global.copilot.ENABLE_DIMENSION_INJECTION | string | `"False"` |  |
| global.copilot.ENABLE_FOLLOW_UP | string | `"True"` |  |
| global.copilot.ENABLE_GENERIC_CACHE | string | `"False"` |  |
| global.copilot.ENVIRONMENT_NAME | string | `"sensadev"` |  |
| global.copilot.EXCLUDED | string | `"[\"wikipedia\", \"linkedin\",\"facebook\", \"instagram\"]"` |  |
| global.copilot.GQL_EMAIL | string | `"copilotService@symphony.ai"` |  |
| global.copilot.INIT_CLASS | string | `"SensaAppInitializer"` |  |
| global.copilot.INIT_FILE | string | `"genai.sensa_app_init"` |  |
| global.copilot.INTERACTION_ENGINE_URL | string | `"http://invhub-interaction-engine:8001"` |  |
| global.copilot.INTROSPECTION_GQL_EMAIL | string | `"copilotService@symphony.ai"` |  |
| global.copilot.KEYCLOAK_REALM | string | `""` |  |
| global.copilot.KEYCLOAK_SERVER_URL | string | `""` |  |
| global.copilot.LANGFUSE_ENABLED | string | `"false"` |  |
| global.copilot.LLM_SERVICE | string | `"AZURE_OPENAI"` |  |
| global.copilot.LLM_SERVICE_MAPPER | string | `"{\"AZURE_OPENAI\": [\"gpt4_32k\", \"gpt35_16k\", \"gpt4\", \"gpt4o\", \"gpt4o_mini\"], \"APIM_LLMGATEWAY\": [\"mistral-small\"], \"AZURE_MISTRAL\": [\"mistral\"], \"AZURE_LLAMA\": [\"llama\"], \"AZURE_COHERE\": [\"cohere\"]}"` |  |
| global.copilot.LLM_TOOLS_MAPPING | string | `"{'TransactionFilteringDataRetrieval': ['gpt4o'], 'InitialSummaryDataRetrieval': ['gpt4o'], 'FinalNarrativeDataRetrieval': ['gpt4o'], 'Summary': ['gpt4o_mini'], 'Responder': ['gpt4o'], 'NarrativeGeneration': ['gpt4o'], 'WebSeekerDataRetrieval': ['gpt4o'], 'Summarize_and_classify': ['gpt4o_mini'], 'StructuringPatternAnalysisTool': ['gpt4o'], 'UnusualHoursDataRetrieval': ['gpt4o'], 'TransactionObfuscationAnalyzer': ['gpt4o'], 'AskBackForMoreInformation': ['gpt4o'], 'AMLDetectionsDataRetrieval': ['gpt4o'], 'SubjectDataRetrieval': ['gpt4o'], 'AccountsDataRetrieval': ['gpt4o'], 'TransactionsDataRetrieval': ['gpt4o'], 'ComplexQueryResponder': ['gpt4o'], 'LatestCDDRiskScoreDataRetrieval': ['gpt4o'], 'CDDRiskScoreHistoryDataRetrieval': ['gpt4o'], 'CustomerScreeningDataRetrieval': ['gpt4o'], 'PaymentFraudDataRetrieval': ['gpt4o'], 'DocumentRetrieval': ['gpt4o'], 'DocumentSummary': ['gpt4o'], 'DefaultTool': ['gpt4o'], 'LatestProfileDataRetrieval': ['gpt4o'], 'TransactionAnalysis': ['gpt4o'], 'ChartGeneration': ['gpt4o'], 'SubjectRelationshipDataRetrieval': ['gpt4o'], 'InvestigationsAnalysis': ['gpt4o']}"` |  |
| global.copilot.MAX_CONTEXT_WINDOW_SIZE | string | `"5"` |  |
| global.copilot.MAX_FOLLOW_UP | string | `"3"` |  |
| global.copilot.MODEL_NAME_GPT35_16K | string | `"gpt-35-turbo"` |  |
| global.copilot.MODEL_NAME_GPT4 | string | `"gpt-4"` |  |
| global.copilot.MODEL_NAME_GPT4O | string | `"gpt-4o"` |  |
| global.copilot.MODEL_NAME_GPT4O_MINI | string | `"gpt-4o-mini"` |  |
| global.copilot.MODEL_NAME_GPT4_32K | string | `"gpt-4-32k"` |  |
| global.copilot.OPENAI_API_KEY_GPT35_16K | string | `""` |  |
| global.copilot.OPENAI_API_KEY_GPT4 | string | `""` |  |
| global.copilot.OPENAI_API_KEY_GPT4O | string | `""` |  |
| global.copilot.OPENAI_API_KEY_GPT4O_MINI | string | `""` |  |
| global.copilot.OPENAI_API_KEY_GPT4_32K | string | `""` |  |
| global.copilot.OPENAI_API_TYPE_GPT35_16K | string | `"azure"` |  |
| global.copilot.OPENAI_API_TYPE_GPT4 | string | `"azure"` |  |
| global.copilot.OPENAI_API_TYPE_GPT4O | string | `"azure"` |  |
| global.copilot.OPENAI_API_TYPE_GPT4O_MINI | string | `"azure"` |  |
| global.copilot.OPENAI_API_TYPE_GPT4_32K | string | `"azure"` |  |
| global.copilot.OPENAI_API_VERSION | string | `"2024-02-15-preview"` |  |
| global.copilot.OPENAI_API_VERSION_GPT35_16K | string | `"2024-02-15-preview"` |  |
| global.copilot.OPENAI_API_VERSION_GPT4 | string | `"2024-02-15-preview"` |  |
| global.copilot.OPENAI_API_VERSION_GPT4O | string | `"2024-02-15-preview"` |  |
| global.copilot.OPENAI_API_VERSION_GPT4O_MINI | string | `"2024-02-15-preview"` |  |
| global.copilot.OPENAI_API_VERSION_GPT4_32K | string | `"2024-02-15-preview"` |  |
| global.copilot.OTEL_TOKEN_METRICS_EXPORT_ENABLED | string | `"true"` |  |
| global.copilot.OTEL_TRACELOOP_ENABLED | string | `"true"` |  |
| global.copilot.PGVECTOR_DB_HOST | string | `"cn-postgres-copilot-rw"` |  |
| global.copilot.PGVECTOR_DB_NAME | string | `"copilot"` |  |
| global.copilot.PGVECTOR_DB_PASSWORD | string | `"{{ .Values.global.PASSWORD }}"` |  |
| global.copilot.PGVECTOR_DB_PORT | int | `5432` |  |
| global.copilot.PGVECTOR_DB_USER | string | `"copilot"` |  |
| global.copilot.PREVIOUS_CONTEXT_SIZE | string | `"5"` |  |
| global.copilot.PRODUCTION_ENV | string | `"local"` |  |
| global.copilot.PROMPT_ENGINE_TIMEOUT | string | `"300"` |  |
| global.copilot.PROMPT_ENGINE_URL | string | `"http://invhub-prompt-engine:8001"` |  |
| global.copilot.PYTHONUNBUFFERED | string | `"1"` |  |
| global.copilot.PYTHON_SANDBOX_URL | string | `"http://terrarium:8080"` |  |
| global.copilot.RBAC_ENABLED | string | `"true"` |  |
| global.copilot.REACT_APP_SOCKET_IO_HANDSHAKE | string | `"/ws/Interaction_engine_sockets"` |  |
| global.copilot.REDIS_DECODE_RESPONSES | string | `"true"` |  |
| global.copilot.REDIS_HOST | string | `"redis-master"` |  |
| global.copilot.REDIS_PORT | string | `"6379"` |  |
| global.copilot.RELEASE_VERSION | string | `"1.7.0"` |  |
| global.copilot.RERUNS | string | `"1"` |  |
| global.copilot.RETURN_LINKS | string | `"15"` |  |
| global.copilot.RUN_ENV | string | `"local"` |  |
| global.copilot.SENSA_DATAADAPTER_ADDITIONAL_CONFIG | string | `"'{\n  \"source_config\": [\n    {\n      \"source\": \"INITIAL_SUMMARY\",\n      \"services\": [\n        {\n          \"service_name\": \"AML_DETECTION_INITIALSUMMARY\",\n          \"output_transform\": {\n            \"filter_rows\": 100\n          }\n        }\n      ]\n    },\n    {\n      \"source\": \"FINAL_NARRATIVE\",\n      \"services\": [\n        {\n          \"service_name\": \"AML_DETECTION\",\n          \"output_transform\": {\n            \"filter_rows\": 100\n          }\n        },\n       {\n          \"service_name\": \"TRANSACTIONS\",\n          \"output_transform\": {\n            \"filter_rows\": 100\n          }\n        }\n      ]\n    }\n  ]\n}'\n"` |  |
| global.copilot.SENSA_DATA_ADAPTER_CLASS | string | `"sensa_data_adapter.sensa_data_adapter.SensaDataAdapter"` |  |
| global.copilot.SENSA_URL_SCHEME | string | `"http"` |  |
| global.copilot.SERPAPI_API_KEY | string | `""` |  |
| global.copilot.SOCKETIO_PATH | string | `"/ws/Interaction_engine_sockets"` |  |
| global.copilot.TIMEOUT | int | `5` |  |
| global.copilot.TRACELOOP_BASE_URL | string | `"http://tempo-distributor:4318"` |  |
| global.copilot.TRACELOOP_TELEMETRY | string | `"false"` |  |
| global.copilot.TRACELOOP_TRACE_CONTENT | string | `"false"` |  |
| global.copilot.TRANSACTIONS_FILTER_ROWS | string | `"100"` |  |
| global.copilot.UI_RESPONSE_PATH | string | `"/interaction-engine/api/ui_responses"` |  |
| global.copilot.URL | string | `"http://invhub-interaction-engine:8001"` |  |
| global.copilot.VERTICAL | string | `"sensa"` |  |
| global.copilot.WEBSEARCH_URL | string | `"http://invhub-websearch:8001/api/v1/search"` |  |
| global.copilot.context_service | string | `"invhub-context-engine"` |  |
| global.copilot.interaction_service | string | `"invhub-interaction-engine"` |  |
| global.copilot.prompt_service | string | `"invhub-prompt-engine"` |  |
| global.copilot.websearch_svc | string | `"invhub-websearch"` |  |
| image.pullPolicy | string | `""` |  |
| image.repository | string | `"nginx"` |  |
| image.tag | string | `""` |  |
| imagePullSecrets[0].name | string | `"regcred"` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podDisruptionBudget.enabled | bool | `false` |  |
| podDisruptionBudget.maxUnavailable | int | `1` |  |
| podSecurityContext.runAsGroup | int | `10001` |  |
| podSecurityContext.runAsNonRoot | bool | `true` |  |
| podSecurityContext.runAsUser | int | `10001` |  |
| podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` |  |
| replicaCount | int | `1` |  |
| resources.limits.cpu | string | `"500m"` |  |
| resources.limits.memory | string | `"512Mi"` |  |
| resources.requests.cpu | string | `"50m"` |  |
| resources.requests.memory | string | `"128Mi"` |  |
| securityContext.allowPrivilegeEscalation | bool | `false` |  |
| securityContext.capabilities.drop[0] | string | `"ALL"` |  |
| securityContext.readOnlyRootFilesystem | bool | `true` |  |
| securityContext.runAsGroup | int | `10001` |  |
| securityContext.runAsNonRoot | bool | `true` |  |
| securityContext.runAsUser | int | `10001` |  |
| service.port | int | `8001` |  |
| service.portName | string | `"engine-port"` |  |
| service.targetPort | int | `8001` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| tolerations | list | `[]` |  |
| topologySpreadConstraints.enabled | bool | `false` |  |
| topologySpreadConstraints.maxSkew | int | `1` |  |
| topologySpreadConstraints.topologyKey | string | `"kubernetes.io/hostname"` |  |
| topologySpreadConstraints.whenUnsatisfiable | string | `"ScheduleAnyway"` |  |
| waitForDependencies.enabled | bool | `false` |  |
| waitForDependencies.image | string | `"docker.io/curlimages/curl:8.11.1"` |  |
| waitForDependencies.imagePullPolicy | string | `"IfNotPresent"` |  |
| waitForDependencies.postgres.enabled | bool | `false` |  |
| waitForDependencies.postgres.port | int | `5432` |  |
| waitForDependencies.postgres.service | string | `"cn-postgres-copilot-rw"` |  |
| waitForDependencies.redis.enabled | bool | `false` |  |
| waitForDependencies.redis.port | int | `6379` |  |
| waitForDependencies.redis.service | string | `"redis-master"` |  |
| waitForDependencies.resources.limits.cpu | string | `"100m"` |  |
| waitForDependencies.resources.limits.memory | string | `"64Mi"` |  |
| waitForDependencies.resources.requests.cpu | string | `"10m"` |  |
| waitForDependencies.resources.requests.memory | string | `"16Mi"` |  |
| waitForDependencies.terrarium.enabled | bool | `false` |  |
| waitForDependencies.terrarium.port | int | `8080` |  |
| waitForDependencies.terrarium.service | string | `"terrarium"` |  |
| waitForDependencies.timeoutSeconds | int | `1200` |  |
