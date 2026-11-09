import time

import pytest

from canccu_screen_render.convert import Cancelled, fit_box, page_sizes, run
from canccu_screen_render.inspect import RenderError


def test_fit_box_keeps_the_aspect_within_2560x1440():
    assert fit_box(960, 540) == (2560, 1440)
    assert fit_box(720, 540) == (1920, 1440)
    assert fit_box(540, 960) == (810, 1440)


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
