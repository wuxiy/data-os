FROM eclipse-temurin:21-jre-alpine

# The control plane never needs to run as root.  wget is kept in the image only
# for the Docker health check; no shell is used by the application entrypoint.
RUN apk add --no-cache wget \
    && addgroup -S dataos \
    && adduser -S -G dataos -h /app dataos

WORKDIR /app
COPY --chown=dataos:dataos target/data-os-control-plane-0.1.0-SNAPSHOT.jar app.jar

USER dataos
EXPOSE 8080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-Djava.security.egd=file:/dev/./urandom", "-jar", "/app/app.jar"]
