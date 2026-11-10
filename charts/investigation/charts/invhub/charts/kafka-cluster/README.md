# kafka-cluster

![Version: 0.32.0](https://img.shields.io/badge/Version-0.32.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2026.07.1](https://img.shields.io/badge/AppVersion-v2026.07.1-informational?style=flat-square)

A Helm chart for installing kafka cluster with strimzi(operator installed separately)

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| entityOperator.template.pod.metadata.annotations."ad.datadoghq.com/topic-operator.checks" | string | `"{\n  \"strimzi\": {\n    \"instances\":[\n      {\n        \"topic_operator_endpoint\": \"http://%%host%%:8080/metrics\"\n      }\n    ]\n  }\n}\n"` |  |
| entityOperator.template.pod.metadata.annotations."ad.datadoghq.com/user-operator.checks" | string | `"{\n  \"strimzi\": {\n    \"instances\":[\n      {\n        \"user_operator_endpoint\": \"http://%%host%%:8081/metrics\"\n      }\n    ]\n  }\n}\n"` |  |
| entityOperator.topicOperator | object | `{}` |  |
| entityOperator.userOperator | object | `{}` |  |
| kafka.config."default.replication.factor" | int | `3` |  |
| kafka.config."inter.broker.protocol.version" | string | `"3.9"` |  |
| kafka.config."max.incremental.fetch.session.cache.slots" | int | `10000` |  |
| kafka.config."max.message.bytes" | int | `10485880` |  |
| kafka.config."message.max.bytes" | int | `10485880` |  |
| kafka.config."min.insync.replicas" | int | `2` |  |
| kafka.config."offsets.topic.replication.factor" | int | `3` |  |
| kafka.config."producer.compression.type" | string | `"producer"` |  |
| kafka.config."replica.fetch.max.bytes" | int | `10485880` |  |
| kafka.config."transaction.state.log.min.isr" | int | `2` |  |
| kafka.config."transaction.state.log.replication.factor" | int | `3` |  |
| kafka.listeners[0].name | string | `"plain"` |  |
| kafka.listeners[0].networkPolicyPeers | list | `[]` |  |
| kafka.listeners[0].port | int | `9092` |  |
| kafka.listeners[0].tls | bool | `false` |  |
| kafka.listeners[0].type | string | `"internal"` |  |
| kafka.listeners[1].name | string | `"tls"` |  |
| kafka.listeners[1].networkPolicyPeers | list | `[]` |  |
| kafka.listeners[1].port | int | `9093` |  |
| kafka.listeners[1].tls | bool | `true` |  |
| kafka.listeners[1].type | string | `"internal"` |  |
| kafka.storage.size | string | `"100Gi"` |  |
| kafka.template.pod.metadata.annotations."ad.datadoghq.com/kafka.checks" | string | `"{\n  \"kafka\": {\n    \"init_config\": {\n      \"is_jmx\": true,\n      \"collect_default_metrics\": true,\n      \"new_gc_metrics\": true\n    },\n    \"instances\":[\n      {\n        \"host\": \"%%host%%\",\n        \"port\": \"9999\"\n      }\n    ]\n  },\n  \"kafka_consumer\": {\n    \"init_config\": {},\n    \"instances\": [\n      {\n        \"kafka_connect_str\": \"%%host%%:9092\",\n        \"monitor_unlisted_consumer_groups\": \"true\"\n      }\n    ]\n  }\n}\n"` |  |
| kafka.version | string | `"3.9.0"` |  |
| kafkaExporter.groupRegex | string | `".*"` |  |
| kafkaExporter.logging | string | `"warn"` |  |
| kafkaExporter.template.pod.metadata.annotations."prometheus.io/port" | string | `"9404"` |  |
| kafkaExporter.template.pod.metadata.annotations."prometheus.io/scrape" | string | `"true"` |  |
| metrics.enabled | bool | `false` |  |
| name | string | `"invhub"` |  |
| replicas | int | `3` |  |
| storageSize | string | `"100Gi"` |  |
| zookeeper.jvmOptions.javaSystemProperties[0].name | string | `"zookeeper.ssl.hostnameVerification"` |  |
| zookeeper.jvmOptions.javaSystemProperties[0].value | string | `"false"` |  |
| zookeeper.jvmOptions.javaSystemProperties[1].name | string | `"zookeeper.ssl.quorum.hostnameVerification"` |  |
| zookeeper.jvmOptions.javaSystemProperties[1].value | string | `"false"` |  |
| zookeeper.replicas | int | `3` |  |
| zookeeper.storage.size | string | `"100Gi"` |  |
| zookeeper.template.pod.metadata.annotations."ad.datadoghq.com/zookeeper.checks" | string | `"{\n  \"zk\": {\n    \"instances\":[\n      {\n        \"host\":\"%%host%%\",\"port\":\"2181\"\n      }\n    ]\n  }\n}\n"` |  |
