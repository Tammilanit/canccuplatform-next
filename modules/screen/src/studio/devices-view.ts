/**
 * The Devices page (step 3 plan O4, E2, E3, E10; mockup 07): the fleet at a glance, each screen
 * with its live view, where it is and what it shows now, and what to do. On a wide desk (from
 * 1440 px, as Settings' last changes) a Recent panel sits beside it.
 */
import { attrs, emptyState, html, notice } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { problemsOf, shownZone, uplinkDown } from "./help.js";
import type { SeenDevice } from "./help.js";
import { counted, nameOf } from "./messages.js";
import { ago, clockTime, online, since, thumb } from "./views.js";
import type { ViewContext, ZoneSummary } from "./views.js";

type Fleet = { zones: readonly ZoneSummary[]; all: readonly SeenDevice[] };

/** "Main", "mirrors Hall left" or "no zone · paired 10 min ago", then sound and screen size. */
function placeLine(c: ViewContext, d: SeenDevice, { zones, all }: Fleet): string {
  const { t } = c;
  const zoneName = (key: string) => zones.find((z) => z.key === key)?.name ?? key;
  const m = d.mirror_of;
  const parts: string[] = [];
  if (d.zone_key !== null) {
    parts.push(t("device.zone", { zone: zoneName(d.zone_key) }));
    const sound = zones.find((z) => z.key === d.zone_key)?.sound;
    // Only the zone's named sound device plays; a mirror never does (contracts/screen.md, Zones).
    if (sound?.enabled === true && sound.device_id === d.id) parts.push(t("device.sound"));
  } else if (m === null) {
    parts.push(t("device.unassigned"));
    if (d.paired_at) parts.push(t("device.paired", { ago: since(t, d.paired_at, c.nowMs) }));
  } else {
    parts.push(
      "zone_key" in m
        ? t("device.mirrors_zone", { zone: zoneName(m.zone_key) })
        : t("device.mirrors_device", {
            device: all.find((o) => o.id === m.device_id)?.name ?? m.device_id,
          }),
      t("device.silent"),
    );
  }
  const v = d.health?.viewport;
  if (v) {
    const size = `${v.width}×${v.height}`;
    parts.push(v.height > v.width ? t("device.portrait", { size }) : size);
  }
  return parts.join(" · ");
}

function statusPart(c: ViewContext, d: SeenDevice, fleet: Fleet, uplink: boolean): Html {
  const { t } = c;
  const h = d.health;
  const on = h?.online === true;
  const dot = html`<span
    class="canccu-studio-dot canccu-studio-dot--${on ? "ok" : "down"}"
    role="img"
    aria-label="${on ? t("device.online") : t("device.offline")}"
  ></span>`;
  const flags = (h?.flags ?? []).map(
    (f) =>
      html`<span class="canccu-badge canccu-badge--degraded"
        >${f === "clock_drift" ? t("device.flag.clock_drift") : t("device.flag.shared_token")}</span
      >`,
  );
  const playing = h?.now_playing;
  const shows =
    shownZone(d, fleet.all) === null
      ? t("device.now_name")
      : playing
        ? t(on ? "device.now" : "device.last", {
            region: nameOf(t, "region", playing.region_id),
            widget: nameOf(t, "widget", playing.widget),
          })
        : "";
  const lag = h?.state_lag ?? 0;
  const seen = h?.last_seen_at ?? null;
  const state = [
    on || seen === null
      ? ago(t, seen, c.nowMs)
      : t("device.offline_for", { time: clockTime(seen, c.timeZone) }),
    lag > 0
      ? counted(t, "device.behind", lag)
      : h?.state_lag === undefined
        ? ""
        : t("device.up_to_date"),
  ].filter(Boolean);
  const problems = problemsOf(d, uplink);
  const help =
    problems.length === 0
      ? ""
      : html`<details class="canccu-studio-help" ${attrs({ open: !on })}>
          <summary>${t("help.title")}</summary>
          ${problems.map(
            (p) =>
              html`<p>
                  ${t(p.title, { device: d.name, since: seen ? clockTime(seen, c.timeZone) : "" })}
                </p>
                <ol>
                  ${p.steps.map((s) => html`<li>${t(s, { url: c.startUrl })}</li>`)}
                </ol>`,
          )}
        </details>`;
  return html`<div class="canccu-studio-device__status" ${attrs({ "data-live": `device-${d.id}` })}>
    <h2 class="canccu-studio-device__name">${dot}${d.name}</h2>
    ${flags.length > 0 ? html`<p class="canccu-cluster">${flags}</p>` : ""}
    <p class="canccu-small canccu-muted">${placeLine(c, d, fleet)}</p>
    ${shows ? html`<p class="canccu-small">${shows}</p>` : ""}
    <p class="canccu-small canccu-muted">${state.join(" · ")}</p>
    ${help}
  </div>`;
}

