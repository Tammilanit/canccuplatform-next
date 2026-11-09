import pytest

from canccu_screen_render.inspect import Limits, RenderError, inspect_pptx, sniff
from decks import (
    EXTERNAL_IMAGE_REL,
    HYPERLINK_REL,
    add_slide_rel,
    jpeg_header,
    minimal_pptx,
    png_header,
    with_entries,
)


def code_of(fn, *args, **kwargs) -> tuple[str, str]:
    with pytest.raises(RenderError) as e:
        fn(*args, **kwargs)
    return e.value.code, e.value.message


def test_sniff_by_content_not_name():
    assert sniff(minimal_pptx([[]])) == "pptx"
    assert sniff(b"%PDF-1.7\n...") == "pdf"
    assert code_of(sniff, b"not a deck")[0] == "file_invalid"
    assert code_of(sniff, b"PK\x03\x04broken zip")[0] == "file_invalid"


def test_counts_slides_and_names_fonts_per_slide():
    info = inspect_pptx(minimal_pptx([["Arial"], ["Arial", "Fancy Font"], []]))
    assert info.slide_count == 3
    assert info.fonts["Arial"] == {1, 2}
    assert info.fonts["Fancy Font"] == {2}


def test_theme_fonts_count_for_every_slide():
    info = inspect_pptx(minimal_pptx([["+mj-lt"], []]))
    assert info.fonts["Major Sans"] == {1}
    # Body text without a typeface falls back to the theme's minor font on any slide.
    assert info.fonts["Minor Serif"] == set()


def test_refuses_an_external_image():
    code, message = code_of(inspect_pptx, add_slide_rel(minimal_pptx([[]]), EXTERNAL_IMAGE_REL))
    assert code == "file_invalid"
    assert "outside the file" in message and "image" in message


def test_keeps_an_external_hyperlink():
    info = inspect_pptx(add_slide_rel(minimal_pptx([[]]), HYPERLINK_REL))
    assert info.slide_count == 1


def test_refuses_macros():
    deck = minimal_pptx([[]], {"ppt/vbaProject.bin": b"\x00" * 10})
    code, message = code_of(inspect_pptx, deck)
    assert code == "file_invalid" and "macros" in message


def test_refuses_a_doctype():
    bomb = b'<!DOCTYPE x [<!ENTITY a "a">]><x/>'
    deck = with_entries(minimal_pptx([[]]), {"ppt/slides/slide1.xml": bomb})
    assert code_of(inspect_pptx, deck)[0] == "file_invalid"


def test_refuses_huge_images():
    for header in (png_header(30000, 30000), jpeg_header(20000, 20000)):
        deck = minimal_pptx([[]], {"ppt/media/image1.bin": header})
        code, message = code_of(inspect_pptx, deck)
        assert code == "file_invalid" and "image" in message


def test_a_normal_image_passes():
    deck = minimal_pptx([[]], {"ppt/media/image1.png": png_header(1920, 1080)})
    assert inspect_pptx(deck).slide_count == 1


def test_too_many_slides():
    code, message = code_of(inspect_pptx, minimal_pptx([[]] * 4), Limits(max_slides=3))
    assert code == "too_many_slides" and "4 slides" in message and "3" in message


def test_zip_bomb():
    deck = minimal_pptx([[]], {"ppt/media/zeros.bin": b"\x00" * (4 * 1024 * 1024)})
    assert code_of(inspect_pptx, deck, Limits(max_ratio=50))[0] == "file_invalid"
    assert code_of(inspect_pptx, deck, Limits(max_uncompressed=1024 * 1024))[0] == "file_invalid"


def test_not_a_presentation():
    import io
    import zipfile

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("word/document.xml", "<w/>")
    assert code_of(inspect_pptx, out.getvalue())[0] == "file_invalid"


def test_complex_script_theme_references_are_not_fonts():
    info = inspect_pptx(minimal_pptx([["+mn-cs", "+mj-cs", "+mn-ea", "Arial"]]))
    assert not [f for f in info.fonts if f.startswith("+")]
    assert info.fonts["Arial"] == {1}


def test_slides_are_numbered_in_show_order_without_hidden_ones():
    deck = minimal_pptx([["One"], ["Two"], ["Hidden"]], order=[2, 3, 1], hidden=(3,))
    info = inspect_pptx(deck)
    assert info.slide_count == 2
    assert info.fonts["Two"] == {1} and info.fonts["One"] == {2}
    assert "Hidden" not in info.fonts


def test_refuses_a_doctype_in_utf16():
    bomb = '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE x [<!ENTITY a "a">]><x>&a;</x>'
    deck = with_entries(minimal_pptx([[]]), {"ppt/slides/slide1.xml": bomb.encode("utf-16")})
    assert code_of(inspect_pptx, deck)[0] == "file_invalid"


def test_refuses_a_doctype_after_a_long_comment():
    bomb = "<!--" + "x" * 5000 + '--><!DOCTYPE x [<!ENTITY a "a">]><x>&a;</x>'
    deck = with_entries(minimal_pptx([[]]), {"ppt/slides/slide1.xml": bomb.encode()})
    assert code_of(inspect_pptx, deck)[0] == "file_invalid"


def test_refuses_huge_images_of_every_common_kind():
    from decks import bmp_header, gif_header, webp_header

    for header in (
        jpeg_header(20000, 20000, exif=200_000),
        gif_header(65000, 65000),
        bmp_header(30000, 30000),
        webp_header(16000, 16000),
    ):
        deck = minimal_pptx([[]], {"ppt/media/image1.bin": header})
        code, message = code_of(inspect_pptx, deck)
        assert code == "file_invalid" and "pixels" in message, header[:4]


def test_normal_images_of_every_kind_pass():
    from decks import bmp_header, gif_header, webp_header

    for header in (jpeg_header(1920, 1080, exif=100_000), gif_header(640, 480),
                   bmp_header(800, 600), webp_header(1920, 1080)):  # fmt: skip
        assert inspect_pptx(minimal_pptx([[]], {"ppt/media/i.bin": header})).slide_count == 1
