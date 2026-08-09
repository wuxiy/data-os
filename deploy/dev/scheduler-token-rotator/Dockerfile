FROM python:3.12.8-alpine
RUN addgroup -S dataos && adduser -S -G dataos dataos
WORKDIR /app
COPY deploy/dev/scheduler-token-rotator/rotator.py ./rotator.py
USER dataos
ENTRYPOINT ["python", "/app/rotator.py"]
