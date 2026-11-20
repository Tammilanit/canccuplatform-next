// Tests of scripts/a11y-check.mjs (docs/ci.md#weekly): which pages it checks and which of axe's
// findings fail the weekly run. The browser run itself is the weekly run's.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PAGES_TO_CHECK, failing, markdown, reached } from "./a11y-check.mjs";

test("every page of the screenshots that opens at one URL is checked, plus the screen's own first view", () => {
  const paths = PAGES_TO_CHECK.map(([, path]) => path);
  assert.ok(paths.includes("/admin/settings"));
  assert.ok(paths.includes("/agenda/add"));
  assert.ok(paths.includes("/screen/"), "the screen as a fresh device opens it");
  assert.ok(!paths.some((p) => p.startsWith("@")), "no placeholder path, such as the check-in's fresh code");
});

const result = (name, ...impacts) => ({
  name,
  path: `/${name}`,
  violations: impacts.map((impact, i) => ({ id: `rule-${i}`, impact, help: `help ${i}`, nodes: [{}, {}] })),
});

test("serious and critical violations fail; moderate and minor are only listed", () => {
  const results = [result("a", "minor", "moderate"), result("b", "serious"), result("c", "critical", "minor")];
  assert.deepEqual(failing(results).map((r) => r.name), ["b", "c"]);
});

test("a page that could not be checked fails too", () => {
  assert.deepEqual(failing([{ name: "x", path: "/x", error: "timeout" }]).map((r) => r.name), ["x"]);
});

test("the report lists every finding by page, with its impact and how many elements", () => {
  const md = markdown([result("b", "serious"), { name: "x", path: "/x", error: "timeout" }, result("ok")]);
  assert.match(md, /\| b \| \/b \| serious \| rule-0 \| 2 \| help 0 \|/);
  assert.match(md, /\| x \| \/x \| not checked \| timeout \|/);
  assert.match(md, /1 of 3 pages clean/);
});

// #586: an error page, or the sign-in page a rejected session is sent on to, is no page checked.
test("a page counts as reached only when it answered 2xx at its own address", () => {
  const res = (status, from = null, url = "http://demo.example/agenda/add") => ({
    status: () => status,
    url: () => url,
    request: () => ({ redirectedFrom: () => from }),
  });
  assert.equal(reached(res(200)), null);
  assert.equal(reached(res(404)), "answered HTTP 404");
  assert.equal(reached(res(502)), "answered HTTP 502");
  assert.equal(reached(null), "answered nothing");
  assert.equal(
    reached(res(200, {}, "http://demo.example/admin/sign-in")),
    "was sent on to /admin/sign-in",
  );
});
