# Build context: the repo root (deploy/compose.yml sets it), so the kit is installed by file path.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /repo
COPY packages/kit-py/ packages/kit-py/
COPY contracts/profile.schema.json contracts/profile.schema.json
COPY modules/admin/ modules/admin/
RUN pip install ./modules/admin
WORKDIR /repo/modules/admin
ENV CP_CONTRACTS_DIR=/repo/contracts CP_DECLARATIONS_DIR=/repo/modules/admin/declarations
USER nobody
EXPOSE 8080
CMD ["python", "-m", "cp_admin.main"]
