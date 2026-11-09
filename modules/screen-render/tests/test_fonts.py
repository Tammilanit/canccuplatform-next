from canccu_screen_render.fonts import base_family, parse_pdffonts, pdf_warnings, pptx_warnings

IMAGE = {"liberation sans": "Liberation Sans", "dejavu sans": "DejaVu Sans", "carlito": "Carlito"}
SUBSTITUTES = {"calibri": "Carlito", "arial": "Liberation Sans"}


def match(name: str) -> str:
    key = name.casefold()
    return IMAGE.get(key) or SUBSTITUTES.get(key) or "DejaVu Sans"


def test_no_warning_for_fonts_the_image_has():
    assert pptx_warnings({"Liberation Sans": {1}, "DejaVu Sans": set()}, 2, match) == []


def test_missing_font_names_substitute_and_slides():
    [w] = pptx_warnings({"Calibri": {2, 1}}, 3, match)
    assert w["code"] == "font_missing" and w["font"] == "Calibri" and w["slides"] == [1, 2]
    assert "Carlito" in w["message"] and "Calibri" in w["message"]


def test_theme_font_affects_every_slide():
    [w] = pptx_warnings({"Fancy": set()}, 3, match)
    assert w["slides"] == [1, 2, 3]


PDFFONTS = """\
name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
ABCDEF+DejaVuSans                    CID TrueType      Identity-H       yes yes yes      9  0
ArialMT                              TrueType          WinAnsi          no  no  no       5  0
[none]                               Type 3            Custom           yes no  no       7  0
"""


def test_parse_pdffonts():
    expected = [("ABCDEF+DejaVuSans", True), ("ArialMT", False), ("[none]", True)]
    assert parse_pdffonts(PDFFONTS) == expected


def test_base_family():
    assert base_family("ABCDEF+TimesNewRomanPS-BoldMT") == "Times New Roman"
    assert base_family("ArialMT") == "Arial"
    assert base_family("Calibri,Bold") == "Calibri"


def test_pdf_warns_only_for_fonts_neither_embedded_nor_in_the_image():
    pages = {1: [("ArialMT", False), ("XYZ+Fancy", True)], 2: [("ArialMT", False)], 3: []}
    [w] = pdf_warnings(pages, match)
    assert w["font"] == "Arial" and w["slides"] == [1, 2] and "Liberation Sans" in w["message"]


def test_parse_pdffonts_with_a_long_name():
    long = "ABCDEF+AVeryLongFontNameThatPassesTheColumnWidth-Bold"
    out = PDFFONTS.replace("ABCDEF+DejaVuSans                   ", long)
    assert parse_pdffonts(out)[0] == (long, True)


def test_warnings_are_capped():
    fonts = {f"Odd {n}": {1} for n in range(80)}
    assert len(pptx_warnings(fonts, 1, match)) == 50
