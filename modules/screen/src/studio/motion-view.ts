/**
 * The Motion card (design guideline sheet 11; contracts/screen.md, Motion and burn-in drift) on
 * Zones and layouts: the event's level and Follow the day, a pin per zone, the theme's spotlight,
 * speed and pack read-only with the way to Theme studio, and each zone's level now and next.
 * Its strings live here; messages.ts adds them to the catalogue.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { MotionRead } from "../motion-routes.js";
import type { MessageKey } from "./messages.js";
import { clockTime } from "./views.js";
import type { ViewContext } from "./views.js";
import { select } from "./widget-settings.js";

export const MOTION_EN = {
  "motion.title": "Motion",
  "motion.desc":
    "How much the screens move. People who ask their device for less motion always get None.",
  "motion.event_level": "Event level",
  "motion.level.none": "None",
  "motion.level.calm": "Calm",
  "motion.level.lively": "Lively",
  "motion.level.party": "Party",
  "motion.follow": "Follow the day",
  "motion.follow_hint":
    "One step calmer at doors, wind-down and quiet hours; one step livelier at the peak.",
  "motion.zones": "Zones",
  "motion.same": "Same as the event",
  "motion.always": "Always {level}",
  "motion.spotlight": "Spotlight effect",
  "motion.spotlight.glow_and_trace": "Glow and tracing border",
  "motion.spotlight.glow": "Glow",
  "motion.spotlight.trace": "Tracing border",
  "motion.speed": "Speed",
  "motion.speed.slower": "Slower",
  "motion.speed.normal": "Normal",
  "motion.speed.faster": "Faster",
  "motion.pack": "Motion pack",
  "motion.pack.standard": "Standard",
  "motion.pack.broadcast": "Broadcast",
  "motion.pack.arcade": "Arcade",
  "motion.theme_hint":
    "The same screens with a different personality. Set by the theme in Theme studio.",
  "motion.theme_link": "Change them in Theme studio",
  "motion.theme_cap_calm": "The theme keeps every zone at Calm or below.",
  "motion.theme_cap_none": "The theme keeps every screen still.",
  "motion.phase.quiet_hours": "quiet hours",
  "motion.phase.wind_down": "wind-down",
  "motion.phase.doors": "doors",
  "motion.phase.peak": "peak",
  "motion.phase.build_up": "build-up",
  "motion.now": "Right now: {zone} is {level} ({phase}).",
  "motion.now_next": "Right now: {zone} is {level} ({phase}). It goes to {next} at {time}.",
  "motion.save": "Save motion",
  "motion.saved": "Motion saved.",
  "motion.nothing": "Nothing changed.",
} as const;

export const MOTION_CLIENT_KEYS = ["motion.saved", "motion.nothing"] as const;

const LEVELS = ["none", "calm", "lively", "party"] as const;
const ZONES_WRITE = "screen.zones.write";

const levelName = (c: ViewContext, level: string): string =>
  c.t(`motion.level.${level}` as MessageKey);

/** The event level as segmented choices: radios under their chips, for the keyboard and the form. */
function levelChoices(c: ViewContext, level: string, disabled: boolean): Html {
  const chips = LEVELS.map(
    (l) =>
      html`<label class="canccu-studio-motion-chip"
        ><input${attrs({ type: "radio", name: "motion_level", value: l, checked: l === level, disabled })} /><span
          >${levelName(c, l)}</span
        ></label
      >`,
  );
  return html`<div class="canccu-field">
    <span class="canccu-field__label" id="canccu-studio-motion-level"
      >${c.t("motion.event_level")}</span
    >
    <div
      class="canccu-studio-motion-levels"
      role="radiogroup"
      aria-labelledby="canccu-studio-motion-level"
    >
      ${chips}
    </div>
  </div>`;
}

/** One line per zone: its level and phase now, and when the level next changes. */
function nowLines(c: ViewContext, read: MotionRead): Html {
  const lines = read.answer.zones.map((z) => {
    const values = {
      zone: z.name,
      level: levelName(c, z.level),
      phase: c.t(`motion.phase.${z.phase}` as MessageKey),
    };
    const text =
      z.next === null
        ? c.t("motion.now", values)
        : c.t("motion.now_next", {
            ...values,
            next: levelName(c, z.next.level),
            time: clockTime(z.next.at, c.timeZone),
          });
    return html`<li>${text}</li>`;
  });
  return html`<ul class="canccu-studio-motion-now">
    ${lines}
  </ul>`;
}

export function motionCard(c: ViewContext, read: MotionRead): Html {
  const { t } = c;
  const { answer, style } = read;
  const writer = c.rights.has(ZONES_WRITE);
  const pins = answer.zones.map((z) => {
    const id = `canccu-studio-motion-pin-${z.key}`;
    const options: [string, string][] = [
      ["", t("motion.same")],
      ...LEVELS.map((l): [string, string] => [l, t("motion.always", { level: levelName(c, l) })]),
    ];
    return html`<div class="canccu-studio-motion-pin">
      <label for="${id}">${z.name}</label
      >${select(id, `pin.${z.key}`, z.motion_level ?? "", options)}
    </div>`;
  });
  const cap =
    answer.theme_motion === "moderate"
      ? ""
      : html`<p class="canccu-field__hint">${t(`motion.theme_cap_${answer.theme_motion}`)}</p>`;
  const theme = (key: "spotlight" | "speed" | "pack") =>
    html`<div class="canccu-field">
      <span class="canccu-field__label">${t(`motion.${key}`)}</span>
      <span class="canccu-studio-motion-value"
        >${t(`motion.${key}.${style[key]}` as MessageKey)}</span
      >
    </div>`;
  return html`<section class="canccu-card canccu-studio-motion">
    <div class="canccu-card__head">
      <div>
        <h2 class="canccu-card__title">${t("motion.title")}</h2>
        <p class="canccu-card__desc">${t("motion.desc")}</p>
      </div>
    </div>
    <form
      class="canccu-card__body canccu-form"
      data-motion
      ${attrs({ "data-version": String(answer.settings_version), "data-pins": JSON.stringify(Object.fromEntries(answer.zones.map((z) => [z.key, z.motion_level]))) })}
    >
      <fieldset class="canccu-studio-motion-set" ${attrs({ disabled: !writer })}>
        ${levelChoices(c, answer.motion_level, !writer)}
        <label class="canccu-studio-motion-follow"
          ><input${attrs({ class: "canccu-check", type: "checkbox", name: "follow_the_day", checked: answer.follow_the_day })} /><span
            >${t("motion.follow")}</span
          ></label
        >
        <p class="canccu-field__hint">${t("motion.follow_hint")}</p>
        <div class="canccu-field">
          <span class="canccu-field__label">${t("motion.zones")}</span>
          <div class="canccu-studio-motion-pins">${pins}</div>
        </div>
      </fieldset>
      <div class="canccu-form__row">${theme("spotlight")}${theme("speed")}</div>
      ${theme("pack")}
      <p class="canccu-field__hint">
        ${t("motion.theme_hint")} <a href="/theming/studio/advanced">${t("motion.theme_link")}</a>
      </p>
      ${cap}${nowLines(c, read)}
      ${writer ? html`<button class="canccu-button canccu-button--primary" type="submit">${t("motion.save")}</button>` : ""}
    </form>
  </section>`;
}
