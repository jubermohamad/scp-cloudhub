ARG BASE_OS_IMAGE=ubuntu:22.04
FROM ${BASE_OS_IMAGE}

LABEL org.opencontainers.image.title="CloudHub Developer Base"
LABEL org.opencontainers.image.description="Common base image for CloudHub SRI developer workspaces"
LABEL org.opencontainers.image.vendor="CloudHub Platform Engineering"
LABEL org.opencontainers.image.licenses="UNLICENSED"

ARG DEBIAN_FRONTEND=noninteractive
ARG KUBECTL_VERSION=v1.30.4
ARG HELM_VERSION=v3.16.1
ARG GITHUB_CLI_VERSION=2.58.0
ARG DEV_USER=developer
ARG DEV_UID=10001
ARG DEV_GID=10001

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    jq \
    unzip \
    zip \
    bash \
    git \
    openssh-client \
    gnupg \
    lsb-release \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
  && chmod +x /usr/local/bin/kubectl

RUN curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" -o /tmp/helm.tgz \
  && tar -xzf /tmp/helm.tgz -C /tmp \
  && mv /tmp/linux-amd64/helm /usr/local/bin/helm \
  && chmod +x /usr/local/bin/helm \
  && rm -rf /tmp/helm.tgz /tmp/linux-amd64

RUN curl -fsSL https://aka.ms/InstallAzureCLIDeb | bash

RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GITHUB_CLI_VERSION}/gh_${GITHUB_CLI_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tgz \
  && tar -xzf /tmp/gh.tgz -C /tmp \
  && mv "/tmp/gh_${GITHUB_CLI_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
  && chmod +x /usr/local/bin/gh \
  && rm -rf /tmp/gh.tgz "/tmp/gh_${GITHUB_CLI_VERSION}_linux_amd64"

RUN groupadd --gid ${DEV_GID} ${DEV_USER} \
  && useradd --uid ${DEV_UID} --gid ${DEV_GID} --create-home --shell /bin/bash ${DEV_USER} \
  && mkdir -p /workspaces \
  && chown -R ${DEV_USER}:${DEV_USER} /workspaces /home/${DEV_USER}

USER ${DEV_USER}
WORKDIR /workspaces

ENV CLOUDHUB_WORKSPACE=true
