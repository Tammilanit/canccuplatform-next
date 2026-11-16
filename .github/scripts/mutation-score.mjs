#!/usr/bin/env node
// The weekly run's mutation score (docs/ci.md#weekly, #575): one score per core package, from
// Stryker's JSON report (TypeScript) or mutmut's `export-cicd-stats` (Python), counted the same
// way: caught / (caught + missed), where a mutant that does not compile or run counts as neither.
// It writes mutation-score.json and mutation-score.md, the artifact `mutation-score` the step
// checkpoint quotes.
// Usage: mutation-score.mjs --out DIR [--stryker NAME=report.json]... [--mutmut NAME=stats.json]...
// A named report that is missing fails the run (exit 1): a part that stopped early has no score.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const score = (caught, missed) => ({
  caught,
  missed,
  total: caught + missed,
  score: caught + missed ? Math.round((1000 * caught) / (caught + missed)) / 10 : null,
});

export function fromStryker(report) {
  const count = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  for (const file of Object.values(report.files ?? {})) {
    for (const m of file.mutants ?? []) if (m.status in count) count[m.status]++;
  }
  return score(count.Killed + count.Timeout, count.Survived + count.NoCoverage);
}

export function fromMutmut(stats) {
  const n = (k) => stats[k] ?? 0;
  return score(n("killed") + n("timeout") + n("segfault"), n("survived") + n("no_tests") + n("suspicious"));
}

export function markdown(scores, { sha, date }) {
  return [
    `# Mutation score (${sha.slice(0, 7)}, ${date})`,
    "",
    "| Package | Score | Caught | Missed | Mutants |",
    "|---|---|---|---|---|",
    ...Object.entries(scores).map(([name, s]) =>
      s.score === null ? `| ${name} | no mutants | | | |` : `| ${name} | ${s.score} % | ${s.caught} | ${s.missed} | ${s.total} |`,
    ),
    "",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { out: { type: "string" }, stryker: { type: "string", multiple: true }, mutmut: { type: "string", multiple: true } },
  });
  if (!values.out) {
    console.error("usage: mutation-score.mjs --out DIR [--stryker NAME=report.json]... [--mutmut NAME=stats.json]...");
    process.exit(2);
  }
  const scores = {};
  let missing = false;
  for (const [kind, read] of [["stryker", fromStryker], ["mutmut", fromMutmut]]) {
    for (const pair of values[kind] ?? []) {
      const [name, file] = pair.split("=");
      if (!existsSync(file)) {
        console.error(`::error::${name}: no ${kind} report at ${file}`);
        missing = true;
        continue;
      }
      scores[name] = read(JSON.parse(readFileSync(file, "utf8")));
    }
  }
  const sha = process.env.GITHUB_SHA ?? "0000000";
  const md = markdown(scores, { sha, date: new Date().toISOString().slice(0, 10) });
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, "mutation-score.json"), `${JSON.stringify({ sha, scores }, null, 2)}\n`);
  writeFileSync(join(values.out, "mutation-score.md"), md);
  console.log(md);
  process.exit(missing ? 1 : 0);
}
