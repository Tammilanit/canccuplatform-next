import time

import pytest

from canccu_screen_render.convert import (
    Cancelled,
    batches,
    fit_box,
    largest_pdf_image,
    page_sizes,
    run,
    turned,
)
from canccu_screen_render.inspect import RenderError


def test_fit_box_keeps_the_aspect_within_3840x2160():
    assert fit_box(960, 540) == (3840, 2160)
    assert fit_box(720, 540) == (2880, 2160)
    assert fit_box(540, 960) == (1215, 2160)


def test_page_sizes_from_pdfinfo():
    out = (
        "Pages:          2\nPage    1 size: 960 x 540 pts\nPage    1 rot:  0\n"
        "Page    2 size: 595.2 x 841.92 pts (A4)\n"
    )
    assert page_sizes(out) == {1: (960.0, 540.0), 2: (595.2, 841.92)}


def test_run_returns_output():
    assert run(["sh", "-c", "echo hi"], time.monotonic() + 10, lambda: False).strip() == "hi"


def test_run_kills_the_whole_group_at_the_deadline(tmp_path):
    marker = tmp_path / "child-alive"
    started = time.monotonic()
    with pytest.raises(RenderError) as e:
        cmd = ["sh", "-c", f"(sleep 2; touch {marker}) & sleep 30"]
        run(cmd, time.monotonic() + 0.5, lambda: False)
    assert e.value.code == "render_timeout" and "10 minutes" in e.value.message
    assert time.monotonic() - started < 5
    time.sleep(2.5)
    assert not marker.exists()  # the grandchild died with its group


def test_run_stops_when_asked():
    with pytest.raises(Cancelled):
        run(["sleep", "30"], time.monotonic() + 60, lambda: True)


def test_run_failure_is_renderer_failed():
    with pytest.raises(RenderError) as e:
        run(["sh", "-c", "exit 3"], time.monotonic() + 10, lambda: False)
    assert e.value.code == "renderer_failed"


def test_page_sizes_follow_the_rotation():
    out = (
        "Page    1 size: 612 x 792 pts (letter)\nPage    1 rot:  90\n"
        "Page    2 size: 960 x 540 pts\nPage    2 rot:  180\n"
    )
    assert page_sizes(out) == {1: (792.0, 612.0), 2: (960.0, 540.0)}
    assert turned(out) == {1}


def test_batches_group_pages_with_the_same_box():
    boxes = {1: (3840, 2160), 2: (3840, 2160), 3: (2880, 2160), 4: (3840, 2160), 5: (3840, 2160)}
    assert batches(boxes, 2) == [(1, 2), (3, 3), (4, 5)]


def test_largest_pdf_image():
    out = (
        "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi\n"
        "-------------------------------------------------------------------------------\n"
        "   1     0 image     640   480  gray    1   8  image  no         9  0    72    72\n"
        "   2     1 image   40000 40000  gray    1   8  image  no        10  0    72    72\n"
    )
    assert largest_pdf_image(out) == (2, 40000, 40000)
    assert largest_pdf_image("") is None


def test_run_treats_a_failing_stop_check_as_stop(tmp_path):
    def broken() -> bool:
        raise ConnectionResetError

    started = time.monotonic()
    with pytest.raises(Cancelled):
        run(["sleep", "30"], time.monotonic() + 60, broken)
    assert time.monotonic() - started < 5
