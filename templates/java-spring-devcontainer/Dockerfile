FROM mcr.microsoft.com/devcontainers/java:21

# SRI-specific Java tools for detection APIs and engines.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gradle \
    maven \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Spring Boot starter utility artifact.
RUN curl -fsSL https://start.spring.io/starter.zip -o /tmp/starter.zip

WORKDIR /workspace
