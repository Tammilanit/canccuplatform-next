/**
 * The engine's (engine.ts) way out: what a moment's row now wants, sent as override events
 * in the caller's tenant transaction, so the events commit with the write (the kit's Outbox).
 */
import type { Outbox, SqlClient } from "@canccu/kit";
import { desiredOverrides, overrideChanges } from "./arbiter.js";
import type { Orders, SentOverride, WantedOverride } from "./arbiter.js";
import { dropPlacements, endOverride, liveOverrides, putOverride, splitZones } from "./store.js";
import type { Actor, MomentRow } from "./store.js";
import type { EndReason } from "./engine.js";
import { overrideHints } from "./announce/chain.js";

/**
 * Sends what changed between the overrides last sent and the ones the moment wants now:
 * `.started` for new ones first (so a zone moved to its own override has no gap), then
 * `.changed`, a narrowing's `.ended` with `final: false`, and `.ended` for the ones it no
 * longer wants (contracts/moments.md, The overrides it emits).
 */
export async function reconcile(
  outbox: Outbox,
  c: SqlClient,
  m: MomentRow,
  actor: Actor | null,
  reason: EndReason,
  orders: Orders,
  known: string[],
): Promise<void> {
  const emit = (type: string, data: Record<string, unknown>) =>
    outbox.add(c, type, data, { version: 1 });
  const stored = new Map((await liveOverrides(c, m.id)).map((s) => [s.override_id, s.sent]));
  const wanted =
    m.ended_at === null ? desiredOverrides(m, orders, known, await splitZones(c, m.id)) : [];
  const by = actor?.user_id ?? null;
  for (const w of wanted.filter((w) => !stored.has(w.id))) {
    const next = sentOf(m, w);
    await putOverride(c, m.id, next);
    await emit("moments.override.started", { override: wire(m, next), actor_user_id: by });
  }
  for (const w of wanted.filter((w) => stored.has(w.id))) {
    const before = stored.get(w.id) as SentOverride;
    const next = sentOf(m, w);
    const changed = overrideChanges(before, next);
    if (changed.length === 0) continue;
    await putOverride(c, m.id, next);
    await emit("moments.override.changed", {
      override: wire(m, next),
      changed,
      actor_user_id: by,
    });
    const left = (before.zones.length === 0 ? known : before.zones).filter(
      (z) => !next.zones.includes(z),
    );
    if (next.zones.length > 0 && left.length > 0) {
      await dropPlacements(c, w.id, left);
      await emit("moments.override.ended", {
        override_id: w.id,
        zones: left,
        reason,
        final: false,
        actor_user_id: by,
      });
    }
  }
  for (const [id, sent] of stored) {
    if (wanted.some((w) => w.id === id)) continue;
    await endOverride(c, id);
    await emit("moments.override.ended", {
      override_id: id,
      zones: sent.zones,
      reason,
      final: true,
      actor_user_id: by,
    });
  }
}

function sentOf(m: MomentRow, w: WantedOverride): SentOverride {
  return {
    id: w.id,
    kind: m.kind,
    zones: w.zones,
    rank: w.rank,
    template: m.template,
    content: m.content,
    regions: m.regions,
    expires_at: m.expires_at?.toISOString() ?? null,
  };
}

/** The Override as the events carry it (events.md, Screen overrides; screen.md, claims). */
function wire(m: MomentRow, s: SentOverride): Record<string, unknown> {
  return {
    ...s,
    ...overrideHints(m),
    source: m.source,
    effect: m.effect,
    sound: null,
    steps: m.steps,
    on_end: "resume",
    starts_at: m.starts_at.toISOString(),
    ends_at: m.ended_at?.toISOString() ?? null,
  };
}
