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


def pdf_pages(count: int, font: str = "FancyUnembedded") -> bytes:
    """A real PDF of `count` 16:9 pages whose text uses a font it does not embed."""
    content = b"BT /F1 48 Tf 72 270 Td (Slide) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids ["
        + b" ".join(f"{5 + i} 0 R".encode() for i in range(count))
        + f"] /Count {count} >>".encode(),
        f"<< /Type /Font /Subtype /TrueType /BaseFont /{font} >>".encode(),
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
    ]
    objects += [
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] "
        b"/Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"
    ] * count
    out = b"%PDF-1.4\n"
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return out


FODP = """<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.presentation">
<office:font-face-decls><style:font-face style:name="Odd" svg:font-family="{font}"/>
</office:font-face-decls>
<office:styles/>
<office:automatic-styles>
<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm"
 fo:page-height="15.75cm" style:print-orientation="landscape"/></style:page-layout>
<style:style style:name="T1" style:family="text"><style:text-properties style:font-name="Odd"/>
</style:style>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/>
</office:master-styles>
<office:body><office:presentation>{pages}</office:presentation></office:body></office:document>
"""
FODP_PAGE = """<draw:page draw:name="p{n}" draw:master-page-name="Default"><draw:frame svg:x="2cm"
 svg:y="2cm" svg:width="20cm" svg:height="5cm"><draw:text-box><text:p><text:span
 text:style-name="T1">Slide {n}</text:span></text:p></draw:text-box></draw:frame></draw:page>"""


def fodp(slides: int, font: str) -> str:
    """A LibreOffice flat presentation, which LibreOffice turns into real PPTX and PDF decks."""
    pages = "".join(FODP_PAGE.format(n=n) for n in range(1, slides + 1))
    return FODP.format(font=font, pages=pages)
