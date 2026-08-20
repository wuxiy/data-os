FROM eclipse-temurin:21-jre-alpine

ARG SEATUNNEL_VERSION=2.3.13
ARG SEATUNNEL_DIST_SHA512
ARG SEATUNNEL_DIST_URL=https://downloads.apache.org/seatunnel/2.3.13/apache-seatunnel-2.3.13-bin.tar.gz
ARG CONNECTOR_MAVEN_BASE=https://repo.maven.apache.org/maven2
ARG CONNECTOR_JDBC_VERSION=2.3.13
ARG CONNECTOR_JDBC_SHA256
ARG CONNECTOR_DORIS_VERSION=2.3.13
ARG CONNECTOR_DORIS_SHA256
ARG CONNECTOR_FILE_S3_VERSION=2.3.13
ARG CONNECTOR_FILE_S3_SHA256
ARG OFFLINE_BUILD=false

RUN apk add --no-cache bash ca-certificates curl \
    && addgroup -S -g 10001 seatunnel \
    && adduser -S -D -H -u 10001 -G seatunnel seatunnel \
    && mkdir -p /tmp/seatunnel-assets /opt/seatunnel

WORKDIR /opt/seatunnel

COPY connector-cache/ /tmp/seatunnel-assets/

RUN set -eu; \
    if [ -z "${SEATUNNEL_DIST_SHA512}" ]; then echo 'SEATUNNEL_DIST_SHA512 is required' >&2; exit 64; fi; \
    if [ "${OFFLINE_BUILD}" = "true" ]; then \
      test -s /tmp/seatunnel-assets/apache-seatunnel-${SEATUNNEL_VERSION}-bin.tar.gz || \
        { echo 'offline build requires the SeaTunnel distribution cache' >&2; exit 64; }; \
      cp /tmp/seatunnel-assets/apache-seatunnel-${SEATUNNEL_VERSION}-bin.tar.gz /tmp/seatunnel.tar.gz; \
    else \
      curl -fL --retry 3 --retry-delay 2 "${SEATUNNEL_DIST_URL}" -o /tmp/seatunnel.tar.gz; \
    fi; \
    echo "${SEATUNNEL_DIST_SHA512}  /tmp/seatunnel.tar.gz" | sha512sum -c -; \
    tar -xzf /tmp/seatunnel.tar.gz --strip-components=1; \
    rm -f /tmp/seatunnel.tar.gz; \
    test -x bin/seatunnel-cluster.sh; \
    test -s connectors/plugin-mapping.properties

COPY plugin_config /opt/seatunnel/config/plugin_config

RUN set -eu; \
    connector_jdbc="connector-jdbc-${CONNECTOR_JDBC_VERSION}.jar"; \
    connector_doris="connector-doris-${CONNECTOR_DORIS_VERSION}.jar"; \
    connector_file_s3="connector-file-s3-${CONNECTOR_FILE_S3_VERSION}.jar"; \
    for artifact in "${connector_jdbc}" "${connector_doris}" "${connector_file_s3}"; do \
      case "${artifact}" in \
        "${connector_jdbc}") sha="${CONNECTOR_JDBC_SHA256}"; url="${CONNECTOR_MAVEN_BASE}/org/apache/seatunnel/connector-jdbc/${CONNECTOR_JDBC_VERSION}/${artifact}" ;; \
        "${connector_doris}") sha="${CONNECTOR_DORIS_SHA256}"; url="${CONNECTOR_MAVEN_BASE}/org/apache/seatunnel/connector-doris/${CONNECTOR_DORIS_VERSION}/${artifact}" ;; \
        *) sha="${CONNECTOR_FILE_S3_SHA256}"; url="${CONNECTOR_MAVEN_BASE}/org/apache/seatunnel/connector-file-s3/${CONNECTOR_FILE_S3_VERSION}/${artifact}" ;; \
      esac; \
      test -n "${sha}" || { echo "missing SHA-256 for ${artifact}" >&2; exit 64; }; \
      if [ -s "/tmp/seatunnel-assets/${artifact}" ]; then \
        cp "/tmp/seatunnel-assets/${artifact}" "/opt/seatunnel/connectors/${artifact}"; \
      else \
        [ "${OFFLINE_BUILD}" != "true" ] || { echo "offline build missing ${artifact}" >&2; exit 64; }; \
        curl -fL --retry 3 --retry-delay 2 "${url}" -o "/tmp/seatunnel-assets/${artifact}"; \
        cp "/tmp/seatunnel-assets/${artifact}" "/opt/seatunnel/connectors/${artifact}"; \
      fi; \
      echo "${sha}  /opt/seatunnel/connectors/${artifact}" | sha256sum -c -; \
    done; \
    rm -rf /tmp/seatunnel-assets

COPY seatunnel.yaml /opt/seatunnel/config/seatunnel.yaml
COPY vendor-drivers/ /opt/seatunnel/lib/

RUN set -eu; \
    find /opt/seatunnel/lib -maxdepth 1 -type f -name '*.jar' -exec chmod 0644 {} \;; \
    test -s /opt/seatunnel/connectors/connector-jdbc-${CONNECTOR_JDBC_VERSION}.jar; \
    test -s /opt/seatunnel/connectors/connector-doris-${CONNECTOR_DORIS_VERSION}.jar; \
    test -s /opt/seatunnel/connectors/connector-file-s3-${CONNECTOR_FILE_S3_VERSION}.jar; \
    mkdir -p /opt/seatunnel/logs /opt/seatunnel/checkpoints /opt/seatunnel/work; \
    chown -R seatunnel:seatunnel /opt/seatunnel

USER 10001:10001
EXPOSE 8080 5801
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=12 \
  CMD curl -fsS http://127.0.0.1:8080/overview >/dev/null || exit 1
CMD ["./bin/seatunnel-cluster.sh"]
