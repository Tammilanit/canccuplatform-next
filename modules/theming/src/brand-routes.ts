/**
 * The brand kit's draft paths (contracts/theming.md, Brand kit: simple mode, and Advanced mode's
 * Back to simple): `PUT …/draft/brand` and `POST …/draft/mode`, both through the one write path.
 */
import type { FastifyInstance } from "fastify";
import { KitError, requireTenant } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import type { Audit } from "./audit.js";
import { generateColors } from "./brand.js";
import { nextBrand } from "./brand-edit.js";
import type { Brand } from "./brand.js";
import { isObject } from "./checks.js";
import type { Manifest } from "./checks.js";
import type { DraftDeps } from "./draft-routes.js";
import { draftBody, editDraft, loadDraft } from "./drafts.js";
import { FONT_PAIRS } from "./font-pairs.js";
import { WRITE, actorOf, assertWritable, invalidRequest, needs, versionConflict } from "./http.js";
import { draftEmbedNames, removeDraftFolders } from "./package-files.js";
import { brandInputError, modeSwitchError } from "./schema.js";
import type { BrandEdit } from "./schema.js";
import { writingFiles } from "./stored.js";
import type { Unused } from "./stored.js";

export interface BrandDeps extends DraftDeps {
  audit: Audit;
}

const EMBEDS = "theming.embeds.write";

/** The folders of advanced files, which the switch back to simple removes with the embeds. */
const ADVANCED_FOLDERS = ["css", "fonts", "templates"] as const;
const ADVANCED_PARTS = new Set(["css", "fonts", "templates", "embeds"]);

const brandMissing = (): KitError =>
  new KitError("The draft has no brand to generate the colours from. Set one first.", {
    status: 409,
    code: "brand_missing",
  });

function brandOf(manifest: Manifest): Brand | undefined {
  const b = manifest.brand;
  if (!isObject(b) || typeof b.primary !== "string" || typeof b.accent !== "string") return;
  if (b.scheme !== "dark" && b.scheme !== "light") return;
  return b as unknown as Brand;
}

