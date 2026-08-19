FROM eclipse-temurin:21-jre-alpine

# MPI 服务以非 root 运行；wget 仅为容器健康检查保留，应用入口不使用 shell。
RUN apk add --no-cache wget \
    && addgroup -S dataos \
    && adduser -S -G dataos -h /app dataos

WORKDIR /app
COPY --chown=dataos:dataos target/data-os-mpi-service-0.1.0-SNAPSHOT.jar app.jar

USER dataos
EXPOSE 8080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-Djava.security.egd=file:/dev/./urandom", "-jar", "/app/app.jar"]
