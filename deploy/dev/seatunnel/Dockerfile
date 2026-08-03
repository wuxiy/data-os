FROM eclipse-temurin:21-jre-alpine

ARG SEATUNNEL_VERSION=2.3.13
ARG SEATUNNEL_SHA512=499fc1926a7a6f771b1e4034b6d6a43af028984741ec7745a9f50505a267d7d6b35b164a56be957cb1b0b56afc34e68b917289025244cd86c49d48583cc617e7
ARG SEATUNNEL_DOWNLOAD_BASE=https://downloads.apache.org/seatunnel

RUN apk add --no-cache bash ca-certificates curl \
    && curl -fL --retry 3 --retry-delay 2 \
      "${SEATUNNEL_DOWNLOAD_BASE}/${SEATUNNEL_VERSION}/apache-seatunnel-${SEATUNNEL_VERSION}-bin.tar.gz" \
      -o /tmp/seatunnel.tar.gz \
    && echo "${SEATUNNEL_SHA512}  /tmp/seatunnel.tar.gz" | sha512sum -c - \
    && rm -rf /var/cache/apk/*

WORKDIR /opt/seatunnel
RUN tar -xzf /tmp/seatunnel.tar.gz --strip-components=1 \
    && rm /tmp/seatunnel.tar.gz \
    && chmod +x bin/*.sh

EXPOSE 8080 5801

CMD ["./bin/seatunnel-cluster.sh"]
