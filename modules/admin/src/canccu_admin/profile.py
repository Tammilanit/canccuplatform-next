"""Event profile: upgrade, validate, save and load an event folder (contracts/profile.md)."""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import yaml
from canccu_kit import KitError
from jsonschema import Draft202012Validator

CURRENT_VERSION = 1
MAX_ZIP_BYTES = 50 * 1024 * 1024

# Upgraders: n -> n+1. Add one per format change; keys are the version they upgrade FROM.
UPGRADERS: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {}


class ProfileInvalid(KitError):
    status = 400
    code = "profile_invalid"


class ProfileTooNew(KitError):
    status = 400
    code = "profile_too_new"


@dataclass
class LoadedProfile:
    document: dict[str, Any]
    upgraded_from: int | None = None
    warnings: list[str] = field(default_factory=list)


def make_validator(schema_path: Path) -> Draft202012Validator:
    return Draft202012Validator(json.loads(schema_path.read_text()))


def upgrade(document: dict[str, Any]) -> tuple[dict[str, Any], int | None]:
    version = document.get("schema_version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ProfileInvalid("schema_version must be an integer >= 1")
    if version > CURRENT_VERSION:
        raise ProfileTooNew(
            f"profile is version {version}; this platform reads up to {CURRENT_VERSION}"
        )
    start = version
    while version < CURRENT_VERSION:
        document = UPGRADERS[version](dict(document))
        version += 1
        document["schema_version"] = version
    return document, (start if start < CURRENT_VERSION else None)


def asset_paths(document: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for section in ("logos", "sounds"):
        value = document.get(section)
        if isinstance(value, dict):
            paths.extend(str(p) for p in value.values())
    return paths


def validate(document: dict[str, Any], validator: Draft202012Validator) -> None:
    errors = sorted(validator.iter_errors(document), key=lambda e: list(e.absolute_path))
    if errors:
        first = errors[0]
        where = "/".join(str(p) for p in first.absolute_path) or "profile"
        raise ProfileInvalid(f"{where}: {first.message}")


def read_profile_dir(directory: Path, validator: Draft202012Validator) -> LoadedProfile:
    """Read, upgrade and validate `<directory>/profile.yaml`; warn about missing assets."""
    file = directory / "profile.yaml"
    if not file.is_file():
        raise ProfileInvalid(f"no profile.yaml in {directory}")
    try:
        document = yaml.safe_load(file.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ProfileInvalid(f"profile.yaml is not valid YAML: {exc}") from exc
    # Both would otherwise escape as a 500 and take the Event profile page down with them.
    except UnicodeDecodeError as exc:
        raise ProfileInvalid("profile.yaml is not UTF-8 text") from exc
    except OSError as exc:
        raise ProfileInvalid(f"profile.yaml can't be read: {exc.strerror or exc}") from exc
    if not isinstance(document, dict):
        raise ProfileInvalid("profile.yaml must hold a mapping")
    document, upgraded_from = upgrade(document)
    validate(document, validator)
    warnings = [
        f"missing file: {p} (named in the profile)"
        for p in asset_paths(document)
        if not (directory / p).is_file()
    ]
    return LoadedProfile(document, upgraded_from, warnings)


def write_profile_dir(directory: Path, document: dict[str, Any], assets_from: Path | None) -> None:
    """Write profile.yaml and copy the assets it names from `assets_from` (a profile dir)."""
    directory.mkdir(parents=True, exist_ok=True)
    if assets_from is not None and assets_from.resolve() != directory.resolve():
        for rel in asset_paths(document):
            source = assets_from / rel
            if source.is_file():
                target = directory / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
    (directory / "profile.yaml").write_text(
        yaml.safe_dump(document, sort_keys=False, allow_unicode=True)
    )


def pack_zip(directory: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(directory / "profile.yaml", "profile.yaml")
        assets = directory / "assets"
        if assets.is_dir():
            for path in sorted(assets.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(directory).as_posix())
    return buffer.getvalue()


def unpack_zip(data: bytes, target: Path) -> None:
    """Extract a profile zip into `target`, rejecting unsafe names and oversized archives."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ProfileInvalid("not a zip file") from exc
    with archive:
        if sum(i.file_size for i in archive.infolist()) > MAX_ZIP_BYTES:
            raise ProfileInvalid("profile zip is too large")
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = PurePosixPath(info.filename)
            if name.is_absolute() or ".." in name.parts:
                raise ProfileInvalid(f"unsafe path in zip: {info.filename}")
            if str(name) != "profile.yaml" and name.parts[0] != "assets":
                raise ProfileInvalid(f"unexpected file in zip: {info.filename}")
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(info))
