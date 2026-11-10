ARG BASE_IMAGE=companyacr.azurecr.io/cloudhub/dev/base:1.0.0
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="CloudHub Developer Python"
LABEL org.opencontainers.image.description="Python toolchain image for CloudHub SRI developer workspaces"

USER root
ARG PYTHON_VERSION=3.11

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python${PYTHON_VERSION} \
    python3-pip \
    python3-venv \
    python-is-python3 \
  && rm -rf /var/lib/apt/lists/*

USER developer
WORKDIR /workspaces
