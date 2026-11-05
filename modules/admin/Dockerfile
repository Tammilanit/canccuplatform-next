# Build context: the repo root (deploy/compose.yml sets it), so the kit is installed by file path.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /repo
COPY packages/kit-py/ packages/kit-py/
COPY contracts/profile.schema.json contracts/profile.schema.json
COPY modules/admin/ modules/admin/
# pip resolves the relative kit path against the wrong directory in a build; make it absolute.
RUN sed -i 's#file:../../packages/kit-py#file:///repo/packages/kit-py#' modules/admin/pyproject.toml \
 && pip install ./modules/admin
WORKDIR /repo/modules/admin
ENV CANCCU_CONTRACTS_DIR=/repo/contracts CANCCU_DECLARATIONS_DIR=/repo/modules/admin/declarations
USER nobody
EXPOSE 8080
CMD ["python", "-m", "canccu_admin.main"]
