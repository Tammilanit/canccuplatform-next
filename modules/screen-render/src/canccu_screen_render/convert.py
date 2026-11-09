"""Deck to slide PNGs: LibreOffice for PPTX (to PDF), then poppler draws the pages in batches.

Every external program runs in its own process group under the job's deadline, so a timeout or a
cancel kills LibreOffice's helpers too, never just the parent. Slides are handed to `emit` batch by
batch, which sends and deletes them, so a 300-slide deck at 4K never sits in /tmp at once.
"""

import os
import re
import shutil
import signal
import subprocess
import time
from collections.abc import Callable, Mapping
from pathlib import Path

from .fonts import Matcher, Warning, parse_pdffonts, pdf_warnings, pptx_warnings
from .inspect import (
    MAX_SLIDE_H,
    MAX_SLIDE_W,
    Limits,
    RenderError,
    inspect_pptx,
    invalid,
    sniff,
    too_large_image,
    too_many_slides,
)

# Pages per poppler run: one process per page would cost a 300-slide deck 300 starts of a
# process that re-reads the whole PDF, and the batch bounds the PNGs on disk at a time.
BATCH = 10
# Settings for LibreOffice's throw-away profile: macros off, linked content never loaded (plan R6).
PROFILE_TEMPLATE = Path(os.environ.get("CANCCU_RENDER_PROFILE", "/opt/canccu-render/profile"))
SIZE_RE = re.compile(r"^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)", re.M)
ROT_RE = re.compile(r"^Page\s+(\d+)\s+rot:\s+(\d+)", re.M)

StopCheck = Callable[[], bool]
Emit = Callable[[Path], None]


class Cancelled(Exception):
    """The caller went away; nobody wants the result."""


def _stopped(should_stop: StopCheck) -> bool:
    try:
        return should_stop()
    except OSError:  # the check itself failing (a reset connection) means the caller is gone
        return True


def run(cmd: list[str], deadline: float, should_stop: StopCheck, cwd: Path | None = None) -> str:
    proc = subprocess.Popen(
        cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True
    )
    while True:
        try:
            out, _ = proc.communicate(timeout=0.25)
            break
        except subprocess.TimeoutExpired:
            timed_out = time.monotonic() > deadline
            if timed_out or _stopped(should_stop):
                os.killpg(proc.pid, signal.SIGKILL)
                proc.communicate()
                if timed_out:
                    raise RenderError(
                        "render_timeout",
                        "Drawing the deck took longer than 10 minutes. Make it smaller "
                        "(fewer slides, smaller pictures) and upload it again.",
                    ) from None
                raise Cancelled from None
    if proc.returncode != 0:
        raise RenderError("renderer_failed", "The deck could not be drawn. " + _hint())
    return out.decode(errors="replace")


def _hint() -> str:
    return "Open it in PowerPoint, save it again (or export it as PDF) and upload that file."


def fit_box(width: float, height: float) -> tuple[int, int]:
    scale = min(MAX_SLIDE_W / width, MAX_SLIDE_H / height)
    return round(width * scale), round(height * scale)


def turned(pdfinfo: str) -> set[int]:
    """Pages a quarter turn round (/Rotate 90 or 270)."""
    return {int(n) for n, r in ROT_RE.findall(pdfinfo) if int(r) % 180 == 90}


def page_sizes(pdfinfo: str) -> dict[int, tuple[float, float]]:
    """Each page's size as drawn: pdfinfo gives the unrotated box, poppler draws it rotated."""
    rot = {int(n): int(r) % 360 for n, r in ROT_RE.findall(pdfinfo)}
    sizes = {}
    for n, w, h in SIZE_RE.findall(pdfinfo):
        page = int(n)
        sizes[page] = (float(h), float(w)) if rot.get(page) in (90, 270) else (float(w), float(h))
    return sizes


def batches(boxes: Mapping[int, object], size: int) -> list[tuple[int, int]]:
    """Runs of consecutive pages that share a target box, at most `size` pages each."""
    runs: list[tuple[int, int]] = []
    for page in sorted(boxes):
        if runs and boxes[runs[-1][0]] == boxes[page] and page - runs[-1][0] < size:
            runs[-1] = (runs[-1][0], page)
        else:
            runs.append((page, page))
    return runs


