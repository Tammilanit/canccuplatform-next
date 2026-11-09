# Build context: the repo root (deploy/compose.yml sets it), so the kit is installed by file path.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /repo
COPY packages/kit-py/ packages/kit-py/
COPY packages/ui/ui.css packages/ui/ui.css
COPY modules/agenda/ modules/agenda/
# pip resolves the relative kit path against the wrong directory in a build; make it absolute.
RUN sed -i 's#file:../../packages/kit-py#file:///repo/packages/kit-py#' modules/agenda/pyproject.toml \
 && pip install ./modules/agenda
WORKDIR /repo/modules/agenda
ENV CANCCU_MIGRATIONS_DIR=/repo/modules/agenda/migrations CANCCU_UI_CSS=/repo/packages/ui/ui.css
USER nobody
EXPOSE 8080
CMD ["python", "-m", "canccu_agenda.main"]
