import { describe, expect, it } from "vitest";
import { pageProblems } from "../src/page-check.js";
import { shellPage } from "../src/shell.js";
import { iconButton, statusChip } from "../src/tip.js";
import { html } from "../src/html.js";

describe("pageProblems (#782)", () => {
  it("names what a page lacks", () => {
    const bare =
      '<main><div class="canccu-pagehead"><h1>X</h1></div><span class="canccu-badge canccu-badge--down">Down</span>' +
      '<button aria-label="Less">&minus;</button><button>Save</button></main>';
    expect(pageProblems(bare)).toEqual([
      "no page description",
      "status chip without a tooltip: Down",
      "icon-only button without a tooltip: Less",
    ]);
  });

  it("passes a page that keeps the rules, and flags a long description", () => {
    const body = html`${statusChip("down", "Down", "It does not answer.")}${iconButton({ icon: "close", label: "Remove" })}`;
    expect(
      pageProblems(String(shellPage({ title: "X", description: "What X is for.", body }))),
    ).toEqual([]);
    expect(
      pageProblems(String(shellPage({ title: "X", description: "One. Two. Three.", body: "" }))),
    ).toEqual(["page description longer than two sentences: One. Two. Three."]);
  });
});
