"""Deck to slide PNGs: LibreOffice for PPTX (to PDF), then poppler draws each page.

Every external program runs in its own process group under the job's deadline, so a timeout or a
cancel kills LibreOffice's helpers too, never just the parent.
"""

import os
import re
import shutil
import signal
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .fonts import Matcher, Warning, fc_match, parse_pdffonts, pdf_warnings, pptx_warnings
from .inspect import Limits, RenderError, inspect_pptx, invalid, sniff, too_many_slides

MAX_WIDTH, MAX_HEIGHT = 2560, 1440  # the contract's image cap (plan R10)
# Settings for LibreOffice's throw-away profile: macros off, linked content never loaded (plan R6).
PROFILE_TEMPLATE = Path(os.environ.get("CANCCU_RENDER_PROFILE", "/opt/canccu-render/profile"))
PAGE_RE = re.compile(r"^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)", re.M)

StopCheck = Callable[[], bool]


class Cancelled(Exception):
    """The caller went away; nobody wants the result."""


@dataclass
class Rendered:
    slides: list[Path]
    warnings: list[Warning] = field(default_factory=list)


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
            if timed_out or should_stop():
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
    scale = min(MAX_WIDTH / width, MAX_HEIGHT / height)
    return round(width * scale), round(height * scale)


def page_sizes(pdfinfo: str) -> dict[int, tuple[float, float]]:
    return {int(n): (float(w), float(h)) for n, w, h in PAGE_RE.findall(pdfinfo)}


def render(
    deck: bytes,
    workdir: Path,
    should_stop: StopCheck,
    limits: Limits | None = None,
    timeout: float = 600,
    match: Matcher = fc_match,
) -> Rendered:
    deadline = time.monotonic() + timeout
    limits = limits or Limits()
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
    page_info = run(["pdfinfo", "-f", "1", "-l", str(pages), str(pdf)], deadline, should_stop)
    sizes = page_sizes(page_info)

    slides = []
    out_dir = workdir / "slides"
    out_dir.mkdir()
    for n in range(1, pages + 1):
        width, height = fit_box(*sizes.get(n, (16.0, 9.0)))
        base = out_dir / f"slide-{n}"
        run(
            ["pdftoppm", "-png", "-f", str(n), "-l", str(n), "-singlefile",
             "-scale-to-x", str(width), "-scale-to-y", str(height), str(pdf), str(base)],
            deadline, should_stop,
        )  # fmt: skip
        slides.append(base.with_suffix(".png"))

    if kind == "pptx":
        warnings = pptx_warnings(info.fonts, pages, match)
    else:
        per_page = {
            n: parse_pdffonts(
                run(["pdffonts", "-f", str(n), "-l", str(n), str(pdf)], deadline, should_stop)
            )
            for n in range(1, pages + 1)
        }
        warnings = pdf_warnings(per_page, match)
    return Rendered(slides=slides, warnings=warnings)


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