/** Identify, Reload and Assign; Assign opens the name and what it shows. */
function deviceActions(c: ViewContext, d: SeenDevice, { zones, all }: Fleet): Slot {
  const { t } = c;
  if (!c.rights.has("screen.devices.write")) return "";
  const api = `/api/screen/devices/${encodeURIComponent(d.id)}`;
  const command = (name: "identify" | "reload", done: string) =>
    html`<button${attrs({ class: "canccu-button canccu-button--secondary canccu-button--sm", type: "button", "data-call": "POST", "data-url": `${api}/commands`, "data-body": JSON.stringify({ command: name }), "data-done": done, "data-stay": true })}>${t(name === "identify" ? "device.identify" : "device.reload")}</button>`;
  const current =
    d.zone_key !== null
      ? `zone:${d.zone_key}`
      : d.mirror_of && "device_id" in d.mirror_of
        ? `device:${d.mirror_of.device_id}`
        : d.mirror_of
          ? `mirror-zone:${d.mirror_of.zone_key}`
          : "";
  const opt = (value: string, label: string) =>
    html`<option${attrs({ value, selected: value === current })}>${label}</option>`;
  const shows = [
    opt("", t("device.shows_none")),
    ...zones.map((z) => opt(`zone:${z.key}`, t("device.shows_zone", { zone: z.name }))),
    ...all
      .filter((o) => o.id !== d.id && o.zone_key !== null)
      .map((o) => opt(`device:${o.id}`, t("device.shows_mirror", { device: o.name }))),
    ...(current.startsWith("mirror-zone:") ? [opt(current, placeLine(c, d, { zones, all }))] : []),
  ];
  const unassigned = current === "";
  const id = `canccu-studio-${d.id}`;
  return html`<div class="canccu-studio-device__actions">${command("identify", t("device.identified"))}${command("reload", t("device.reloaded"))}<details class="canccu-studio-assign"><summary class="canccu-button canccu-button--${unassigned ? "primary" : "secondary"} canccu-button--sm">${t(unassigned ? "device.assign" : "device.edit")}</summary><form class="canccu-form"${attrs({ "data-device": d.id, "data-done": t("device.saved") })}><div class="canccu-field"><label class="canccu-field__label" for="${id}-name">${t("device.name")}</label><input${attrs({ class: "canccu-input", id: `${id}-name`, name: "name", value: d.name, required: true, maxlength: 80 })}></div><div class="canccu-field"><label class="canccu-field__label" for="${id}-shows">${t("device.shows")}</label><select class="canccu-input" id="${id}-shows" name="shows">${shows}</select></div><div class="canccu-cluster"><button class="canccu-button canccu-button--primary" type="submit">${t("device.save")}</button><button${attrs({ class: "canccu-button canccu-button--danger-ghost", type: "button", "data-call": "POST", "data-url": `${api}/revoke`, "data-confirm": t("device.revoke_confirm", { device: d.name }) })}>${t("device.revoke")}</button></div></form></details></div>`;
}

