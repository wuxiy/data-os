FROM eclipse-temurin:21-jre-alpine

WORKDIR /app
COPY target/data-os-control-plane-0.1.0-SNAPSHOT.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/app.jar"]
