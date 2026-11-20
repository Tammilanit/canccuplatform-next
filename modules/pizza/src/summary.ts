/**
 * The holder's summary and its copy-as-text (the legacy `summary.ts`, the base of #118's call mode).
 * Comments never appear here: they are between the person and the holder.
 */
import { formatDayLabel } from "./time.js";

export interface SummaryItem {
  /** The person's name. */
  name: string;
  kind: "menu" | "custom" | "text";
  number: string | null;
  label: string;
  note: string | null;
  comment: string | null;
}

export interface SummaryLine {
  count: number;
  label: string;
  note: string | null;
}

export interface Summary {
  header: string;
  pizza_count: number;
  lines: SummaryLine[];
  who: { name: string; count: number }[];
  text: string;
}

/** Natural order for menu numbers like 2, 12, 12a. */
function numKey(n: string | null): [number, string] {
  const parsed = parseInt(n ?? "", 10);
  return [Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed, n ?? ""];
}

export function buildSummary(
  order: { day: string; seq: number; pizzeria: string },
  items: SummaryItem[],
): Summary {
  const menuLines = new Map<string, { number: string | null; line: SummaryLine }>();
  const singles: SummaryLine[] = [];
  for (const it of items) {
    if (it.kind === "menu") {
      const key = `${it.label}|${it.note ?? ""}`;
      const cur = menuLines.get(key);
      if (cur) cur.line.count++;
      else
        menuLines.set(key, {
          number: it.number,
          line: { count: 1, label: it.label, note: it.note },
        });
    } else {
      singles.push({ count: 1, label: it.label, note: it.note });
    }
  }
  const sorted = [...menuLines.values()].sort((a, b) => {
    const [an, as] = numKey(a.number);
    const [bn, bs] = numKey(b.number);
    return an - bn || as.localeCompare(bs) || (a.line.note ? 1 : 0) - (b.line.note ? 1 : 0);
  });
  const lines = [...sorted.map((l) => l.line), ...singles];

  const byPerson = new Map<string, number>();
  for (const it of items) byPerson.set(it.name, (byPerson.get(it.name) ?? 0) + 1);
  const who = [...byPerson.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const n = items.length;
  const header = `${order.pizzeria} · ${formatDayLabel(order.day)} · order ${order.seq} · ${n} pizza${n === 1 ? "" : "s"}`;
  const body = lines.map((l) => `${l.count} × ${l.label}${l.note ? ` — ${l.note}` : ""}`);
  const whoLine = `Who: ${who.map((w) => (w.count > 1 ? `${w.name} (${w.count})` : w.name)).join(", ")}`;
  const text = [header, "", ...body, ...(n ? [""] : []), whoLine].join("\n");
  return { header, pizza_count: n, lines, who, text };
}
