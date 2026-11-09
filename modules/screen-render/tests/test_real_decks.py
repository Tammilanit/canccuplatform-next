"""Real decks through LibreOffice and poppler: runs in the render image (see the README)."""

import shutil
import struct
import time
from pathlib import Path

import pytest

from canccu_screen_render.convert import render, run
from canccu_screen_render.fonts import fc_match
from canccu_screen_render.inspect import Limits, RenderError
from decks import EXTERNAL_IMAGE_REL, add_slide_rel, fodp, pdf_pages, png_header, with_entries

pytestmark = pytest.mark.skipif(not shutil.which("soffice"), reason="needs the render image")
ODD_FONT = "Nobody Has This Font"


def made_by_libreoffice(tmp: Path, kind: str, slides: int = 2) -> bytes:
    src = tmp / "made.fodp"
    src.write_text(fodp(slides, ODD_FONT))
    profile = (tmp / "maker-profile").as_uri()
    run(
        ["soffice", f"-env:UserInstallation={profile}", "--headless", "--convert-to", kind,
         "--outdir", str(tmp), str(src)],
        time.monotonic() + 120, lambda: False,
    )  # fmt: skip
    return (tmp / f"made.{kind}").read_bytes()


def png_size(path: Path) -> tuple[int, int]:
    head = path.read_bytes()[:24]
    assert head.startswith(b"\x89PNG")
    width, height = struct.unpack(">II", head[16:24])
    return width, height


def job(tmp: Path, deck: bytes, **kwargs):  # type: ignore[no-untyped-def]
    workdir = tmp / "job"
    workdir.mkdir(exist_ok=True)
    return render(deck, workdir, lambda: False, **kwargs)


def refusal(tmp: Path, deck: bytes, **kwargs) -> tuple[str, str]:  # type: ignore[no-untyped-def]
    with pytest.raises(RenderError) as e:
        job(tmp, deck, **kwargs)
    return e.value.code, e.value.message


@pytest.fixture(scope="module")
def pptx(tmp_path_factory: pytest.TempPathFactory) -> bytes:
    return made_by_libreoffice(tmp_path_factory.mktemp("pptx"), "pptx")


def test_pptx_renders_every_slide_within_the_cap(tmp_path, pptx):
    result = job(tmp_path, pptx)
    assert [png_size(p) for p in result.slides] == [(2560, 1440), (2560, 1440)]
    [odd] = [w for w in result.warnings if w["font"] == ODD_FONT]
    assert odd["code"] == "font_missing" and odd["slides"] == [1, 2]


def test_pdf_renders_without_libreoffice(tmp_path):
    result = job(tmp_path, made_by_libreoffice(tmp_path, "pdf", slides=3))
    assert len(result.slides) == 3 and png_size(result.slides[0]) == (2560, 1440)
    # LibreOffice embeds what it drew with, so the PDF itself needs no warning.
    assert result.warnings == []


def test_pdf_names_fonts_it_does_not_embed(tmp_path):
    result = job(tmp_path, pdf_pages(2))
    assert len(result.slides) == 2
    [w] = result.warnings
    assert w["font"] == "FancyUnembedded" and w["slides"] == [1, 2]
    assert fc_match("FancyUnembedded") in str(w["message"])


def test_hostile_external_image(tmp_path, pptx):
    code, message = refusal(tmp_path, add_slide_rel(pptx, EXTERNAL_IMAGE_REL))
    assert code == "file_invalid" and "outside the file" in message


def test_hostile_huge_image(tmp_path, pptx):
    deck = with_entries(pptx, {"ppt/media/huge.png": png_header(40000, 40000)})
    code, message = refusal(tmp_path, deck)
    assert code == "file_invalid" and "40000 by 40000" in message


def test_hostile_macros(tmp_path, pptx):
    deck = with_entries(pptx, {"ppt/vbaProject.bin": b"\x00" * 64})
    assert refusal(tmp_path, deck)[0] == "file_invalid"


def test_too_many_pages(tmp_path):
    assert refusal(tmp_path, pdf_pages(301))[0] == "too_many_slides"


def test_damaged_files(tmp_path, pptx):
    assert refusal(tmp_path, pptx[: len(pptx) // 2])[0] == "file_invalid"
    assert refusal(tmp_path, b"%PDF-1.4\n garbage")[0] in ("file_invalid", "renderer_failed")


def test_timeout(tmp_path, pptx):
    code, message = refusal(tmp_path, pptx, timeout=0.2)
    assert code == "render_timeout" and "10 minutes" in message


def test_limits_are_the_contract_ones():
    assert Limits().max_slides == 300 and Limits().max_deck_bytes == 100 * 1024 * 1024
