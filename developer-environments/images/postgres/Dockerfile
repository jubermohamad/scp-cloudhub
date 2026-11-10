ARG BASE_IMAGE=companyacr.azurecr.io/cloudhub/dev/base:1.0.0
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="CloudHub Developer PostgreSQL"
LABEL org.opencontainers.image.description="PostgreSQL tooling image for CloudHub SRI developer workspaces"

USER root
ARG JDK_MAJOR=17

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-client \
    openjdk-${JDK_MAJOR}-jdk \
  && rm -rf /var/lib/apt/lists/*

USER developer
WORKDIR /workspaces
