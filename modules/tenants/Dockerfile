# Build context: the repo root (deploy/compose.yml sets it), so the kit is installed by file path.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /repo
COPY packages/kit-py/ packages/kit-py/
# The whole contracts folder: flags.yaml may not exist yet, and COPY of a missing file fails.
COPY contracts/ contracts/
COPY events/demo/profile.yaml events/demo/profile.yaml
COPY modules/tenants/ modules/tenants/
# pip resolves the relative kit path against the wrong directory in a build; make it absolute.
RUN sed -i 's#file:../../packages/kit-py#file:///repo/packages/kit-py#' modules/tenants/pyproject.toml \
 && pip install ./modules/tenants
WORKDIR /repo/modules/tenants
ENV CANCCU_MIGRATIONS_DIR=/repo/modules/tenants/migrations \
    CANCCU_FLAGS_FILE=/repo/contracts/flags.yaml \
    CANCCU_DEMO_PROFILE=/repo/events/demo/profile.yaml
USER nobody
EXPOSE 8080
CMD ["python", "-m", "canccu_tenants.main"]
