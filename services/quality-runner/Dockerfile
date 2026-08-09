FROM python:3.12.8-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/opt/dataos/quality-runner/app

RUN groupadd --system dataos && useradd --system --gid dataos --home-dir /opt/dataos dataos \
    && mkdir -p /opt/dataos/quality /var/lib/dataos-quality/artifacts \
    && chown -R dataos:dataos /opt/dataos /var/lib/dataos-quality

WORKDIR /opt/dataos/quality-runner
COPY services/quality-runner/pyproject.toml ./
COPY services/quality-runner/app ./app
RUN pip install --no-cache-dir .
COPY services/quality-runner/rules.yml /opt/dataos/quality/rules.yml
COPY quality/dbt /opt/dataos/quality/dbt
RUN chown -R dataos:dataos /opt/dataos/quality

USER dataos
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=8 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/readyz', timeout=3)"

ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
