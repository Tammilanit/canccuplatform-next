/**
 * The guided pairing's last step (#783): after a pair, Devices opens with `?paired=<id>` and this
 * panel follows the new screen live (its card below holds its live view, loaded with the page, so
 * the panel itself only says its state). Waiting (read every 2 s, `data-live-fast`), on (a test pattern
 * and Identify to find it), not connected after a minute, or offline, each with what to do.
 */
import { attrs, html, notice } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { notConnected } from "./help.js";
import type { SeenDevice } from "./help.js";
import type { ViewContext } from "./views.js";

export type DeviceCommand = "identify" | "reload" | "test_pattern";

const LABELS = {
  identify: ["device.identify", "device.identified"],
  reload: ["device.reload", "device.reloaded"],
  test_pattern: ["device.test_pattern", "device.test_patterned"],
} as const;

/**
 * A command's button. A command waits 60 s for its screen (contracts/screen.md, Commands), so an
 * offline screen's button says it may never show instead of claiming it did.
 */
export function commandButton(c: ViewContext, d: SeenDevice, name: DeviceCommand): Html {
  const [label, done] = LABELS[name];
  const sent =
    d.health?.online === true ? c.t(done) : c.t("device.sent_offline", { device: d.name });
  return html`<button${attrs({ class: "canccu-button canccu-button--secondary canccu-button--sm", type: "button", "data-call": "POST", "data-url": `/api/screen/devices/${encodeURIComponent(d.id)}/commands`, "data-body": JSON.stringify({ command: name }), "data-done": sent, "data-stay": true })}>${c.t(label)}</button>`;
}

function stateOf(c: ViewContext, d: SeenDevice): { notice: Html; fast: boolean } {
  const { t } = c;
  const device = d.name;
  if (d.health?.online === true) {
    return {
      notice: notice({ kind: "ok", title: t("paired.on", { device }), text: t("paired.on_help") }),
      fast: false,
    };
  }
  if ((d.health?.last_seen_at ?? null) !== null) {
    const text = t("paired.offline_help");
    return {
      notice: notice({ kind: "warn", title: t("paired.offline", { device }), text }),
      fast: false,
    };
  }
  if (notConnected(d, c.nowMs)) {
    const text = t("paired.late_help");
    return {
      notice: notice({ kind: "down", title: t("paired.late", { device }), text }),
      fast: false,
    };
  }
  const text = t("paired.waiting_help");
  return {
    notice: notice({ kind: "info", title: t("paired.waiting", { device }), text }),
    fast: true,
  };
}

/** The panel for the screen just paired, or nothing when `id` is none of this event's screens. */
export function pairedPanel(
  c: ViewContext,
  id: string | undefined,
  all: readonly SeenDevice[],
): Slot {
  const d = id === undefined ? undefined : all.find((o) => o.id === id);
  if (d === undefined) return "";
  const { notice: said, fast } = stateOf(c, d);
  const actions = c.rights.has("screen.devices.write")
    ? html`<div class="canccu-cluster">
        ${commandButton(c, d, "test_pattern")}${commandButton(c, d, "identify")}
      </div>`
    : "";
  return html`<section
    class="canccu-card canccu-studio-paired"
    ${attrs({ "data-live": `paired-${d.id}`, "aria-live": "polite" })}
  >
    <h2 class="canccu-card__title">${c.t("paired.title")}</h2>
    ${fast ? html`<span data-live-fast hidden></span>` : ""}${said}${actions}
  </section>`;
}

/** The organiser's guide to a new screen (#783; docs/operations/screen-setup.md has it in full). */
export function setupGuide(c: ViewContext): Html {
  const { t } = c;
  const kiosk =
    c.startUrl === null ? t("setup.kiosk_plain") : t("setup.kiosk", { url: c.startUrl });
  const steps = [
    kiosk,
    t("setup.autostart"),
    t("setup.sound"),
    t("setup.portrait"),
    t("setup.pair"),
  ];
  return html`<details class="canccu-card canccu-studio-setup" data-setup-guide>
    <summary class="canccu-card__title">${t("setup.title")}</summary>
    <p class="canccu-card__desc">${t("setup.desc")}</p>
    <ol>
      ${steps.map((step) => html`<li>${step}</li>`)}
    </ol>
  </details>`;
}
