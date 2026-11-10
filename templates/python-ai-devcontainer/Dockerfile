FROM mcr.microsoft.com/devcontainers/python:3.11

# SRI-specific Python tools for investigation, data, sanctions, and agents domains.
RUN pip install --no-cache-dir \
    fastapi==0.109.0 \
    uvicorn==0.27.0 \
    confluent-kafka==2.3.0 \
    temporalio==1.5.0 \
    psycopg2-binary==2.9.9 \
    pytest==8.0.0 \
    ruff==0.1.0

# Temporal CLI.
RUN curl -fsSL https://temporal.download/cli.sh | bash

# Kafka CLI tooling.
RUN apt-get update && apt-get install -y --no-install-recommends \
    kafkacat \
    && rm -rf /var/lib/apt/lists/*

# Kubernetes and Helm CLIs.
RUN curl -fsSL -o /usr/local/bin/kubectl https://dl.k8s.io/release/v1.28.0/bin/linux/amd64/kubectl \
    && chmod +x /usr/local/bin/kubectl
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

WORKDIR /workspace
