/**
 * The checks every draft change re-runs on the whole result (plan D3), so `problems` always
 * describe the stored draft. This slice checks the schema, layouts and contrast; the file, CSS,
 * template and package checks join as their slices land (docs/plans/issue-185.md).
 */
import { contrastFailures } from "./contrast.js";
import { schemaErrors } from "./schema.js";
import { fillTokens } from "./tokens.js";
import type { PartialTokens } from "./tokens.js";

export interface Problem {
  severity: "error" | "warning";
  code: string;
  path?: string;
  message: string;
}

/** The manifest as stored: theme.schema.json's shape, though a draft may break it. */
export type Manifest = Record<string, unknown>;

/** The widget types modules offer: theming's own and the screen's (contracts/screen.md, Widgets). */
const WIDGETS = new Set([
  "logo",
  "embed",
  "clock",
  "agenda_now",
  "countdown",
  "hot_game",
  "now_playing",
  "bracket",
  "leaderboard",
  "photo",
  "announcement",
  "ticker",
  "food_status",
  "qr",
  "checkin_qr",
  "venue_info",
  "playlist",
  "stats",
  "match_called",
  "winner_card",
  "sting",
]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

const error = (code: string, path: string, message: string): Problem => ({
  severity: "error",
  code,
  path,
  message,
});

function widgetProblems(m: Manifest, w: Record<string, unknown>, at: string): Problem[] {
  const type = String(w.widget);
  const templates = isObject(m.templates) ? m.templates : {};
  const embeds = isObject(m.embeds) ? m.embeds : {};
  const images = isObject(m.images) ? m.images : {};
  const out: Problem[] = [];
  if (typeof w.template === "string") {
    const template = templates[w.template];
    if (!isObject(template)) {
      out.push(error("reference_unknown", at, `No template ${w.template}.`));
    } else if (template.widget !== type) {
      out.push(error("reference_unknown", at, `Template ${w.template} is not made for ${type}.`));
    }
  }
  if (type === "embed" && typeof w.embed === "string" && !isObject(embeds[w.embed])) {
    out.push(error("reference_unknown", at, `No embed ${w.embed}.`));
  }
  if (type === "logo" && typeof images.logo !== "string") {
    out.push(error("reference_unknown", at, "The logo widget needs images.logo."));
  }
  if (!WIDGETS.has(type)) {
    // A widget a later module offers: the theme survives it, the region shows nothing.
    out.push({
      severity: "warning",
      code: "widget_unknown",
      path: at,
      message: `No module offers the widget ${type}; its region shows nothing.`,
    });
  }
  return out;
}

function layoutProblems(m: Manifest): Problem[] {
  const out: Problem[] = [];
  const layoutIds = new Set<unknown>();
  list(m.layouts).forEach((layout, li) => {
    if (!isObject(layout)) return;
    const at = `theme.yaml#/layouts/${li}`;
    if (layoutIds.has(layout.id))
      out.push(error("duplicate_id", at, `Layout id ${String(layout.id)} is used twice.`));
    layoutIds.add(layout.id);
    const grid = isObject(layout.grid) ? layout.grid : {};
    const regionIds = new Set<unknown>();
    list(layout.regions).forEach((region, ri) => {
      if (!isObject(region)) return;
      const rat = `${at}/regions/${ri}`;
      const area = isObject(region.area) ? region.area : {};
      const right = num(area.column) + num(area.columns) - 1;
      const bottom = num(area.row) + num(area.rows) - 1;
      if (right > num(grid.columns) || bottom > num(grid.rows)) {
        out.push(
          error("area_outside_grid", rat, `Region ${String(region.id)} does not fit the grid.`),
        );
      }
      if (regionIds.has(region.id))
        out.push(
          error(
            "duplicate_id",
            rat,
            `Region id ${String(region.id)} is used twice in this layout.`,
          ),
        );
      regionIds.add(region.id);
      list(region.widgets).forEach((w, wi) => {
        if (isObject(w)) out.push(...widgetProblems(m, w, `${rat}/widgets/${wi}`));
      });
    });
  });
  return out;
}

/** Warnings, never blocking: admin pages then fall back to the platform colours (What applies where). */
function contrastProblems(m: Manifest): Problem[] {
  const tokens = isObject(m.tokens) ? (m.tokens as PartialTokens) : {};
  return contrastFailures(fillTokens(tokens).colors).map((pair) => ({
    severity: "warning",
    code: "contrast_low",
    path: "theme.yaml#/tokens/colors",
    message: `${pair} is below the contrast rules; admin and sign-in pages use the platform colours.`,
  }));
}

export function checkManifest(m: Manifest): Problem[] {
  return [
    ...schemaErrors(m).map((e) => error("schema", e.path, e.message)),
    ...layoutProblems(m),
    ...contrastProblems(m),
  ];
}

export const hasError = (problems: readonly Problem[]): boolean =>
  problems.some((p) => p.severity === "error");
