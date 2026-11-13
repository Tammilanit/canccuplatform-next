/**
 * The `Zone` body of `POST` and `PUT /api/screen/zones…`, checked against the contract's `Zone`
 * and `RegionSettings` (contracts/screen.openapi.yaml) and the theme schema's widget entry
 * (contracts/theme.schema.json, `widget`), so the composed state never meets a shape it cannot draw.
 * Unknown fields are refused rather than stored: a typo in Studio would otherwise save silently.
 */
import { invalidRequest } from "./http.js";

export const ZONE_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/** A zone key named in a body (`where` is the field), or 400. */
export function zoneKey(value: unknown, where: string): string {
  if (typeof value !== "string" || !ZONE_KEY_RE.test(value)) {
    throw invalidRequest(`\`${where}\` must be a zone key.`);
  }
  return value;
}
/** The theme schema's `name`: layout, region, template and embed ids, props keys. */
export const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const WIDGET_RE = /^[a-z][a-z0-9_]{0,39}$/;
const ROLES = ["full", "hero", "rail", "venue_rail", "ticker", "header", "backdrop", "overlay"];
const ROTATIONS = ["sequence", "shuffle"];
const IDLES = ["logo", "blank", "collapse", "next"];
const HEADERS = ["separate", "shared"];
const HUB_QRS = ["always", "rotate"];
const MAX_REGIONS = 32;
const MAX_WIDGETS = 12;
const MAX_PROPS = 32;

export interface ZoneSound {
  enabled: boolean;
  device_id: string | null;
}

export interface ZoneInput {
  key: string;
  name: string;
  layout_id: string | null;
  regions: Record<string, Record<string, unknown>>;
  /** Null: the layout's `header`, else `separate` (src/compose/parts.ts). */
  header: "separate" | "shared" | null;
  hub_qr: "always" | "rotate";
  /** Null: no trade (src/compose/showcase.ts). */
  hero_region: string | null;
  grow_for_showcase: boolean;
  sound: ZoneSound;
  /** Required on PUT; ignored on POST, where it is read-only. */
  revision?: number;
}

type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function onlyKeys(value: Json, allowed: string[], where: string): void {
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw invalidRequest(`${where}: unknown field \`${extra[0]}\`.`);
}

export function oneOf(value: unknown, allowed: string[], where: string): void {
  if (value !== undefined && !allowed.includes(value as string)) {
    throw invalidRequest(`${where} must be one of ${allowed.join(", ")}.`);
  }
}

function widgetEntry(value: unknown, where: string): Json {
  if (!isObject(value)) throw invalidRequest(`${where} must be an object.`);
  onlyKeys(value, ["widget", "template", "embed", "props"], where);
  if (typeof value.widget !== "string" || !WIDGET_RE.test(value.widget)) {
    throw invalidRequest(`${where}.widget must be a widget type such as \`clock\`.`);
  }
  for (const field of ["template", "embed"] as const) {
    const named = value[field];
    if (named !== undefined && (typeof named !== "string" || !NAME_RE.test(named))) {
      throw invalidRequest(`${where}.${field} must be a theme name.`);
    }
  }
  if ((value.widget === "embed") !== (value.embed !== undefined)) {
    throw invalidRequest(`${where}: \`embed\` is required for the embed widget and only there.`);
  }
  if (value.props !== undefined) {
    const props = value.props;
    if (!isObject(props) || Object.keys(props).length > MAX_PROPS) {
      throw invalidRequest(`${where}.props must be an object of at most ${MAX_PROPS} fields.`);
    }
    for (const [k, v] of Object.entries(props)) {
      const scalar =
        (typeof v === "string" && v.length <= 200) ||
        (typeof v === "number" && Number.isFinite(v)) ||
        typeof v === "boolean";
      if (!NAME_RE.test(k) || !scalar) {
        throw invalidRequest(`${where}.props.${k} must be a string, number or boolean.`);
      }
    }
  }
  return value;
}

