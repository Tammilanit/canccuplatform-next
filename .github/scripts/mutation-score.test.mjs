// Tests of mutation-score.mjs (docs/ci.md#weekly): one score per package from Stryker's and
// mutmut's reports, counted the same way.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fromMutmut, fromStryker, markdown } from "./mutation-score.mjs";

const mutants = (...statuses) => statuses.map((status, id) => ({ id: String(id), status }));

test("Stryker: killed and timed out count as caught; survived and uncovered as missed; errors not at all", () => {
  const report = {
    files: {
      "src/a.ts": { mutants: mutants("Killed", "Killed", "Survived", "Timeout") },
      "src/b.ts": { mutants: mutants("NoCoverage", "CompileError", "RuntimeError", "Ignored", "Killed") },
    },
  };
  assert.deepEqual(fromStryker(report), { caught: 4, missed: 2, total: 6, score: 66.7 });
});

test("mutmut: killed, timeout and segfault are caught; survived, no tests and suspicious missed", () => {
  const stats = { killed: 6, survived: 2, timeout: 1, segfault: 1, no_tests: 1, suspicious: 1, skipped: 5, total: 17 };
  assert.deepEqual(fromMutmut(stats), { caught: 8, missed: 4, total: 12, score: 66.7 });
});

test("no mutant at all is no score, not 100 %", () => {
  assert.equal(fromStryker({ files: {} }).score, null);
  assert.equal(fromMutmut({}).score, null);
});

test("the summary names each package with its score, for the checkpoint to quote", () => {
  const md = markdown(
    { "packages/kit-ts": { caught: 4, missed: 2, total: 6, score: 66.7 }, "packages/kit-py": { caught: 0, missed: 0, total: 0, score: null } },
    { sha: "a".repeat(40), date: "2026-11-22" },
  );
  assert.match(md, /\| packages\/kit-ts \| 66\.7 % \| 4 \| 2 \| 6 \|/);
  assert.match(md, /\| packages\/kit-py \| no mutants \|/);
  assert.match(md, /aaaaaaa, 2026-11-22/);
});