function pairDialog(c: ViewContext, zones: readonly ZoneSummary[]): Slot {
  const { t } = c;
  if (!c.rights.has("screen.devices.pair")) return "";
  const zoneOptions = [
    html`<option value="">${t("pair.no_zone")}</option>`,
    ...zones.map((z) => html`<option value="${z.key}">${z.name}</option>`),
  ];
  const field = (name: string, label: string, control: Html, hint?: string) =>
    html`<div class="canccu-field">
      <label class="canccu-field__label" for="canccu-studio-pair-${name}">${label}</label
      >${control}${hint === undefined ? "" : html`<p class="canccu-field__hint" id="canccu-studio-pair-${name}-hint">${hint}</p>`}
    </div>`;
  return html`<dialog class="canccu-studio-dialog" id="canccu-studio-pair">
    <form class="canccu-form" data-pair method="dialog">
      <h2 class="canccu-card__title">${t("pair.title")}</h2>
      ${field("code", t("pair.code"), html`<input class="canccu-input canccu-studio-code" id="canccu-studio-pair-code" name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" aria-describedby="canccu-studio-pair-code-hint" />`, t("pair.code_hint"))}
      ${field("name", t("pair.name"), html`<input class="canccu-input" id="canccu-studio-pair-name" name="name" required maxlength="80" aria-describedby="canccu-studio-pair-name-hint" />`, t("pair.name_hint"))}
      ${field(
        "zone",
        t("pair.zone"),
        html`<select class="canccu-input" id="canccu-studio-pair-zone" name="zone_key">
          ${zoneOptions}
        </select>`,
      )}
      <div class="canccu-cluster">
        <button class="canccu-button canccu-button--primary" type="submit">
          ${t("pair.submit")}</button
        ><button class="canccu-button canccu-button--ghost" type="button" data-close>
          ${t("pair.cancel")}
        </button>
      </div>
    </form>
  </dialog>`;
}

/** The page's actions at the right of its title. */
export function devicesActions(c: ViewContext): Slot {
  const { t } = c;
  if (!c.rights.has("screen.devices.pair")) return "";
  return html`<button
      class="canccu-button canccu-button--ghost"
      type="button"
      data-call="DELETE"
      data-url="/api/screen/pairing"
      ${attrs({ "data-confirm": t("devices.clear_codes_confirm"), "data-done": t("devices.cleared"), "data-stay": true })}
    >
      ${t("devices.clear_codes")}</button
    ><button class="canccu-button canccu-button--primary" type="button" data-open-pair>
      ${t("devices.pair")}
    </button>`;
}

/** "4 screens · 3 online · 1 offline · all on bundle 0.4.0". */
function summaryLine(c: ViewContext, devices: readonly SeenDevice[]): string {
  const { t } = c;
  const on = online(devices);
  const total = devices.length;
  const parts = [counted(t, "devices.summary", total, { total, online: on, offline: total - on })];
  const versions = [
    ...new Set(devices.flatMap((d) => (d.health?.bundle_version ? [d.health.bundle_version] : []))),
  ].sort();
  if (versions.length === 1) parts.push(t("devices.bundle", { version: versions[0] ?? "" }));
  if (versions.length > 1) parts.push(t("devices.bundles", { versions: versions.join(", ") }));
  return parts.join(" · ");
}

/**
 * Recent: pairings and screens going offline, from the devices' own times, newest first. The
 * audit log's lines (who assigned what) are tenants' to read, with a right of their own.
 */
function recentPanel(c: ViewContext, devices: readonly SeenDevice[]): Html {
  const { t } = c;
  const lines: [number, string, string][] = [];
  for (const d of devices) {
    if (d.paired_at)
      lines.push([Date.parse(d.paired_at), d.paired_at, t("recent.paired", { device: d.name })]);
    const seen = d.health?.last_seen_at;
    if (d.health?.online === false && seen) {
      lines.push([Date.parse(seen), seen, t("recent.offline", { device: d.name })]);
    }
  }
  const items = lines
    .sort((a, b) => b[0] - a[0])
    .slice(0, 8)
    .map(
      ([, iso, text]) =>
        html`<li>
          <span class="canccu-muted canccu-num">${clockTime(iso, c.timeZone)}</span
          ><span>${text}</span>
        </li>`,
    );
  return html`<section class="canccu-card canccu-split__side" data-live="devices-recent">
    <h2 class="canccu-card__title">${t("devices.recent")}</h2>
    <p class="canccu-card__desc">${t("devices.recent_desc")}</p>
    ${
      items.length === 0
        ? html`<p class="canccu-muted canccu-small">${t("devices.recent_none")}</p>`
        : html`<ul class="canccu-history">
            ${items}
          </ul>`
    }
  </section>`;
}

export function devicesView(
  c: ViewContext,
  zones: readonly ZoneSummary[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const uplink = uplinkDown(devices);
  const fleet = { zones, all: devices };
  const summary = html`<div data-live="devices-summary">
    <p class="canccu-muted canccu-studio-summary">${summaryLine(c, devices)}</p>
    ${uplink ? notice({ kind: "down", title: t("devices.uplink_title"), text: t("devices.uplink_text") }) : ""}
  </div>`;
  const cards = devices.map((d) => {
    const zone = shownZone(d, devices);
    const view =
      zone === null
        ? html`<div class="canccu-studio-thumb canccu-studio-thumb--none">
            <p class="canccu-studio-thumb__name">${d.name}</p>
            <p class="canccu-small canccu-muted">${t("device.not_assigned")}</p>
          </div>`
        : thumb(zone, t("device.preview", { device: d.name }));
    return html`<article class="canccu-card canccu-studio-device" id="device-${d.id}">
      ${view}${statusPart(c, d, fleet, uplink)}${deviceActions(c, d, fleet)}
    </article>`;
  });
  const list =
    devices.length === 0
      ? emptyState({
          icon: "monitor",
          title: t("devices.empty_title"),
          text: t("devices.empty_text"),
        })
      : html`<div class="canccu-studio-devices">${cards}</div>`;
  return html`${summary}
    <div class="canccu-studio-split">${list}${recentPanel(c, devices)}</div>
    ${pairDialog(c, zones)}`;
}
