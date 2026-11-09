"""Checks a deck before any renderer touches it, and reads what the render needs from it.

Everything here reads untrusted bytes: sizes are checked before reading, any XML part with a
DOCTYPE or an entity declaration is refused in whatever encoding or position it hides (OOXML
never has one, and entities are how XML bombs work), and nothing is extracted to disk.
"""

import io
import posixpath
import re
import struct
import zipfile
from dataclasses import dataclass, field
from typing import IO, Literal
from xml.etree import ElementTree
from xml.parsers import expat

Kind = Literal["pptx", "pdf"]

A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P_NS = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
R_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
SLIDE_RE = re.compile(r"^ppt/slides/slide(\d+)\.xml$")
MAX_SLIDE_W, MAX_SLIDE_H = 3840, 2160  # the product owner's slide size (#184, question 4)
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
    # Visible slides; LibreOffice leaves hidden ones out of the render, so they are not counted.
    slide_count: int
    # Font name → the visible slides it is named on; an empty set means the theme, so any slide.
    fonts: dict[str, set[int]] = field(default_factory=dict)


def invalid(message: str) -> RenderError:
    return RenderError("file_invalid", message)


def too_many_slides(count: int, limits: Limits) -> RenderError:
    return RenderError(
        "too_many_slides",
        f"The deck has {count} slides; the limit is {limits.max_slides}. "
        "Split it into smaller decks and upload them one by one.",
    )


def too_large_image(width: int, height: int) -> RenderError:
    return invalid(
        f"An image in the deck is {width} by {height} pixels, too large to draw. Scale it down "
        f"(a slide needs at most {MAX_SLIDE_W} by {MAX_SLIDE_H}) and upload again."
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

    slides = _visible_slides(deck, names)
    if len(slides) > limits.max_slides:
        raise too_many_slides(len(slides), limits)

    for info in infos:
        name = info.filename
        if name.endswith(".rels"):
            _check_rels(_xml(deck, name))
        elif name.startswith("ppt/media/"):
            with deck.open(info) as f:
                size = image_size(f)
            if size and size[0] * size[1] > limits.max_image_pixels:
                raise too_large_image(*size)

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


def _refuse(*_: object) -> None:
    raise invalid("The deck contains a part that is not valid PowerPoint XML.")


def _xml(deck: zipfile.ZipFile, name: str) -> ElementTree.Element:
    raw = deck.read(name)
    # A first pass with expat's own handlers sees every DOCTYPE and entity declaration, whatever
    # the encoding (UTF-16 included) and however late in the part it comes.
    guard = expat.ParserCreate()
    guard.StartDoctypeDeclHandler = _refuse
    guard.EntityDeclHandler = _refuse
    try:
        guard.Parse(raw, True)
        return ElementTree.fromstring(raw)
    except (expat.ExpatError, ElementTree.ParseError) as e:
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


def _visible_slides(deck: zipfile.ZipFile, names: set[str]) -> list[str]:
    """The slide parts in show order (`p:sldIdLst`) without hidden ones, as LibreOffice draws them.

    Part names do not give the order: tools need not renumber them when slides move.
    """
    order: list[str] = []
    if "ppt/_rels/presentation.xml.rels" in names:
        targets = {
            rel.get("Id"): rel.get("Target", "")
            for rel in _xml(deck, "ppt/_rels/presentation.xml.rels").iter()
            if rel.tag.endswith("Relationship")
        }
        for sld in _xml(deck, "ppt/presentation.xml").iter(P_NS + "sldId"):
            target = targets.get(sld.get(R_ID), "")
            part = (
                target.lstrip("/")
                if target.startswith("/")
                else posixpath.normpath(posixpath.join("ppt", target))
            )
            if part in names and SLIDE_RE.match(part):
                order.append(part)
    if not order:
        order = sorted(
            (n for n in names if SLIDE_RE.match(n)),
            key=lambda n: int(SLIDE_RE.match(n).group(1)),  # type: ignore[union-attr]
        )
    return [part for part in order if _xml(deck, part).get("show") != "0"]


def image_size(f: IO[bytes]) -> tuple[int, int] | None:
    """Width and height from an image's header, read as a stream; None for kinds not measured."""
    head = f.read(32)
    if head.startswith(b"\x89PNG\r\n\x1a\n") and len(head) >= 24:
        width, height = struct.unpack(">II", head[16:24])
        return width, height
    if head[:6] in (b"GIF87a", b"GIF89a"):
        width, height = struct.unpack("<HH", head[6:10])
        return width, height
    if head.startswith(b"BM") and len(head) >= 26:
        width, height = struct.unpack("<ii", head[18:26])
        return abs(width), abs(height)
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP" and len(head) >= 30:
        chunk = head[12:16]
        if chunk == b"VP8X":
            return 1 + int.from_bytes(head[24:27], "little"), 1 + int.from_bytes(
                head[27:30], "little"
            )
        if chunk == b"VP8L":
            bits = int.from_bytes(head[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if chunk == b"VP8 ":
            width, height = struct.unpack("<HH", head[26:30])
            return width & 0x3FFF, height & 0x3FFF
    if head.startswith(b"\xff\xd8"):
        return _jpeg_size(head[2:], f)
    return None


def _jpeg_size(buffered: bytes, f: IO[bytes]) -> tuple[int, int] | None:
    """Walk the JPEG's segments by their lengths, however much EXIF or ICC data comes first."""
    data = bytearray(buffered)

    def take(n: int) -> bytes | None:
        while len(data) < n:
            more = f.read(max(n - len(data), 65536))
            if not more:
                return None
            data.extend(more)
        out = bytes(data[:n])
        del data[:n]
        return out

    for _ in range(10_000):
        marker = take(2)
        if marker is None or marker[0] != 0xFF:
            return None
        if marker[1] in (0x01, 0xFF) or 0xD0 <= marker[1] <= 0xD7:
            continue
        length = take(2)
        if length is None:
            return None
        size = struct.unpack(">H", length)[0] - 2
        if 0xC0 <= marker[1] <= 0xCF and marker[1] not in (0xC4, 0xC8, 0xCC):
            sof = take(5)
            if sof is None:
                return None
            height, width = struct.unpack(">HH", sof[1:5])
            return width, height
        if size < 0 or take(size) is None:
            return None
    return None


def _fonts(deck: zipfile.ZipFile, names: set[str], slides: list[str]) -> dict[str, set[int]]:
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
    # Only the Latin theme fonts are named in the theme here; `+mj-cs`, `+mn-ea` and the like
    # stand for script fonts the theme usually leaves empty, so they name no font.
    theme_names = {"+mj-lt": major, "+mn-lt": minor}

    fonts: dict[str, set[int]] = {}
    if minor:
        fonts[minor] = set()
    for n, part in enumerate(slides, start=1):
        for face in _typefaces(_xml(deck, part)):
            resolved = theme_names.get(face) if face.startswith("+") else face
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
