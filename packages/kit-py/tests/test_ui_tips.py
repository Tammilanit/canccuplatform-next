"""The one tooltip and the page check of the organiser pages (#782): the same markup as
packages/ui's tip.ts and page-check.ts."""

from __future__ import annotations

import re

from canccu_kit.ui import shell_page


def _tip_id(markup: str) -> str:
    found = re.search(r'role="tooltip" id="([^"]+)"', markup)
    return found.group(1) if found else ""


def test_tooltip_names_its_text_on_the_trigger() -> None:
    from canccu_kit.ui import tooltip

    out = tooltip('<a href="/x">Open</a>', "Opens the <live> view")
    assert f'<a aria-describedby="{_tip_id(out)}" href="/x">Open</a>' in out
    assert "Opens the &lt;live&gt; view</span>" in out


def test_info_tip_and_icon_button_and_status_chip() -> None:
    from canccu_kit.ui import icon_button, info_tip, status_chip

    info = info_tip("Checks that phones can receive notifications.")
    assert 'class="canccu-tip__info" aria-label="More about this"' in info
    assert _tip_id(info) != _tip_id(info_tip("b"))
    button = icon_button("close", "Remove the zone", href="/z")
    assert 'aria-label="Remove the zone"' in button and 'href="/z"' in button
    assert 'aria-hidden="true">Remove the zone</span>' in button
    chip = status_chip("down", "Down", "The part does not answer.")
    assert 'class="canccu-badge canccu-badge--down" tabindex="0"' in chip
    assert f'aria-describedby="{_tip_id(chip)}"' in chip
    inside_a_link = status_chip("plain", "Crew only", "Only crew see it.", in_link=True)
    assert inside_a_link == '<span class="canccu-badge canccu-badge--plain">Crew only</span>'


def test_page_problems_names_what_a_page_lacks() -> None:
    from canccu_kit.page_check import page_problems
    from canccu_kit.ui import icon_button, status_chip

    bare = (
        '<main><div class="canccu-pagehead"><h1>X</h1></div>'
        '<span class="canccu-badge canccu-badge--down">Down</span>'
        '<button type="button" class="canccu-stepper__button">+</button>'
        '<button aria-label="Less">&minus;</button><button>Save</button></main>'
    )
    assert page_problems(bare) == [
        "no page description",
        "status chip without a tooltip: 'Down'",
        "icon-only button without a label: "
        + repr('<button type="button" class="canccu-stepper__button">+</button>'),
        "icon-only button without a tooltip: 'Less'",
    ]
    good = shell_page(
        "X",
        status_chip("down", "Down", "It does not answer.") + icon_button("close", "Remove"),
        description_html="What X is for.",
    )
    assert page_problems(good) == []
    # A chip inside a link is part of the link's text; one after the link is not.
    chip = '<span class="canccu-badge canccu-badge--down">Off</span>'
    row = f'<a class="row" href="/i">Dinner {chip}</a>'
    assert page_problems(shell_page("X", row, description_html="For X.")) == []
    after = shell_page("X", row + chip, description_html="For X.")
    assert page_problems(after) == ["status chip without a tooltip: 'Off'"]
    long = shell_page("X", "", description_html="One. Two. Three.")
    assert page_problems(long) == ["page description longer than two sentences: 'One. Two. Three.'"]
    # Entities count as the characters they stand for; a chip's tooltip is not part of the count.
    coded = shell_page("X", "", description_html="One&#46; Two&#x2e; Three&#46;")
    assert page_problems(coded) == [
        "page description longer than two sentences: 'One. Two. Three.'"
    ]
    chip = status_chip("plain", "Draft", "Kept here. Not published. Yours.")
    tipped = shell_page("X", "", description_html=f"{chip} Nothing published yet.")
    assert page_problems(tipped) == []