/** Whether `path` holds a stored image of the draft, not a missing path or a failed upload. */
async function isDraftImage(c: SqlClient, path: string): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM theming_package_files WHERE owner = 'draft' AND path = $1 AND file IS NOT NULL`,
    [path],
  );
  return rows.length > 0;
}

/** The colours generated from `brand`, with the theme's other tokens kept. */
function withColors(manifest: Manifest, brand: Brand): Manifest {
  const tokens = isObject(manifest.tokens) ? manifest.tokens : {};
  return { ...manifest, tokens: { ...tokens, colors: generateColors(brand).colors } };
}

/**
 * Without the templates every widget falls back to its default one (the simple mode keeps the
 * default templates), and an embed widget has no embed left to show, so it goes.
 */
function simpleLayouts(layouts: unknown): unknown {
  if (!Array.isArray(layouts)) return layouts;
  return (layouts as unknown[]).map((layout) => {
    if (!isObject(layout) || !Array.isArray(layout.regions)) return layout;
    const regions = (layout.regions as unknown[]).map((region) => {
      if (!isObject(region) || !Array.isArray(region.widgets)) return region;
      const widgets = (region.widgets as unknown[])
        .filter((w) => !(isObject(w) && w.widget === "embed"))
        .map((w) =>
          isObject(w) ? Object.fromEntries(Object.entries(w).filter(([k]) => k !== "template")) : w,
        );
      return { ...region, widgets };
    });
    return { ...layout, regions };
  });
}

/**
 * The simple-mode manifest: no CSS, fonts, templates or embeds, no font or size tokens, the
 * colours generated from `brand`; images, layouts, `motion` and `motion_style` kept.
 */
function simpleManifest(manifest: Manifest, brand: Brand): Manifest {
  const out: Manifest = Object.fromEntries(
    Object.entries(manifest).filter(([k]) => !ADVANCED_PARTS.has(k)),
  );
  out.mode = "simple";
  if (out.layouts !== undefined) out.layouts = simpleLayouts(out.layouts);
  const tokens = isObject(manifest.tokens) ? manifest.tokens : {};
  out.tokens = Object.fromEntries(
    (["motion", "motion_style"] as const)
      .filter((k) => tokens[k] !== undefined)
      .map((k) => [k, tokens[k]]),
  );
  return withColors(out, brand);
}

/**
 * A pair or corners the organiser picks now must show: a preset's own font and radius tokens sit
 * over the brand's choices (tokens.ts), so they go when a different choice is made (the mirror of
 * draft-routes.ts, where a token edit takes the choice away).
 */
function withoutOverriddenChoices(
  manifest: Manifest,
  before: Record<string, unknown>,
  input: BrandEdit,
): Manifest {
  if (!isObject(manifest.tokens)) return manifest;
  const tokens = { ...manifest.tokens };
  const without = (group: unknown, keys: string[]): Record<string, unknown> | undefined => {
    if (!isObject(group)) return undefined;
    const rest = Object.fromEntries(Object.entries(group).filter(([k]) => !keys.includes(k)));
    return Object.keys(rest).length > 0 ? rest : undefined;
  };
  const pair = typeof input.font_pair === "string" && input.font_pair !== before.font_pair;
  if (pair) {
    const fonts = without(tokens.fonts, ["heading", "display", "body"]);
    if (fonts === undefined) delete tokens.fonts;
    else tokens.fonts = fonts;
  }
  const corners = input.roundness !== undefined && input.roundness !== before.roundness;
  if (corners) {
    const sizes = without(tokens.sizes, ["radius"]);
    if (sizes === undefined) delete tokens.sizes;
    else tokens.sizes = sizes;
  }
  return { ...manifest, tokens };
}

export function brandRoutes(app: FastifyInstance, deps: BrandDeps): void {
  const writer = { preHandler: needs(deps.rights, WRITE) };

  app.put("/api/theming/draft/brand", writer, async (request) => {
    assertWritable(request);
    const why = brandInputError(request.body);
    if (why !== undefined) throw invalidRequest(why);
    const input = request.body as BrandEdit;
    // The Studio offers only the platform's pairs; a manifest from elsewhere may name a newer one
    // and only gets a warning (checks.ts), but this editor never stores a pair it cannot draw.
    if (typeof input.font_pair === "string" && !FONT_PAIRS.has(input.font_pair)) {
      throw invalidRequest("font_pair must be one of GET /api/theming/font-pairs.");
    }
    const { primary, accent, scheme } = input;
    const { adjusted } = generateColors({ primary, accent, scheme });
    const row = await deps.db.tenant((c) =>
      editDraft(c, deps.files, input.draft_version, actorOf(request), async (m) => {
        const brand = nextBrand(isObject(m.brand) ? m.brand : undefined, input);
        const picture = {
          logo: input.logo,
          icon: input.icon,
          "backdrop.image": input.backdrop?.image,
          "backdrop.video": input.backdrop?.video,
        };
        for (const [role, path] of Object.entries(picture)) {
          if (path !== undefined && !(await isDraftImage(c, path))) {
            throw invalidRequest(`${role} must name a file already in the draft.`);
          }
        }
        // The logo and icon are the theme's only ones, so the body names them on every save.
        const images = isObject(m.images) ? { ...m.images } : {};
        delete images.logo;
        delete images.icon;
        if (input.logo !== undefined) images.logo = input.logo;
        if (input.icon !== undefined) images.icon = input.icon;
        const next: Manifest = { ...m, brand };
        if (Object.keys(images).length > 0) next.images = images;
        else delete next.images;
        // A scheme's hand-set colours (presets.ts) stay until the organiser changes what the
        // colours come from; the page sends the whole brand on every change, the corners too.
        const before = isObject(m.brand) ? m.brand : {};
        const tokens = isObject(m.tokens) ? m.tokens : {};
        const same = (["primary", "accent", "scheme"] as const).every(
          (k) => before[k] === brand[k],
        );
        const colored = same && isObject(tokens.colors) ? next : withColors(next, brand);
        return withoutOverriddenChoices(colored, before, input);
      }),
    );
    return { draft: draftBody(row), adjusted };
  });

  app.post("/api/theming/draft/mode", writer, async (request) => {
    assertWritable(request);
    const why = modeSwitchError(request.body);
    if (why !== undefined) throw invalidRequest(why);
    const version = (request.body as { draft_version: number }).draft_version;
    const actor = actorOf(request);
    const embedsOf = async (c: SqlClient, m: Manifest): Promise<string[]> => {
      const named = isObject(m.embeds) ? Object.keys(m.embeds) : [];
      return [...new Set([...named, ...(await draftEmbedNames(c))])].sort();
    };
    // Removing embeds needs the embeds right as well. Checked before the lock, since the check
    // may call admin; embeds that appear only under the lock came meanwhile (409, read again).
    const hadEmbeds = await deps.db.tenant(async (c) => {
      const draft = await loadDraft(c);
      return draft !== undefined && (await embedsOf(c, draft.manifest)).length > 0;
    });
    if (hadEmbeds) await deps.rights.check(request.headers.cookie, EMBEDS);
    const result = await writingFiles(deps, async (c) => {
      let removed: string[] = [];
      let unused: Unused[] = [];
      let embeds: string[] = [];
      const row = await editDraft(c, deps.files, version, actor, async (m) => {
        const brand = brandOf(m);
        if (brand === undefined) throw brandMissing();
        embeds = await embedsOf(c, m);
        if (embeds.length > 0 && !hadEmbeds) throw versionConflict("draft");
        ({ removed, unused } = await removeDraftFolders(c, ADVANCED_FOLDERS));
        return simpleManifest(m, brand);
      });
      if (embeds.length > 0) {
        // Before the commit, as publish does: no embed goes unaudited.
        await deps.audit({
          tenant_id: requireTenant(),
          actor_user_id: actor,
          action: "theming.embeds.removed",
          target: { type: "theme_draft", id: String(row.draft_version) },
          changes: { embeds: { old: embeds, new: [] } },
        });
      }
      return { result: { draft: draftBody(row), removed }, unused };
    });
    return result;
  });
}
