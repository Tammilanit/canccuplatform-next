"""Builders for decks in tests: a minimal PPTX by hand, and hostile changes to any PPTX."""

import io
import struct
import zipfile
import zlib

EXTERNAL_IMAGE_REL = (
    '<Relationship Id="rIdX" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
    'relationships/image" Target="http://example.invalid/a.png" TargetMode="External"/>'
)
HYPERLINK_REL = (
    '<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
    'relationships/hyperlink" Target="https://example.invalid/" TargetMode="External"/>'
)


def slide_xml(fonts: list[str]) -> str:
    run = '<a:r><a:rPr><a:latin typeface="{}"/></a:rPr><a:t>x</a:t></a:r>'
    runs = "".join(run.format(f) for f in fonts)
    return (
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        f"<p:cSld><p:spTree><p:sp><p:txBody><a:p>{runs}</a:p></p:txBody></p:sp></p:spTree></p:cSld>"
        "</p:sld>"
    )


THEME = (
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>'
    '<a:fontScheme name="t"><a:majorFont><a:latin typeface="Major Sans"/></a:majorFont>'
    '<a:minorFont><a:latin typeface="Minor Serif"/></a:minorFont></a:fontScheme>'
    "</a:themeElements></a:theme>"
)


def minimal_pptx(slides: list[list[str]], extra: dict[str, bytes] | None = None) -> bytes:
    """A zip shaped like a PPTX: enough for the checks, not for LibreOffice."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("ppt/presentation.xml", "<p:presentation/>")
        z.writestr("ppt/theme/theme1.xml", THEME)
        for n, fonts in enumerate(slides, start=1):
            z.writestr(f"ppt/slides/slide{n}.xml", slide_xml(fonts))
            z.writestr(f"ppt/slides/_rels/slide{n}.xml.rels", "<Relationships/>")
        for name, data in (extra or {}).items():
            z.writestr(name, data)
    return out.getvalue()


def with_entries(pptx: bytes, changes: dict[str, bytes]) -> bytes:
    """Copy a PPTX, replacing or adding the given entries."""
    src = zipfile.ZipFile(io.BytesIO(pptx))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for info in src.infolist():
            if info.filename not in changes:
                z.writestr(info, src.read(info))
        for name, data in changes.items():
            z.writestr(name, data)
    return out.getvalue()


def add_slide_rel(pptx: bytes, rel: str) -> bytes:
    src = zipfile.ZipFile(io.BytesIO(pptx))
    name = next(n for n in src.namelist() if n.startswith("ppt/slides/_rels/"))
    rels = src.read(name).decode()
    rels = rels.replace("</Relationships>", rel + "</Relationships>")
    if rel not in rels:  # an empty <Relationships/> element
        rels = rels.replace("<Relationships/>", f"<Relationships>{rel}</Relationships>").replace(
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f"{rel}</Relationships>",
        )
    return with_entries(pptx, {name: rels.encode()})


def png_header(width: int, height: int) -> bytes:
    """A PNG whose header claims the given size: a decompression bomb needs no real pixels."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    chunk = b"IHDR" + ihdr
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", len(ihdr))
        + chunk
        + struct.pack(">I", zlib.crc32(chunk))
    )


def jpeg_header(width: int, height: int) -> bytes:
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, height, width, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x00" * 9 + sof
