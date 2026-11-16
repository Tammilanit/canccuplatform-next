// A stand-in for the `gh` CLI in the tests of the CI scripts: `gh api` reads answer from `answers`
// (keyed by path, query string ignored; a function gets the query; a string is a raw body, as a
// job's log is), and every other call is a write, recorded in `writes` and answered as GitHub
// would. Only the jq forms the scripts use
// (`.[]`, `.<key>[]`) are understood.
export function fakeGh(answers) {
  const writes = [];
  const gh = (args) => {
    if (args[0] === "api" && !args.includes("-X")) {
      const path = args[args.length - 1];
      const [key, query = ""] = path.split("?");
      if (!(key in answers)) throw new Error(`fake gh: no answer for ${path}`);
      let answer = answers[key];
      if (typeof answer === "function") answer = answer(new URLSearchParams(query));
      if (typeof answer === "string") return answer;
      const jq = args.includes("--jq") ? args[args.indexOf("--jq") + 1] : null;
      if (!jq) return JSON.stringify(answer);
      const m = /^\.(\w*)\[\]$/.exec(jq);
      if (!m) throw new Error(`fake gh: jq ${jq} not understood`);
      const items = m[1] ? answer[m[1]] : answer;
      return items.map((i) => JSON.stringify(i)).join("\n");
    }
    writes.push(args);
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/o/r/issues/100\n";
    return "{}";
  };
  gh.writes = writes;
  return gh;
}
