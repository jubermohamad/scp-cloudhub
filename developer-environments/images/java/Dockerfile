ARG BASE_IMAGE=companyacr.azurecr.io/cloudhub/dev/base:1.0.0
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="CloudHub Developer Java"
LABEL org.opencontainers.image.description="Java toolchain image for CloudHub SRI developer workspaces"

USER root
ARG JDK_MAJOR=17
ARG MAVEN_VERSION=3.9.9
ARG GRADLE_VERSION=8.10.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-${JDK_MAJOR}-jdk \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.tar.gz" -o /tmp/maven.tgz \
  && tar -xzf /tmp/maven.tgz -C /opt \
  && ln -s "/opt/apache-maven-${MAVEN_VERSION}/bin/mvn" /usr/local/bin/mvn \
  && rm -f /tmp/maven.tgz

RUN curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip \
  && unzip -q /tmp/gradle.zip -d /opt \
  && ln -s "/opt/gradle-${GRADLE_VERSION}/bin/gradle" /usr/local/bin/gradle \
  && rm -f /tmp/gradle.zip

USER developer
WORKDIR /workspaces
