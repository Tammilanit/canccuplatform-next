"""The owner and admin roles hold every right a module checks (issue #772).

contracts/admin.md says an event admin holds every right, but admin's role list once named only
admin's own, and CI's session stub holds them all, so nothing noticed. This test gathers every
right the contracts, the shared menu and the modules' code name, and holds admin's list to it in
both directions: a module right admin forgot fails, and so does one admin invented.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from canccu_admin.auth import ROLE_RIGHTS
from conftest import ROOT, World, owner_and_member

# The file that holds the list under test: scanning it would make the list prove itself.
ROLE_LIST = ROOT / "modules/admin/src/canccu_admin/roles.py"
CODE_SUFFIXES = (".py", ".ts")
TOKEN = re.compile(r"`([a-z][a-z_]*(?:\.[a-z_]+)+)`")
# "Right `x`", "rights `x`": how the contracts' paths name the right they need.
NAMED_RIGHT = re.compile(r"[Rr]ights? `([a-z][a-z_]*(?:\.[a-z_]+)+)`")
LITERAL = re.compile(r"""["']([a-z][a-z_]*(?:\.[a-z_]+)+)["']""")
# An UPPER_CASE constant's assignment: `X = …`, `export const X: T = …`.
CONSTANT = re.compile(r"^[ \t]*(?:export\s+)?(?:const\s+)?([A-Z][A-Z0-9_]*)\b[^=\n]*?=(?![=>])", re.M)
# The calls that check a right, in the kit and the modules: TS `needs`, `requireRight`,
# `rights.check`, `rights.has`, `holds`; Python `require_right`, `right_dependency`,
# `session.has`, `need`, tenants' `can`, `require` and `require_all`.
CHECK = re.compile(
    r"\b(?:needs|need|requireRight|require_right|right_dependency|has|check|holds|can|require|"
    r"require_all)\(([^()]*)\)"
)
NAME = re.compile(r"\b[A-Z][A-Z0-9_]*\b")


def module_names(root: Path) -> set[str]:
    names = {p.name for p in (root / "modules").iterdir() if p.is_dir()}
    return names | {p.stem for p in (root / "contracts").glob("*.md")}


def right_shaped(found: set[str], root: Path) -> set[str]:
    """Only `<module>.<right>` strings: drops file names, flags of no module and the like."""
    modules = module_names(root)
    return {r for r in found if r.split(".")[0] in modules and r.rsplit(".", 1)[1] != "md"}


def contract_rights(root: Path) -> set[str]:
    found: set[str] = set()
    for path in sorted((root / "contracts").rglob("*")):
        if path.suffix not in (".md", ".yaml"):
            continue
        text = path.read_text(encoding="utf-8")
        found |= set(NAMED_RIGHT.findall(text))
        if path.suffix == ".md":
            for section in re.findall(r"^## Rights\n(.*?)(?=^## |\Z)", text, re.M | re.S):
                found |= set(TOKEN.findall(section))
            for line in re.findall(r"^Admin's own rights:.*$", text, re.M):
                found |= set(TOKEN.findall(line))
    # A Rights section may say which event a grant emits (screen.md: `admin.rights.changed`).
    catalog = (root / "contracts/events.md").read_text(encoding="utf-8")
    events = set(re.findall(r"^\| `([a-z_.]+)` \|", catalog, re.M))
    return right_shaped(found - events, root)


def menu_rights(root: Path) -> set[str]:
    def walk(node: object) -> Iterator[str]:
        if isinstance(node, dict):
            for key, value in node.items():
                if key == "rights" and isinstance(value, list):
                    yield from (r for r in value if isinstance(r, str))
                else:
                    yield from walk(value)
        elif isinstance(node, list):
            for item in node:
                yield from walk(item)

    menu = json.loads((root / "packages/ui/src/menu.json").read_text(encoding="utf-8"))
    return right_shaped(set(walk(menu)), root)


def initializer(text: str, start: int) -> str:
    """The expression after `=`: up to the end of its line, or of its brackets if it opens one."""
    depth, i = 0, start
    while i < len(text):
        c = text[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c in "\n;" and depth <= 0:
            break
        i += 1
    return text[start:i]


def code_rights(root: Path) -> set[str]:
    """Every right a module's code checks: a string, or an UPPER_CASE constant of the same unit
    (a module or a package), passed to a rights check, and every constant named for rights
    (`PIN_READ_RIGHTS`, `CHANGE_RIGHTS`, `BY_RIGHT`). Event names and other dotted strings
    elsewhere in the code are not rights and are left out."""
    found: set[str] = set()
    for unit in sorted([*(root / "modules").iterdir(), *(root / "packages").iterdir()]):
        files = [
            p
            for p in sorted((unit / "src").rglob("*"))
            if p.suffix in CODE_SUFFIXES
            and p.resolve() != ROLE_LIST.resolve()
            and "node_modules" not in p.parts
            and not p.name.endswith(".d.ts")
        ]
        texts = [p.read_text(encoding="utf-8") for p in files]
        constants: dict[str, list[str]] = {}
        for text in texts:
            for m in CONSTANT.finditer(text):
                constants.setdefault(m.group(1), []).append(initializer(text, m.end()))

        def resolve(expr: str, seen: frozenset[str]) -> set[str]:
            out = set(LITERAL.findall(expr))
            for name in set(NAME.findall(expr)) - seen:
                for value in constants.get(name, []):
                    out |= resolve(value, seen | {name})
            return out

        for text in texts:
            for args in CHECK.findall(text):
                found |= resolve(args, frozenset())
        for name, values in constants.items():
            if "RIGHT" in name:
                for value in values:
                    found |= resolve(value, frozenset({name}))
    return right_shaped(found, root)


def every_right(root: Path) -> set[str]:
    return contract_rights(root) | menu_rights(root) | code_rights(root)


def test_the_owner_holds_every_right_a_module_names() -> None:
    needed = every_right(ROOT)
    owner = ROLE_RIGHTS["owner"]
    assert sorted(needed - owner) == [], "rights no role holds: add them to admin's list"
    assert sorted(owner - needed) == [], "rights in admin's list that nothing names"


def test_an_admin_holds_them_all_but_handing_out_rights() -> None:
    assert ROLE_RIGHTS["admin"] == ROLE_RIGHTS["owner"] - {"admin.rights.write"}


def test_the_scan_finds_a_right_only_the_code_checks(tmp_path: Path) -> None:
    """A right a module checks but no contract lists still reaches the list: the guard of #772."""
    (tmp_path / "contracts").mkdir()
    (tmp_path / "contracts/crew.md").write_text(
        "# crew\n## Rights\n`crew.list.read`; a grant emits `crew.list.changed`.\n"
    )
    (tmp_path / "contracts/events.md").write_text("| `crew.list.changed` | A list changed |\n")
    (tmp_path / "packages/ui/src").mkdir(parents=True)
    (tmp_path / "packages/ui/src/menu.json").write_text('{"items": [{"rights": ["crew.a.b"]}]}')
    ts = tmp_path / "modules/crew/src/routes.ts"
    ts.parent.mkdir(parents=True)
    ts.write_text(
        'export const WRITE = "crew.shifts.write";\n'
        "const BY_RIGHT = {\n  swap: WRITE,\n  pin: 'crew.pins.write',\n};\n"
        'app.post("/x", { preHandler: needs(deps.rights, "crew.shifts.close") });\n'
        'app.post("/y", { preHandler: requireRight(deps.rights, WRITE) });\n'
        'await bus.publish("crew.shift.closed", {});\n'
    )
    (tmp_path / "modules/crew/src/access.py").write_text(
        'TEAM = "crew.team.read"\nCSS = "crew.css"\n\n'
        "def page(session):\n    return session.has(TEAM)\n"
    )
    assert code_rights(tmp_path) == {
        "crew.shifts.write",
        "crew.shifts.close",
        "crew.pins.write",
        "crew.team.read",
    }
    assert every_right(tmp_path) == code_rights(tmp_path) | {"crew.list.read", "crew.a.b"}


def test_the_scan_sees_the_modules_checks() -> None:
    """The scan reads the real code, not nothing: rights only checks in TS, Python and through
    constants name."""
    found = code_rights(ROOT)
    for right in (
        "screen.devices.pair",  # TS, a literal in `needs`
        "moments.emergency",  # TS, a constant from another file through `requireRight`
        "pizza.order.manage",  # TS, through `BY_RIGHT`
        "notify.checkin.display",  # Python, `session.has(DISPLAY)`
        "agenda.crew.read",  # Python
        "admin.rights.write",  # admin's own pages
    ):
        assert right in found


@pytest.mark.parametrize("role", ["owner", "admin"])
async def test_a_role_session_lists_every_module_right(
    world: World, caplog: pytest.LogCaptureFixture, role: str
) -> None:
    owner, member = await owner_and_member(world, caplog)
    session = owner
    if role == "admin":
        me = (await world.browser(member).get("/api/admin/session")).json()["user"]["id"]
        r = await world.browser(owner).post(f"/admin/people/{me}", data={"role": "admin"})
        assert r.status_code == 303
        session = member
    body = (await world.browser(session).get("/api/admin/session")).json()
    expected = every_right(ROOT) - ({"admin.rights.write"} if role == "admin" else set())
    assert set(body["rights"]) == expected
    assert {"screen.devices.read", "pizza.order.manage"} <= set(body["rights"])


async def test_a_member_without_a_role_holds_no_right(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    body = (await world.browser(member).get("/api/admin/session")).json()
    assert body["rights"] == []
