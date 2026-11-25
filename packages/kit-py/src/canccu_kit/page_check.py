"""What every organiser page must have (#782, docs/design/README.md decisions 8 and 9), as a test
helper the modules' page tests call on each page they draw: a description of at most two
sentences and 240 characters under the title, a tooltip on every status chip, and a label and a
tooltip on every icon-only button. The shell's own header and menu are the kit's, tested there;
the check reads the page's `<main>`. packages/ui's page-check.ts is its twin."""

from __future__ import annotations

import html
import re

_MAIN = re.compile(r"<main\b.*?</main>", re.S)
_DESC = re.compile(r'<p class="canccu-pagehead__desc">(.*?)</p>', re.S)
_BADGE = re.compile(r'<span class="canccu-badge[^"]*"([^>]*)>(.*?)</span>', re.S)
_BUTTON = re.compile(r"<(button|a)\b([^>]*)>(.*?)</\1>", re.S)
_TAG = re.compile(r"<[^>]+>")
# A status chip in a description: its tooltip is shown on demand, not read as the description.
_TIP_TEXT = re.compile(r'<span\b[^>]*class="canccu-tip__text"[^>]*>.*?</span>', re.S)
_SENTENCE_END = re.compile(r"[.!?](?=\s|$)")
TIP_OPEN = '<span class="canccu-tip">'
MAX_DESCRIPTION = 240


def _text(markup: str) -> str:
    return html.unescape(_TAG.sub("", markup)).strip()


def page_problems(doc: str) -> list[str]:
    """Each missing description, untipped chip or unlabelled icon button, in words; empty when
    the page keeps the rules."""
    found = _MAIN.search(doc)
    main = found.group(0) if found else doc
    problems: list[str] = []
    if 'class="canccu-pagehead"' in main:
        desc = _DESC.search(main)
        text = _text(_TIP_TEXT.sub("", desc.group(1))) if desc else ""
        if not text:
            problems.append("no page description")
        elif len(text) > MAX_DESCRIPTION or len(_SENTENCE_END.findall(text)) > 2:
            problems.append(f"page description longer than two sentences: {text!r}")
    for chip in _BADGE.finditer(main):
        if "aria-describedby=" not in chip.group(1):
            problems.append(f"status chip without a tooltip: {_text(chip.group(2))!r}")
    for button in _BUTTON.finditer(main):
        tag, attrs, inner = button.groups()
        if tag == "a" and "canccu-button" not in attrs:
            continue
        if len(_text(inner)) > 1:
            continue
        label = re.search(r'aria-label="([^"]*)"', attrs)
        if label is None:
            problems.append(f"icon-only button without a label: {button.group(0)[:80]!r}")
        elif not main[: button.start()].endswith(TIP_OPEN):
            problems.append(f"icon-only button without a tooltip: {label.group(1)!r}")
    return problems
