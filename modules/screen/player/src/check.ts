/**
 * The kiosk check page, `/screen/check` (plan #109, S14; docs/screen-kiosk.md): what the crew
 * checks on a new kiosk before the doors open. The legacy's black and silent screens came from
 * browser flags, so each row says what is wrong and which flag or setting fixes it.
 */
import { call } from "./api.js";
import type { Answer, Fetch } from "./api.js";
import { audioSettled, audioUnlocked, beep, unlockAudio } from "./audio.js";
import { el, frameHead, setClock } from "./frames.js";
import { STATE_PATH } from "./live.js";
import { isState } from "./state.js";

/** A device whose clock is further off than this is flagged `clock_drift` (contracts/screen.md). */
export const DRIFT_MS = 2000;
export const RECHECK_MS = 5000;

export interface Row {
  name: string;
  ok: boolean;
  value: string;
}

export interface CheckInput {
  viewport: { width: number; height: number; dpr: number };
  /** The server's clock minus this device's; null when the server did not answer. */
  offsetMs: number | null;
  device: Answer;
  /** Sound before any tap (only the autoplay flag allows that), and now. */
  audio: { withoutTap: boolean; now: boolean };
  offline: { available: boolean; active: boolean };
  bundle: string;
}

function viewportRow(v: CheckInput["viewport"]): Row {
  const w = Math.round(v.width * v.dpr);
  const h = Math.round(v.height * v.dpr);
  // Screens are designed for 1920×1080 and up, either way round (plan #109, S11).
  const ok = Math.max(w, h) >= 1920 && Math.min(w, h) >= 1080;
  const shape = h > w ? "portrait" : "landscape";
  const value = `${w}×${h} ${shape} (${v.width}×${v.height} at ${v.dpr}×)`;
  return {
    name: "Screen",
    ok,
    value: ok ? value : `${value}: below 1080p, set the display to 1920×1080 or more`,
  };
}

function clockRow(offsetMs: number | null): Row {
  if (offsetMs === null) return { name: "Clock", ok: false, value: "the server did not answer" };
  const s = (offsetMs / 1000).toFixed(1);
  const ok = Math.abs(offsetMs) <= DRIFT_MS;
  const value = `${offsetMs >= 0 ? "+" : ""}${s} s against the server`;
  return {
    name: "Clock",
    ok,
    value: ok ? value : `${value}: turn on network time (NTP) on this computer`,
  };
}

function deviceRow(answer: Answer): Row {
  const body = answer.body;
  if (answer.status === 200 && isState(body)) {
    const zone = body.zone?.name;
    return zone === undefined
      ? { name: "Device", ok: false, value: `paired as ${body.device.name}, not in a zone yet` }
      : { name: "Device", ok: true, value: `paired as ${body.device.name}, zone ${zone}` };
  }
  const why: Record<string, string> = {
    "401": "not paired: open /screen/ on this kiosk to pair it",
    "403": "refused: this network is not the event's venue",
    "409": "moved or archived: open /screen/ to follow it",
    "0": "the server did not answer",
  };
  return {
    name: "Device",
    ok: false,
    value: why[String(answer.status)] ?? `the server answered ${answer.status}`,
  };
}

function soundRow(audio: CheckInput["audio"]): Row {
  if (audio.withoutTap) {
    return { name: "Sound", ok: true, value: "plays without a tap (the autoplay flag is on)" };
  }
  if (audio.now) {
    return {
      name: "Sound",
      ok: false,
      value:
        "unlocked by the tap for this page only: add the autoplay flag, or sound stops after a reload",
    };
  }
  return {
    name: "Sound",
    ok: false,
    value: "blocked until a tap: add --autoplay-policy=no-user-gesture-required",
  };
}

function offlineRow(offline: CheckInput["offline"]): Row {
  if (!offline.available) {
    return { name: "Offline", ok: false, value: "unavailable: the screen needs https://" };
  }
  return offline.active
    ? { name: "Offline", ok: true, value: "the last screen is kept for a boot without the uplink" }
    : { name: "Offline", ok: false, value: "starts once /screen/ has loaded here" };
}

export function checkRows(input: CheckInput): Row[] {
  return [
    viewportRow(input.viewport),
    clockRow(input.offsetMs),
    deviceRow(input.device),
    soundRow(input.audio),
    offlineRow(input.offline),
    { name: "Player", ok: true, value: `version ${input.bundle}` },
  ];
}

/** The server's clock against this one, from the state's `time` or else the `Date` header. */
export async function measure(
  fetchFn: Fetch,
  now: () => number,
): Promise<{ answer: Answer; offsetMs: number | null }> {
  const sent = now();
  const answer = await call(fetchFn, "GET", STATE_PATH);
  const mid = (sent + now()) / 2;
  const stateMs = isState(answer.body) ? Date.parse(answer.body.time) : NaN;
  const serverMs = Number.isNaN(stateMs) ? (answer.serverMs ?? NaN) : stateMs;
  return { answer, offsetMs: Number.isNaN(serverMs) ? null : Math.round(serverMs - mid) };
}

export interface CheckEnv {
  fetch: Fetch;
  root: HTMLElement;
  bundle: string;
  viewport: () => CheckInput["viewport"];
  offline: () => CheckInput["offline"];
  now?: () => number;
}

export class CheckPage {
  /** Read before anything on the page could have been tapped. */
  private readonly withoutTap = audioSettled();
  private readonly list = el("ul", "canccu-selfcheck");
  /** The latest check started; a tap's check may overlap the timed one, and the later wins. */
  private latest = 0;

  constructor(private readonly env: CheckEnv) {}

  async start(): Promise<void> {
    const page = el("main", "canccu-frame canccu-frame--check");
    page.dataset.frame = "check";
    const head = frameHead({ where: "Kiosk check" });
    const body = el("section", "canccu-frame__body");
    const button = el("button", "canccu-selfcheck__unlock", "Tap to test the sound");
    button.type = "button";
    button.addEventListener("click", () => {
      void unlockAudio().then(() => {
        beep();
        return this.run();
      });
    });
    body.append(el("h1", "canccu-frame__title", "Kiosk check"), this.list, button);
    const foot = el(
      "footer",
      "canccu-frame__foot",
      "Checks again every 5 s · the kiosk guide: docs/screen-kiosk.md",
    );
    page.append(head, body, foot);
    this.env.root.replaceChildren(page);
    await this.again();
  }

  /** Each check starts once the last has ended: on a slow uplink an older answer never lands last. */
  private async again(): Promise<void> {
    await this.run().catch(() => undefined);
    setTimeout(() => void this.again(), RECHECK_MS);
  }

  private async run(): Promise<void> {
    const mine = ++this.latest;
    setClock(this.env.root, (this.env.now ?? Date.now)());
    const { answer, offsetMs } = await measure(this.env.fetch, this.env.now ?? Date.now);
    const withoutTap = await this.withoutTap;
    if (mine !== this.latest) return;
    const rows = checkRows({
      viewport: this.env.viewport(),
      offsetMs,
      device: answer,
      audio: { withoutTap, now: audioUnlocked() },
      offline: this.env.offline(),
      bundle: this.env.bundle,
    });
    this.list.replaceChildren(
      ...rows.map((r) => {
        const row = el(
          "li",
          `canccu-selfcheck__row canccu-selfcheck__row--${r.ok ? "ok" : "warn"}`,
        );
        row.append(
          el("span", "canccu-selfcheck__mark", r.ok ? "✓" : "!"),
          el("span", "canccu-selfcheck__name", r.name),
          el("span", "canccu-selfcheck__value", r.value),
        );
        return row;
      }),
    );
  }
}
