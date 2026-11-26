/**
 * Advanced's editor and box looks (plan issue-784 D15, D16): a new look's name fits the schema's
 * 32 characters whatever the box type's length, so its upload and its PATCH agree, and the editor
 * keeps a file's leading empty line.
 */
import type { SqlClient } from "@canccu/kit";
import { describe, expect, it } from "vitest";
import type { DraftRow } from "../src/drafts.js";
import type { FileStore } from "../src/files.js";
import { partsEditError } from "../src/schema.js";
import { editingOf, editorView } from "../src/studio-widgets.js";

/** 37 characters: a box type as long as the screen contract may name one (up to 40). */
const LONG = "tournament_bracket_standings_overview";

function draftWith(templates: Record<string, unknown> = {}): DraftRow {
  return {
    draft_version: 3,
    created_from: null,
    manifest: {
      name: "Long",
      platform: ">=0.1",
      mode: "advanced",
      templates,
      layouts: [
        {
          id: "main",
          name: "Main",
          aspect: "16:9",
          grid: { columns: 1, rows: 1 },
          regions: [
            {
              id: "a",
              area: { column: 1, row: 1, columns: 1, rows: 1 },
              widgets: [{ widget: LONG }],
            },
          ],
        },
      ],
    },
    problems: [],
    files: [],
    updated_at: new Date(0),
    updated_by: null,
  };
}

const NO_DB = {} as SqlClient;
const NO_FILES = {} as FileStore;

describe("a new box look", () => {
  it("gets a name within the schema's 32 characters for a long box type", async () => {
    const e = await editingOf(NO_DB, NO_FILES, draftWith(), { new: LONG });
    expect(e.name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
    const body = {
      draft_version: 3,
      templates: { [e.name ?? ""]: { widget: LONG, file: e.path } },
    };
    expect(partsEditError(body)).toBeUndefined();
  });

  it("gets another name that fits when the first is taken", async () => {
    const first = await editingOf(NO_DB, NO_FILES, draftWith(), { new: LONG });
    const taken = { [first.name ?? ""]: { widget: LONG, file: first.path } };
    const second = await editingOf(NO_DB, NO_FILES, draftWith(taken), { new: LONG });
    expect(second.name).not.toBe(first.name);
    expect(second.name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  });
});

describe("the editor", () => {
  it("keeps a file's leading empty line", () => {
    const page = editorView(draftWith(), {
      path: "css/theme.css",
      text: "\n.t-x { color: red; }\n",
      listed: false,
    }).toString();
    // The HTML parser drops one newline right after <textarea>, so the page puts one there.
    expect(page).toMatch(/<textarea[^>]*>\n\n\.t-x \{ color: red; \}\n<\/textarea>/);
  });
});
