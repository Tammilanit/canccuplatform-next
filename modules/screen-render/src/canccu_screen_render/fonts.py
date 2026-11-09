"""`font_missing` warnings: a font a deck uses that the render image lacks (contract, D10).

A warning names the substitute fontconfig picks even when it is metric-compatible (Carlito for
Calibri), so the organiser knows why a line may break differently. Warnings never fail a job.
"""

import re
from collections.abc import Callable

Warning = dict[str, object]
# A deck naming hundreds of fonts gets the first 50 warnings: enough to act on, cheap to check.
MAX_WARNINGS = 50
Matcher = Callable[[str], str]


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
    warnings: list[Warning] = []
    for font in sorted(fonts):
        if len(warnings) == MAX_WARNINGS:
            break
        substitute = match(font)
        if not _same(substitute, font):
            slides = sorted(fonts[font]) or list(range(1, slide_count + 1))
            warnings.append(_warning(font, substitute, slides))
    return warnings


def parse_pdffonts(output: str) -> list[tuple[str, bool]]:
    """(name, embedded) per font from `pdffonts`.

    Read from the right: the last five fields are `emb sub uni` and the object id, and a long
    name pushes the fixed columns out of place. PostScript names have no spaces.
    """
    lines = output.splitlines()
    dash = next((i for i, line in enumerate(lines) if line.startswith("---")), None)
    if dash is None:
        return []
    fonts = []
    for line in lines[dash + 1 :]:
        fields = line.split()
        if len(fields) >= 7:
            fonts.append((fields[0], fields[-5] == "yes"))
    return fonts


def base_family(postscript_name: str) -> str:
    """`ABCDEF+TimesNewRomanPS-BoldMT` → `Times New Roman`, the family name fontconfig knows.

    Without the spaces fontconfig finds no alias and names another substitute than poppler uses.
    """
    name = postscript_name.split("+", 1)[-1]
    name = re.split(r"[-,]", name, maxsplit=1)[0]
    name = re.sub(r"(PSMT|PS|MT)$", "", name)
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)


def pdf_warnings(pages: dict[int, list[tuple[str, bool]]], match: Matcher) -> list[Warning]:
    missing: dict[str, set[int]] = {}
    for page, fonts in pages.items():
        for name, embedded in fonts:
            if not embedded and not name.startswith("["):
                missing.setdefault(base_family(name), set()).add(page)
    warnings: list[Warning] = []
    for font in sorted(missing):
        if len(warnings) == MAX_WARNINGS:
            break
        substitute = match(font)
        if not _same(substitute, font):
            warnings.append(_warning(font, substitute, sorted(missing[font])))
    return warnings
