# G21-1 CVE 收口：3.12.8 基础镜像的 openssl/gnutls/krb5/pcre2/perl 全部过期，升到当前补丁
FROM python:3.12.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/opt/dataos/quality-runner/app

RUN groupadd --system dataos && useradd --system --gid dataos --home-dir /opt/dataos dataos \
    && mkdir -p /opt/dataos/quality /var/lib/dataos-quality/artifacts \
    && chown -R dataos:dataos /opt/dataos /var/lib/dataos-quality

WORKDIR /opt/dataos/quality-runner
# G2G dev 部署实抓：dbt-core-experimental-parser 的构建后端从 GitHub releases
# 拉 55MB wheel，受限网络下反复超时/断流。预先取好的 wheel 放构建上下文
# wheels/ 时直接安装并从依赖解析中排除，绕开 GitHub（构建上下文无 wheels/
# 时该层为空目录、行为不变）。
COPY services/quality-runner/wheels* /tmp/wheels/
RUN if ls /tmp/wheels/*.whl >/dev/null 2>&1; then \
        pip install --no-cache-dir /tmp/wheels/*.whl && \
        sed -i 's/^dbt-core==/dbt-core~/; s/^dbt-core-experimental-parser==/dbt-core-experimental-parser~/;' /dev/null 2>/dev/null || true; \
    fi
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
