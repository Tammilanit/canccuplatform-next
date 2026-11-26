// The shots' page rule (#782, docs/design/README.md decision 8): an organiser page whose head has
// no description, or one longer than two sentences, fails its shot.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { descriptionProblem } from "./demo-screenshots-shot.mjs";

test("a page with a head and no description fails, naming its path", () => {
  assert.equal(
    descriptionProblem("/admin/people", { head: true, text: "" }),
    "/admin/people has no page description",
  );
});

test("a description of one or two sentences passes, and a page without a head needs none", () => {
  assert.equal(descriptionProblem("/admin/", { head: true, text: "What it is. Why." }), null);
  assert.equal(descriptionProblem("/notify/", { head: false, text: "" }), null);
});

test("three sentences, or more than 240 characters, fail", () => {
  assert.match(descriptionProblem("/x", { head: true, text: "One. Two. Three." }), /longer than two sentences/);
  assert.match(descriptionProblem("/x", { head: true, text: "a".repeat(241) }), /longer than two sentences/);
});
