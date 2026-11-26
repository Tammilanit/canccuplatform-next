/**
 * The brand kit's markup (#552): the colours a brand cannot do without are required, the colour
 * details stay under a publish check that fails, and with nothing published the pages name the
 * look screens really show. Drawn from a draft as the page would, no database needed.
 */
import { describe, expect, it } from "vitest";
import type { Problem } from "../src/checks.js";
import { historyView } from "../src/studio-history.js";
import { depthFrame, discardView, previewColumn } from "../src/studio-column.js";
import { yoursView } from "../src/studio-yours.js";
import { status } from "../src/studio-views.js";
import type { StudioState } from "../src/studio-views.js";

function stateOf(problems: Problem[], current = 1, drafted = true): StudioState {
  return {
    draft: drafted
      ? {
          draft_version: 3,
          created_from: current,
          manifest: {
            schema_version: 1,
            name: "T",
            mode: "simple",
            brand: { primary: "#3ddcff", accent: "#b98cff", scheme: "dark" },
            tokens: {},
          },
          problems,
          files: [],
          updated_at: new Date(0),
          updated_by: null,
        }
      : undefined,
    problems,
    current,
    cssChanged: false,
    logoUrl: undefined,
    screenTheme: undefined,
  };
}

const yours = (s: StudioState): string => {
  const f = depthFrame(s, undefined);
  const view =
    s.draft === undefined ? "" : String(yoursView(s, s.draft, { advice: undefined, palette: [] }));
  return `${String(f.actions)}${String(f.extra)}${view}${String(previewColumn(s))}${String(discardView(s))}`;
};
const body = yours;
const input = (html: string, name: string): string =>
  new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";

describe("the brand kit's markup", () => {
  it("requires Primary and Accent, never the Discord colour", () => {
    const html = body(stateOf([]));
    expect(input(html, "primary")).toMatch(/\srequired[\s>]/);
    expect(input(html, "accent")).toMatch(/\srequired[\s>]/);
    expect(input(html, "embed_color")).not.toContain("required");
  });

  it("keeps the colour details under the errors of a draft that cannot publish", () => {
    const html = body(
      stateOf([{ severity: "error", code: "schema", path: "theme.yaml#/name", message: "Bad." }]),
    );
    expect(html).toMatch(/Can&#39;t publish yet[\s\S]*Bad\.[\s\S]*class="canccu-studio-details"/);
    expect(html).toContain('data-token="primary_text"');
  });

  it("names the event profile's look while nothing is published", () => {
    const profile = /screens show the event profile(&#39;|')s look/;
    expect(String(status(stateOf([], 0, false), undefined))).toMatch(profile);
    expect(String(historyView({ current_revision: 0, revisions: [] }, 20, undefined))).toMatch(
      profile,
    );
    expect(body(stateOf([], 0))).toMatch(/keeps the event profile(&#39;|')s look/);
    for (const html of [body(stateOf([], 0)), String(status(stateOf([], 0, false), undefined))]) {
      expect(html).not.toContain("default look");
    }
  });
});
