FROM python:3.12.8-alpine
RUN addgroup -S dataos && adduser -S -G dataos dataos
WORKDIR /app
COPY deploy/dev/notification-receiver/server.py ./server.py
USER dataos
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=8 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"
ENTRYPOINT ["python", "/app/server.py"]
