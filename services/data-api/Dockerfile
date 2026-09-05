FROM python:3.12.8-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/opt/dataos/data-api/app

RUN groupadd --system dataos && useradd --system --gid dataos --home-dir /opt/dataos dataos \
    && mkdir -p /opt/dataos/data-api /var/lib/dataos-data-api/exports \
    && chown -R dataos:dataos /opt/dataos /var/lib/dataos-data-api

WORKDIR /opt/dataos/data-api
COPY services/data-api/pyproject.toml ./
COPY services/data-api/app ./app
RUN pip install --no-cache-dir .

USER dataos
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=8 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
