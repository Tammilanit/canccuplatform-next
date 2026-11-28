"""The import's report as the operator reads it (mockup 14, docs/briefs/step-6-bot/): a row per
kind with the rows it changes, what stays behind and why, the checks, and one closing line. Key
names only, never a value from the `.env`."""

from __future__ import annotations

from .legacy_import import Report

WIDTH = 18


def _rows(n: int) -> str:
    return f"{n} row" if n == 1 else f"{n} rows"


def _last(report: Report) -> str:
    n = report.changes
    if report.refused is not None:
        if report.dry_run:
            return f"Would change {_rows(n)}, but the import refuses now: {report.refused}"
        return f"Refused: {report.refused} Nothing was written."
    if n == 0:
        return "Nothing to change: everything is already imported."
    if report.dry_run:
        return f"Would change {_rows(n)}. Run without --dry-run to import."
    return f"Imported {_rows(n)}. Next: the client secret and the bind in the Discord page's setup."


def render(report: Report) -> str:
    title = (
        "Legacy bot import · DRY RUN · nothing is written"
        if report.dry_run
        else "Legacy bot import"
    )
    out = [title]
    for line in report.lines:
        out.append(f"{line.kind:<{WIDTH}}{line.changes:<4}{line.text}")
    out.append(f"{'Skipped':<{WIDTH}}{len(report.skipped)}")
    for why, keys in report.skipped:
        out.append(f"  {why}: {', '.join(keys)}" if keys else f"  {why}")
    for i, (check, ok) in enumerate(report.checks):
        head = "Checks" if i == 0 else ""
        out.append(f"{head:<{WIDTH}}{check} {'✓' if ok else '✗'}")
    out.append(_last(report))
    return "\n".join(out)
