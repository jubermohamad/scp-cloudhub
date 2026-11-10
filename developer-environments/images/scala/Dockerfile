ARG BASE_IMAGE=companyacr.azurecr.io/cloudhub/dev/base:1.0.0
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="CloudHub Developer Scala"
LABEL org.opencontainers.image.description="Scala/Spark toolchain image for CloudHub SRI developer workspaces"

USER root
ARG JDK_MAJOR=17
ARG SCALA_VERSION=2.12.20
ARG SBT_VERSION=1.10.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-${JDK_MAJOR}-jdk \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://downloads.lightbend.com/scala/${SCALA_VERSION}/scala-${SCALA_VERSION}.tgz" -o /tmp/scala.tgz \
  && tar -xzf /tmp/scala.tgz -C /opt \
  && ln -s "/opt/scala-${SCALA_VERSION}/bin/scala" /usr/local/bin/scala \
  && ln -s "/opt/scala-${SCALA_VERSION}/bin/scalac" /usr/local/bin/scalac \
  && rm -f /tmp/scala.tgz

RUN curl -fsSL "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" -o /tmp/sbt.tgz \
  && tar -xzf /tmp/sbt.tgz -C /opt \
  && ln -s "/opt/sbt/bin/sbt" /usr/local/bin/sbt \
  && rm -f /tmp/sbt.tgz

USER developer
WORKDIR /workspaces