def largest_pdf_image(pdfimages_list: str) -> tuple[int, int, int] | None:
    """(page, width, height) of the image with the most pixels, from `pdfimages -list`."""
    best = None
    lines = pdfimages_list.splitlines()
    dash = next((i for i, line in enumerate(lines) if line.startswith("---")), len(lines))
    for line in lines[dash + 1 :]:
        fields = line.split()
        if len(fields) > 4 and fields[0].isdigit() and fields[3].isdigit() and fields[4].isdigit():
            page, width, height = int(fields[0]), int(fields[3]), int(fields[4])
            if best is None or width * height > best[1] * best[2]:
                best = (page, width, height)
    return best


def fc_matcher(deadline: float, should_stop: StopCheck) -> Matcher:
    """fontconfig's substitute for a font, under the job's deadline like every other program."""

    def match(name: str) -> str:
        out = run(["fc-match", "-f", "%{family}", name], deadline, should_stop)
        return out.split(",")[0].strip()

    return match


def render(
    deck: bytes,
    workdir: Path,
    should_stop: StopCheck,
    emit: Emit,
    limits: Limits | None = None,
    timeout: float = 600,
    match: Matcher | None = None,
) -> list[Warning]:
    """Draw every slide, hand each PNG to `emit` in order, and return the font warnings."""
    deadline = time.monotonic() + timeout
    limits = limits or Limits()
    match = match or fc_matcher(deadline, should_stop)
    kind = sniff(deck)
    if kind == "pptx":
        info = inspect_pptx(deck, limits)
        (workdir / "deck.pptx").write_bytes(deck)
        pdf = _to_pdf(workdir, deadline, should_stop)
    else:
        pdf = workdir / "deck.pdf"
        pdf.write_bytes(deck)

    count_out = run(["pdfinfo", str(pdf)], deadline, should_stop)
    pages = int(m.group(1)) if (m := re.search(r"^Pages:\s+(\d+)", count_out, re.M)) else 0
    if pages > limits.max_slides:
        raise too_many_slides(pages, limits)
    if pages == 0:
        raise invalid("The deck has no slides.")
    if kind == "pdf":
        big = largest_pdf_image(run(["pdfimages", "-list", str(pdf)], deadline, should_stop))
        if big and big[1] * big[2] > limits.max_image_pixels:
            raise too_large_image(big[1], big[2])
    page_info = run(["pdfinfo", "-f", "1", "-l", str(pages), str(pdf)], deadline, should_stop)
    sizes, quarter = page_sizes(page_info), turned(page_info)
    # pdftoppm scales the unrotated page and turns it afterwards, so a turned page's box is
    # given to it the other way round.
    boxes = {
        n: (h, w) if n in quarter else (w, h)
        for n in range(1, pages + 1)
        for w, h in [fit_box(*sizes.get(n, (16.0, 9.0)))]
    }

    out_dir = workdir / "slides"
    out_dir.mkdir()
    for first, last in batches(boxes, BATCH):
        width, height = boxes[first]
        base = out_dir / f"b{first}"
        run(
            ["pdftoppm", "-png", "-f", str(first), "-l", str(last),
             "-scale-to-x", str(width), "-scale-to-y", str(height), str(pdf), str(base)],
            deadline, should_stop,
        )  # fmt: skip
        drawn = sorted(out_dir.glob(f"b{first}-*.png"), key=lambda p: int(p.stem.rsplit("-")[-1]))
        if len(drawn) != last - first + 1:
            raise RenderError("renderer_failed", "Some slides could not be drawn. " + _hint())
        for png in drawn:
            emit(png)

    if kind == "pptx":
        return pptx_warnings(info.fonts, pages, match)
    if all(
        embedded
        for _, embedded in parse_pdffonts(run(["pdffonts", str(pdf)], deadline, should_stop))
    ):
        return []
    per_page = {
        n: parse_pdffonts(
            run(["pdffonts", "-f", str(n), "-l", str(n), str(pdf)], deadline, should_stop)
        )
        for n in range(1, pages + 1)
    }
    return pdf_warnings(per_page, match)


def _to_pdf(workdir: Path, deadline: float, should_stop: StopCheck) -> Path:
    profile = workdir / "profile"
    if PROFILE_TEMPLATE.is_dir():
        shutil.copytree(PROFILE_TEMPLATE, profile)
    out = workdir / "pdf"
    run(
        ["soffice", f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore",
         "--nolockcheck", "--nodefault", "--convert-to", "pdf:impress_pdf_Export",
         "--outdir", str(out), str(workdir / "deck.pptx")],
        deadline, should_stop, cwd=workdir,
    )  # fmt: skip
    pdf = out / "deck.pdf"
    if not pdf.exists():
        # soffice exits 0 when it cannot open a file; the missing output is the only sign.
        raise RenderError("renderer_failed", "LibreOffice could not open the deck. " + _hint())
    return pdf
