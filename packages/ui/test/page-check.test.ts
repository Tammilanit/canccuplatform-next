import { describe, expect, it } from "vitest";
import { pageProblems } from "../src/page-check.js";
import { shellPage } from "../src/shell.js";
import { iconButton, statusChip } from "../src/tip.js";
import { html, raw, type Html } from "../src/html.js";

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

  it("leaves out a chip inside a link, which is part of the link's text", () => {
    const chip = '<span class="canccu-badge canccu-badge--down">Off</span>';
    const row = raw(`<a class="row" href="/i">Dinner ${chip}</a>`);
    const page = (body: Html) => String(shellPage({ title: "X", description: "For X.", body }));
    expect(pageProblems(page(row))).toEqual([]);
    expect(pageProblems(page(html`${row}${raw(chip)}`))).toEqual([
      "status chip without a tooltip: Off",
    ]);
  });

  it("counts entities as the characters they stand for, as the Python twin does", () => {
    const coded = shellPage({
      title: "X",
      description: raw("One&#46; Two&#x2e; Three&#46;"),
      body: "",
    });
    expect(pageProblems(String(coded))).toEqual([
      "page description longer than two sentences: One. Two. Three.",
    ]);
  });

  it("leaves a chip's tooltip out of the description", () => {
    const chip = statusChip("plain", "Draft", "Kept here. Not published. Yours.");
    const page = shellPage({
      title: "X",
      description: html`${chip} Nothing published yet.`,
      body: "",
    });
    expect(pageProblems(String(page))).toEqual([]);
  });
});
