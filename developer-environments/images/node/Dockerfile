ARG BASE_IMAGE=companyacr.azurecr.io/cloudhub/dev/base:1.0.0
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="CloudHub Developer Node"
LABEL org.opencontainers.image.description="Node.js toolchain image for CloudHub SRI developer workspaces"

USER root
ARG NODE_MAJOR=22

RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && npm install -g npm@10 \
  && rm -rf /var/lib/apt/lists/*

USER developer
WORKDIR /workspaces
