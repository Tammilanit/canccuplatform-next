# Build context: the repo root (deploy/compose.yml sets it), so the kit is installed by file path.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /repo
COPY packages/kit-py/ packages/kit-py/
COPY modules/notify/ modules/notify/
# pip resolves the relative kit path against the wrong directory in a build; make it absolute.
RUN sed -i 's#file:../../packages/kit-py#file:///repo/packages/kit-py#' modules/notify/pyproject.toml \
 && pip install ./modules/notify
WORKDIR /repo/modules/notify
ENV CANCCU_MIGRATIONS_DIR=/repo/modules/notify/migrations
USER nobody
EXPOSE 8080
CMD ["python", "-m", "canccu_notify.main"]
