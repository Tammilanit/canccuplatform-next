# Build context: the repo root (deploy/compose.yml sets it).
# The render job (contracts/screen.md, "The PPTX render job"): LibreOffice and poppler behind a
# Unix socket. Compose runs it with no network and no volume but the socket's (plan R3).
FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DEBIAN_FRONTEND=noninteractive
# The platform-wide font set (plan R9): metric-compatible stand-ins for the Office fonts
# (Liberation, Carlito, Caladea), Noto for most scripts and emoji, and common open families.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress-nogui poppler-utils fontconfig \
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core \
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-open-sans \
      fonts-roboto-unhinted fonts-lato fonts-montserrat fonts-adobe-sourcesans3 \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
COPY modules/screen-render/profile/ /opt/canccu-render/profile/
# Owned by the job user before Compose mounts the empty socket volume here, so the volume
# takes this owner and the user can create the socket.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin canccu-render \
 && mkdir -p /run/canccu-render && chown canccu-render /run/canccu-render
WORKDIR /app
COPY modules/screen-render/pyproject.toml modules/screen-render/README.md ./
COPY modules/screen-render/src/ src/

# `docker build --target test` runs the module's checks against the real LibreOffice and poppler.
FROM base AS test
COPY modules/screen-render/tests/ tests/
RUN pip install -e ".[dev]"
USER canccu-render
# /app is root-owned: the tools keep their caches in /tmp.
ENV HOME=/tmp RUFF_CACHE_DIR=/tmp/ruff MYPY_CACHE_DIR=/tmp/mypy
CMD ["sh", "-c", "ruff check . && ruff format --check . && mypy && pytest -q -p no:cacheprovider"]

FROM base
RUN pip install . && rm -rf /app
WORKDIR /tmp
USER canccu-render
ENV HOME=/tmp
CMD ["python", "-m", "canccu_screen_render.main"]