function regionSettings(value: unknown, where: string): Json {
  if (!isObject(value)) throw invalidRequest(`${where} must be an object.`);
  onlyKeys(value, ["role", "widgets", "rotation", "dwell_seconds", "skip_empty", "idle"], where);
  oneOf(value.role, ROLES, `${where}.role`);
  oneOf(value.rotation, ROTATIONS, `${where}.rotation`);
  oneOf(value.idle, IDLES, `${where}.idle`);
  const dwell = value.dwell_seconds;
  if (
    dwell !== undefined &&
    (!Number.isInteger(dwell) || (dwell as number) < 5 || (dwell as number) > 3600)
  ) {
    throw invalidRequest(`${where}.dwell_seconds must be a whole number from 5 to 3600.`);
  }
  if (value.skip_empty !== undefined && typeof value.skip_empty !== "boolean") {
    throw invalidRequest(`${where}.skip_empty must be true or false.`);
  }
  if (value.widgets !== undefined) {
    if (!Array.isArray(value.widgets) || value.widgets.length > MAX_WIDGETS) {
      throw invalidRequest(`${where}.widgets must be a list of at most ${MAX_WIDGETS}.`);
    }
    value.widgets.forEach((w: unknown, i) => widgetEntry(w, `${where}.widgets[${i}]`));
  }
  return value;
}

/** The checked zone, or 400 `invalid_request` naming the first problem. */
export function zoneInput(value: unknown): ZoneInput {
  if (!isObject(value)) throw invalidRequest("The body must be a JSON object.");
  onlyKeys(
    value,
    [
      "key",
      "name",
      "layout_id",
      "regions",
      "header",
      "hub_qr",
      "hero_region",
      "grow_for_showcase",
      "sound",
      "revision",
    ],
    "zone",
  );
  const { key, name } = value;
  if (typeof key !== "string" || !ZONE_KEY_RE.test(key)) {
    throw invalidRequest(
      "`key` must be 2 to 32 lowercase letters, digits, `-` or `_`, starting with a letter or digit.",
    );
  }
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 80) {
    throw invalidRequest("`name` must be 1 to 80 characters.");
  }
  const layout = value.layout_id ?? null;
  if (layout !== null && (typeof layout !== "string" || !NAME_RE.test(layout))) {
    throw invalidRequest("`layout_id` must be a layout id such as `pulse`, or null.");
  }
  const regions = value.regions ?? {};
  if (!isObject(regions) || Object.keys(regions).length > MAX_REGIONS) {
    throw invalidRequest(`\`regions\` must be an object of at most ${MAX_REGIONS} regions.`);
  }
  for (const [id, settings] of Object.entries(regions)) {
    // A theme's region id starts with a letter; `_full` and `_overlay` are the composed state's own.
    if (!NAME_RE.test(id)) throw invalidRequest(`\`regions.${id}\` is not a region id.`);
    regionSettings(settings, `regions.${id}`);
  }
  const header = value.header ?? null;
  if (header !== null) oneOf(header, HEADERS, "`header`");
  // Unlike `header`, `hub_qr` has no null: the contract gives it a plain default.
  const hubQr = value.hub_qr === undefined ? "always" : value.hub_qr;
  oneOf(hubQr, HUB_QRS, "`hub_qr`");
  // Any region id is kept, also one the layout lacks: the zone survives a layout change.
  const heroRegion = value.hero_region ?? null;
  if (heroRegion !== null && (typeof heroRegion !== "string" || !NAME_RE.test(heroRegion))) {
    throw invalidRequest("`hero_region` must be a region id such as `online`, or null.");
  }
  // Like `hub_qr`, no null: the contract gives it a plain default.
  const grow = value.grow_for_showcase === undefined ? true : value.grow_for_showcase;
  if (typeof grow !== "boolean") throw invalidRequest("`grow_for_showcase` must be true or false.");
  const sound = value.sound ?? {};
  if (!isObject(sound)) throw invalidRequest("`sound` must be an object.");
  onlyKeys(sound, ["enabled", "device_id"], "sound");
  const enabled = sound.enabled ?? true;
  const deviceId = sound.device_id ?? null;
  if (typeof enabled !== "boolean") throw invalidRequest("`sound.enabled` must be true or false.");
  if (deviceId !== null && typeof deviceId !== "string") {
    throw invalidRequest("`sound.device_id` must be a device id or null.");
  }
  const revision = value.revision;
  if (revision !== undefined && (!Number.isInteger(revision) || (revision as number) < 1)) {
    throw invalidRequest("`revision` must be the whole number read with the zone.");
  }
  return {
    key,
    name: name.trim(),
    layout_id: layout,
    regions: regions as Record<string, Json>,
    header: header as ZoneInput["header"],
    hub_qr: hubQr as ZoneInput["hub_qr"],
    hero_region: heroRegion,
    grow_for_showcase: grow,
    sound: { enabled, device_id: deviceId },
    ...(revision === undefined ? {} : { revision: revision as number }),
  };
}
