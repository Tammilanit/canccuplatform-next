/** A zone's version (contracts/screen.md, Composed state): the hash of what its screens draw from. */
import { createHash } from "node:crypto";
import type { Override } from "./claims.js";
import { NO_DISPLAY } from "./display.js";
import type { Display } from "./display.js";
import type { ZoneScene } from "./scenes.js";
import type { Play } from "../moments-sound.js";
import type { ZoneRow } from "./state.js";
import type { ZoneFacts } from "./widgets.js";

export interface FingerprintInput {
  zone: ZoneRow;
  windowLayoutId: string | null;
  theme: { revision: number; layouts: unknown[] };
  facts: ZoneFacts;
  tickerAppearance?: string;
  /** Holds the `burn_in_drift` setting and the energy level, which no other input carries. */
  display?: Display;
  /** The overrides active on the zone now: one that ends changes the inputs, so it is drawn away. */
  claims?: readonly Override[];
  /** The pinned bundle: a pin change moves the version, so streams send the new `bundle`. */
  bundle?: string | null;
  /** Moves with the event's count of screens, which no other input carries. */
  showName?: boolean;
  /** The cards' and the tint's art read (compose/stage.ts): a cover read only later moves it. */
  art?: readonly string[];
  /** Moments' sound: each new one is a new version, so every screen of the zone gets it. */
  play?: Play | null;
  /** The zone's scene: its layout and hero features are in no other input. */
  scene?: ZoneScene | null;
  /** Moments' preload: a new video is a new version, so the screens fetch it ahead. */
  prefetch?: readonly string[];
}

/**
 * What a zone's screens draw is a function of these inputs, the time and the screen's
 * orientation. Hashing the inputs rather than the output keeps time (the clock, cycles, shuffled
 * orders) and orientation out, so landscape and portrait screens of one zone share one version
 * and only an edit or a source's change moves it.
 */
export function zoneFingerprint(input: FingerprintInput): string {
  const stable = {
    zone: input.zone,
    window: input.windowLayoutId,
    theme: input.theme,
    facts: { ...input.facts, now: null },
    ticker: input.tickerAppearance ?? "default",
    display: input.display ?? NO_DISPLAY,
    claims: input.claims ?? [],
    bundle: input.bundle ?? null,
    show_name: input.showName ?? true,
    art: input.art ?? [],
    play: input.play ?? null,
    scene: input.scene ?? null,
    // Absent while empty, so a zone's version stays as it was before the preload existed.
    ...(input.prefetch === undefined || input.prefetch.length === 0
      ? {}
      : { prefetch: input.prefetch }),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("base64url");
}
