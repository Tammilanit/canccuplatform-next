/**
 * The rules behind the Devices page's notices (step 3 plan, E2, E3, E10): when the venue's uplink
 * is the likely cause, and which plain steps a device that needs help shows. Pure, so they are
 * tested apart from any page.
 */
import type { MessageKey } from "./messages.js";

/** A device as `GET /api/screen/devices` answers it, as far as the rules read it. */
export interface SeenDevice {
  id: string;
  name: string;
  zone_key: string | null;
  mirror_of: { device_id: string } | { zone_key: string } | null;
  health?: {
    online: boolean;
    last_seen_at: string | null;
    flags?: string[];
    state_lag?: number;
  };
}

/** Screens that all went quiet within this of each other dropped together (E2). */
export const UPLINK_WINDOW_MS = 60_000;

/**
 * True when every screen of the venue is offline and all of them went quiet within one minute:
 * one cause, most likely the uplink, so one notice replaces the per-device alarms. An event's
 * devices are all at its venue. A single screen proves nothing about the uplink.
 */
export function uplinkDown(devices: readonly SeenDevice[]): boolean {
  if (devices.length < 2) return false;
  const seen: number[] = [];
  for (const d of devices) {
    if (d.health?.online !== false || d.health.last_seen_at === null) return false;
    seen.push(Date.parse(d.health.last_seen_at));
  }
  return Math.max(...seen) - Math.min(...seen) <= UPLINK_WINDOW_MS;
}

/**
 * A screen reports what it applied with its next heartbeat, so one or two changes behind is a
 * heartbeat not sent yet; three means it is missing changes.
 */
export const BEHIND_AFTER = 3;

export interface Problem {
  /** What is wrong, in one sentence. */
  title: MessageKey;
  /** What to do, in the order a crew member would check. */
  steps: MessageKey[];
}

/**
 * What needs help on this device, most urgent first; empty for a healthy one. While the uplink is
 * down the offline steps start there, and otherwise say the uplink is fine.
 */
export function problemsOf(device: SeenDevice, uplink: boolean): Problem[] {
  const h = device.health;
  const problems: Problem[] = [];
  if (h !== undefined && !h.online && h.last_seen_at !== null) {
    problems.push({
      title: "help.offline",
      steps: [
        ...(uplink ? ["help.offline.uplink_down" as const] : []),
        "help.offline.power",
        "help.offline.network",
        ...(uplink ? [] : ["help.offline.uplink_fine" as const]),
        "help.offline.refused",
        "help.offline.restart",
        "help.offline.catches_up",
      ],
    });
  }
  const flags = h?.flags ?? [];
  if (flags.includes("shared_token")) {
    problems.push({ title: "help.shared_token", steps: ["help.shared_token.fix"] });
  }
  if (flags.includes("clock_drift")) {
    problems.push({ title: "help.clock_drift", steps: ["help.clock_drift.fix"] });
  }
  if (h?.online && (h.state_lag ?? 0) >= BEHIND_AFTER) {
    problems.push({ title: "help.behind", steps: ["help.behind.fix"] });
  }
  if (device.zone_key === null && device.mirror_of === null) {
    problems.push({ title: "help.unassigned", steps: ["help.unassigned.fix"] });
  }
  return problems;
}

/** The zone a device draws: its own, the zone it mirrors, or the mirrored device's. */
export function shownZone(device: SeenDevice, all: readonly SeenDevice[]): string | null {
  if (device.zone_key !== null) return device.zone_key;
  const m = device.mirror_of;
  if (m === null) return null;
  if ("zone_key" in m) return m.zone_key;
  return all.find((d) => d.id === m.device_id)?.zone_key ?? null;
}
