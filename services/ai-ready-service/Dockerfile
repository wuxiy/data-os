FROM python:3.12.8-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/opt/dataos/ai-ready-service/app \
    AI_READY_REPO_DIR=/opt/dataos/ai-ready

RUN groupadd --system dataos && useradd --system --gid dataos --home-dir /opt/dataos dataos \
    && mkdir -p /opt/dataos/ai-ready /opt/dataos/ai-ready-service \
    && chown -R dataos:dataos /opt/dataos

WORKDIR /opt/dataos/ai-ready-service
COPY services/ai-ready-service/pyproject.toml ./
COPY services/ai-ready-service/app ./app
RUN pip install --no-cache-dir .
COPY ai-ready /opt/dataos/ai-ready
RUN chown -R dataos:dataos /opt/dataos/ai-ready /opt/dataos/ai-ready-service

USER dataos
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=8 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
