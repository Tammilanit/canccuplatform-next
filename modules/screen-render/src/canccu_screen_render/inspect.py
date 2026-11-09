"""Checks a deck before any renderer touches it, and reads what the render needs from it.

Everything here reads untrusted bytes: sizes are checked before reading, XML with a DOCTYPE is
refused (OOXML never has one, and entities are how XML bombs work), and nothing is extracted
to disk.
"""

import io
import re
import struct
import zipfile
from dataclasses import dataclass, field
from typing import Literal
from xml.etree import ElementTree

Kind = Literal["pptx", "pdf"]

A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
SLIDE_RE = re.compile(r"^ppt/slides/slide(\d+)\.xml$")
# Relationship types that make a renderer load something: refused when external (plan R5).
# Hyperlinks are not here: a screen never follows one, and ordinary decks carry them.
LOADING_RELS = {
    "image": "an image",
    "oleObject": "an OLE object",
    "package": "an embedded document",
    "attachedTemplate": "a template",
    "video": "a video",
    "audio": "a sound",
    "media": "a media file",
    "frame": "a frame",
    "subDocument": "a sub-document",
    "externalLinkPath": "a linked file",
}


class RenderError(Exception):
    """A failed render with a contract error code and a message an organiser can act on."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Limits:
    max_deck_bytes: int = 100 * 1024 * 1024  # the contract's upload cap
    max_slides: int = 300
    max_entries: int = 10_000
    max_uncompressed: int = 1024 * 1024 * 1024
    # Real media compresses a little; a high ratio on a big entry is a zip bomb.
    max_ratio: int = 100
    max_image_pixels: int = 60_000_000  # about 10,000 by 6,000


@dataclass
class DeckInfo:
    slide_count: int
    # Font name → the slides it is named on; an empty set means the theme, so any slide.
    fonts: dict[str, set[int]] = field(default_factory=dict)


def invalid(message: str) -> RenderError:
    return RenderError("file_invalid", message)


def too_many_slides(count: int, limits: Limits) -> RenderError:
    return RenderError(
        "too_many_slides",
        f"The deck has {count} slides; the limit is {limits.max_slides}. "
        "Split it into smaller decks and upload them one by one.",
    )


def sniff(data: bytes) -> Kind:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"PK\x03\x04"):
        try:
            names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        except (zipfile.BadZipFile, ValueError) as e:
            raise invalid("The file is damaged: it is not a readable PowerPoint file.") from e
        if "ppt/presentation.xml" in names:
            return "pptx"
    raise invalid("The file is not a PowerPoint (.pptx) or PDF deck.")


def inspect_pptx(data: bytes, limits: Limits | None = None) -> DeckInfo:
    limits = limits or Limits()
    try:
        deck = zipfile.ZipFile(io.BytesIO(data))
        infos = deck.infolist()
    except (zipfile.BadZipFile, ValueError) as e:
        raise invalid("The file is damaged: it is not a readable PowerPoint file.") from e
    names = {i.filename for i in infos}
    if "ppt/presentation.xml" not in names:
        raise invalid("The file is not a PowerPoint (.pptx) deck.")
    _check_sizes(infos, limits)
    if any(n.lower().endswith("vbaproject.bin") for n in names):
        raise invalid(
            "The deck contains macros. Save it as a .pptx without macros and upload again."
        )

    slides = sorted(int(m.group(1)) for n in names if (m := SLIDE_RE.match(n)))
    if len(slides) > limits.max_slides:
        raise too_many_slides(len(slides), limits)

    for info in infos:
        name = info.filename
        if name.endswith(".rels"):
            _check_rels(_xml(deck, name))
        elif name.startswith("ppt/media/"):
            _check_image(deck.open(info).read(64 * 1024), limits)

    return DeckInfo(slide_count=len(slides), fonts=_fonts(deck, names, slides))


def _check_sizes(infos: list[zipfile.ZipInfo], limits: Limits) -> None:
    if len(infos) > limits.max_entries:
        raise invalid("The deck has too many parts to be a normal presentation.")
    total = sum(i.file_size for i in infos)
    if total > limits.max_uncompressed:
        raise invalid("The deck unpacks to more than 1 GiB. Compress its pictures and try again.")
    for i in infos:
        if i.file_size > 1024 * 1024 and i.file_size > limits.max_ratio * max(i.compress_size, 1):
            raise invalid("The deck contains a part that unpacks to far more than its size.")


def _xml(deck: zipfile.ZipFile, name: str) -> ElementTree.Element:
    raw = deck.read(name)
    if b"<!DOCTYPE" in raw[:4096].upper() or b"<!ENTITY" in raw.upper():
        raise invalid("The deck contains a part that is not valid PowerPoint XML.")
    try:
        return ElementTree.fromstring(raw)
    except ElementTree.ParseError as e:
        raise invalid("The deck is damaged: a part of it cannot be read.") from e


def _check_rels(root: ElementTree.Element) -> None:
    for rel in root.iter():
        if not rel.tag.endswith("Relationship") or rel.get("TargetMode") != "External":
            continue
        kind = (rel.get("Type") or "").rsplit("/", 1)[-1]
        if kind in LOADING_RELS:
            raise invalid(
                f"The deck links to {LOADING_RELS[kind]} outside the file "
                f"({rel.get('Target', '')[:80]}). Embed it in the deck and upload again."
            )


def _image_size(head: bytes) -> tuple[int, int] | None:
    if head.startswith(b"\x89PNG\r\n\x1a\n") and len(head) >= 24:
        width, height = struct.unpack(">II", head[16:24])
        return width, height
    if head.startswith(b"\xff\xd8"):
        i = 2
        while i + 9 < len(head):
            if head[i] != 0xFF:
                return None
            marker = head[i + 1]
            length = struct.unpack(">H", head[i + 2 : i + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack(">HH", head[i + 5 : i + 9])
                return width, height
            i += 2 + length
    return None


def _check_image(head: bytes, limits: Limits) -> None:
    size = _image_size(head)
    if size and size[0] * size[1] > limits.max_image_pixels:
        raise invalid(
            f"An image in the deck is {size[0]} by {size[1]} pixels, too large to draw. "
            "Scale it down (a slide needs at most 2560 by 1440) and upload again."
        )


def _fonts(deck: zipfile.ZipFile, names: set[str], slides: list[int]) -> dict[str, set[int]]:
    major = minor = None
    themes = sorted(n for n in names if n.startswith("ppt/theme/") and n.endswith(".xml"))
    if themes:
        theme = _xml(deck, themes[0])
        for font in theme.iter():
            if font.tag in (A_NS + "majorFont", A_NS + "minorFont"):
                latin = font.find(A_NS + "latin")
                face = latin.get("typeface") if latin is not None else None
                if font.tag == A_NS + "majorFont":
                    major = face
                else:
                    minor = face
    theme_names = {"+mj-lt": major, "+mn-lt": minor, "+mj-ea": None, "+mn-ea": None}

    fonts: dict[str, set[int]] = {}
    if minor:
        fonts[minor] = set()
    for n in slides:
        for face in _typefaces(_xml(deck, f"ppt/slides/slide{n}.xml")):
            resolved = theme_names.get(face, face) if face.startswith("+") else face
            if resolved:
                fonts.setdefault(resolved, set()).add(n)
    for name in sorted(names):
        if name.startswith(("ppt/slideLayouts/", "ppt/slideMasters/")) and name.endswith(".xml"):
            for face in _typefaces(_xml(deck, name)):
                if not face.startswith("+"):
                    fonts.setdefault(face, set())
    return fonts


def _typefaces(root: ElementTree.Element) -> set[str]:
    tags = {A_NS + t for t in ("latin", "ea", "cs", "sym")}
    return {face for e in root.iter() if e.tag in tags if (face := e.get("typeface"))}
