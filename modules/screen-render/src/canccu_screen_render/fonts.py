"""`font_missing` warnings: a font a deck uses that the render image lacks (contract, D10).

A warning names the substitute fontconfig picks even when it is metric-compatible (Carlito for
Calibri), so the organiser knows why a line may break differently. Warnings never fail a job.
"""

import re
import subprocess
from collections.abc import Callable

Warning = dict[str, object]
Matcher = Callable[[str], str]


def fc_match(name: str) -> str:
    """The family fontconfig draws `name` with."""
    out = subprocess.run(
        ["fc-match", "-f", "%{family}", name], capture_output=True, text=True, timeout=10
    )
    return out.stdout.split(",")[0].strip()


def _same(a: str, b: str) -> bool:
    return a.replace(" ", "").casefold() == b.replace(" ", "").casefold()


def _warning(font: str, substitute: str, slides: list[int]) -> Warning:
    return {
        "code": "font_missing",
        "message": (
            f"The font {font} is not available here, so it is drawn with {substitute}. "
            "Text may be wider or narrower than in the deck."
        ),
        "font": font,
        "slides": slides,
    }


def pptx_warnings(fonts: dict[str, set[int]], slide_count: int, match: Matcher) -> list[Warning]:
    warnings = []
    for font in sorted(fonts):
        substitute = match(font)
        if not _same(substitute, font):
            slides = sorted(fonts[font]) or list(range(1, slide_count + 1))
            warnings.append(_warning(font, substitute, slides))
    return warnings


def parse_pdffonts(output: str) -> list[tuple[str, bool]]:
    """(name, embedded) per font from `pdffonts`; the dashes line gives the column widths."""
    lines = output.splitlines()
    dash = next((i for i, line in enumerate(lines) if line.startswith("---")), None)
    if dash is None:
        return []
    widths = [len(col) for col in lines[dash].split(" ")]
    name_end = widths[0]
    emb_start = sum(widths[:3]) + 3
    fonts = []
    for line in lines[dash + 1 :]:
        if line.strip():
            emb = line[emb_start : emb_start + widths[3]].strip()
            fonts.append((line[:name_end].strip(), emb == "yes"))
    return fonts


def base_family(postscript_name: str) -> str:
    """`ABCDEF+TimesNewRomanPS-BoldMT` → `TimesNewRoman`: no subset tag, style or vendor suffix."""
    name = postscript_name.split("+", 1)[-1]
    name = re.split(r"[-,]", name, maxsplit=1)[0]
    return re.sub(r"(PSMT|PS|MT)$", "", name)


def pdf_warnings(pages: dict[int, list[tuple[str, bool]]], match: Matcher) -> list[Warning]:
    missing: dict[str, set[int]] = {}
    for page, fonts in pages.items():
        for name, embedded in fonts:
            if not embedded and not name.startswith("["):
                missing.setdefault(base_family(name), set()).add(page)
    warnings = []
    for font in sorted(missing):
        substitute = match(font)
        if not _same(substitute, font):
            warnings.append(_warning(font, substitute, sorted(missing[font])))
    return warnings
