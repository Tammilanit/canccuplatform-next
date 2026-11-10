/**
 * Widget templates (contracts/theming.md, Widget templates and The parsed tree): the Mustache
 * subset inside the HTML subset, parsed at upload into the tree surfaces render, every failure
 * `template_forbidden`.
 */
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseTemplate, servedTree } from "../src/template.js";
import type { TemplateNode } from "../src/template.js";

const parse = (source: string) => parseTemplate("templates/t.mustache", Buffer.from(source));

function tree(source: string): TemplateNode[] {
  const result = parse(source);
  if (!result.ok) throw new Error(result.problem.message);
  return result.tree;
}

function refused(source: string): string {
  const result = parse(source);
  if (result.ok) throw new Error(`accepted: ${source}`);
  expect(result.problem).toMatchObject({
    severity: "error",
    code: "template_forbidden",
    path: "templates/t.mustache",
  });
  return result.problem.message;
}

const demo = new URL("../../../events/demo/themes/", import.meta.url);

describe("parseTemplate", () => {
  it("parses every demo template", async () => {
    for (const theme of ["level-up", "terminal"]) {
      const dir = new URL(`${theme}/templates/`, demo);
      for (const name of await readdir(dir)) {
        const result = parseTemplate(`templates/${name}`, await readFile(new URL(name, dir)));
        expect(result.ok, `${theme}/${name}: ${result.ok ? "" : result.problem.message}`).toBe(
          true,
        );
      }
    }
  });

  it("builds the tree of contracts/theming.md, The parsed tree", () => {
    expect(
      tree(
        `{{! dropped }}<div class="t-card t-card--{{level}}"><h3>{{item.title}}</h3>` +
          `{{#items}}<p>{{name}} &amp; co</p>{{/items}}{{^items}}<p>None</p>{{/items}}` +
          `<img src="images/a.png" alt="{{alt}}"><br></div>`,
      ),
    ).toEqual([
      {
        element: "div",
        attrs: { class: [{ text: "t-card t-card--" }, { field: "level" }] },
        children: [
          { element: "h3", attrs: {}, children: [{ field: "item.title" }] },
          {
            section: "items",
            inverted: false,
            children: [
              { element: "p", attrs: {}, children: [{ field: "name" }, { text: " & co" }] },
            ],
          },
          {
            section: "items",
            inverted: true,
            children: [{ element: "p", attrs: {}, children: [{ text: "None" }] }],
          },
          { element: "img", attrs: { src: [{ text: "images/a.png" }], alt: [{ field: "alt" }] } },
          { element: "br", attrs: {} },
        ],
      },
    ]);
  });

  it("keeps sections around table rows and inside attributes", () => {
    expect(tree(`<table><tbody>{{#rows}}<tr><td>{{n}}</td></tr>{{/rows}}</tbody></table>`)).toEqual(
      [
        {
          element: "table",
          attrs: {},
          children: [
            {
              element: "tbody",
              attrs: {},
              children: [
                {
                  section: "rows",
                  inverted: false,
                  children: [
                    {
                      element: "tr",
                      attrs: {},
                      children: [{ element: "td", attrs: {}, children: [{ field: "n" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    );
    expect(
      tree(`<span class="t-a {{#on}}t-on{{/on}}" aria-label="{{^x}}none{{/x}}"></span>`),
    ).toEqual([
      {
        element: "span",
        attrs: {
          class: [
            { text: "t-a " },
            { section: "on", inverted: false, children: [{ text: "t-on" }] },
          ],
          "aria-label": [{ section: "x", inverted: true, children: [{ text: "none" }] }],
        },
        children: [],
      },
    ]);
  });

  it("answers the package images it names", () => {
    const result = parse(`<img src="images/a.png"><img src="{{art_url}}"><img src="images/b.svg">`);
    expect(result).toMatchObject({ ok: true, refs: ["images/a.png", "images/b.svg"] });
  });

  it.each([
    ["unescaped output {{{ }}}", "<p>{{{html}}}</p>", "{{{"],
    ["unescaped output {{& }}", "<p>{{& html}}</p>", "{{&"],
    ["a partial", "<p>{{> other}}</p>", "{{>"],
    ["changed delimiters", "{{=<% %>=}}<p><%x%></p>", "{{="],
    ["a block", "{{$b}}x{{/b}}", "{{$"],
    ["a field that is no name", "<p>{{a b}}</p>", "a b"],
    ["the implicit iterator", "{{#a}}<p>{{.}}</p>{{/a}}", "{{.}}"],
    ["an unclosed tag", "<p>{{name</p>", "not closed"],
    ["an unclosed section", "{{#a}}<p>x</p>", "{{#a}}"],
    ["a section closed by another name", "{{#a}}x{{/b}}", "{{/b}}"],
    ["a section across elements", "<div>{{#a}}</div>{{/a}}", "{{#a}}"],
    ["sections over 8 deep", "{{#a}}".repeat(9) + "x" + "{{/a}}".repeat(9), "8 deep"],
    ["script", "<script>alert(1)</script>", "<script>"],
    ["style", "<style>p{}</style>", "<style>"],
    ["an element outside the list", "<a>x</a>", "<a>"],
    ["svg", "<svg><circle r=1 /></svg>", "<svg>"],
    ["iframe", `<iframe src="images/a.png"></iframe>`, "<iframe>"],
    ["an on* handler", `<img src="images/a.png" onerror="alert(1)">`, "onerror"],
    ["a style attribute", `<p style="color:red">x</p>`, "style"],
    ["href", `<p href="javascript:alert(1)">x</p>`, "href"],
    ["id", `<p id="x">x</p>`, "id"],
    ["src off img", `<p src="images/a.png">x</p>`, "src"],
    ["a tag in a tag", `<p {{attr}}>x</p>`, "{{attr}}"],
    ["an HTML comment", `<p><!-- x --></p>`, "comment"],
    ["a tag in an HTML comment", `<!-- {{x}} --><p></p>`, "comment"],
    ["src from outside the package", `<img src="https://evil.test/x.png">`, "src"],
    ["src as data:", `<img src="data:image/png;base64,AAAA">`, "src"],
    ["src as javascript:", `<img src="javascript:alert(1)">`, "src"],
    ["src with ..", `<img src="images/../css/a.css">`, "src"],
    ["src joined from a field", `<img src="images/{{name}}.png">`, "src"],
    ["src from a field that is no image address", `<img src="{{name}}">`, "src"],
    ["an unstable class", `<p class="t-a legacy">x</p>`, "legacy"],
    ["a class built from data alone", `<p class="{{state}}">x</p>`, "class"],
    ["a stable class lengthened by data", `<p class="canccu-badge--{{state}}">x</p>`, "class"],
    ["a section joined to a class name", `<p class="t-a{{#x}}-on{{/x}}">x</p>`, "class"],
  ])("refuses %s", (_name, source, named) => {
    expect(refused(source)).toContain(named);
  });

  it("names the line of a failure", () => {
    expect(refused("<p>x</p>\n\n<p>{{{x}}}</p>")).toContain("line 3");
  });

  it("refuses what is no UTF-8 text, a file over 32 KB and deep nesting", () => {
    expect(refused("<p>\u0000</p>")).toContain("UTF-8");
    expect(refused("<p></p>")).toContain("character");
    const big = parse("<p>x</p>".padEnd(32 * 1024 + 1, " "));
    expect(big).toMatchObject({ ok: false, problem: { code: "file_too_large" } });
    expect(refused("<div>".repeat(40) + "x")).toContain("deep");
  });

  it("keeps whitespace as text, as the browser does", () => {
    expect(tree(`<p>\n  {{a}}\n</p>`)).toEqual([
      { element: "p", attrs: {}, children: [{ text: "\n  " }, { field: "a" }, { text: "\n" }] },
    ]);
  });
});

describe("servedTree", () => {
  it("rewrites package images in src to their served addresses, everything else unchanged", () => {
    const parsed = tree(
      `{{#a}}<img src="images/a.png" alt="images/a.png"><img src="{{x_url}}">{{/a}}`,
    );
    expect(
      servedTree(parsed, (p) => (p === "images/a.png" ? "/theming/a/abc.png" : undefined)),
    ).toEqual([
      {
        section: "a",
        inverted: false,
        children: [
          {
            element: "img",
            attrs: { src: [{ text: "/theming/a/abc.png" }], alt: [{ text: "images/a.png" }] },
          },
          { element: "img", attrs: { src: [{ field: "x_url" }] } },
        ],
      },
    ]);
    expect(() => servedTree(parsed, () => undefined)).toThrow(/images\/a.png/);
  });
});
