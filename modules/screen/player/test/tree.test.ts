// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderTree } from "../src/tree.js";
import type { TreeNode } from "../src/tree.js";

const html = (nodes: TreeNode[], view: Record<string, unknown>): string => {
  const box = document.createElement("div");
  box.append(...renderTree(nodes, view));
  return box.innerHTML;
};

describe("the template tree renderer (contracts/theming.md, The parsed tree)", () => {
  it("draws text and fields as text, never as markup", () => {
    const nodes: TreeNode[] = [{ text: "Hi " }, { field: "name" }, { text: "!" }];
    expect(html(nodes, { name: "<b>Ann</b>" })).toBe("Hi &lt;b&gt;Ann&lt;/b&gt;!");
  });

  it("shows strings and numbers; booleans, null, objects, lists and missing fields are empty", () => {
    const f = (v: unknown) => html([{ field: "v" }], { v });
    expect(f(7)).toBe("7");
    expect(f(1.5)).toBe("1.5");
    for (const v of [true, false, null, { a: 1 }, [1], undefined]) expect(f(v)).toBe("");
  });

  it("reads dotted names, innermost section first, then outwards", () => {
    const nodes: TreeNode[] = [
      { field: "game.name" },
      {
        section: "items",
        inverted: false,
        children: [{ field: "name" }, { text: "/" }, { field: "title" }, { text: ";" }],
      },
    ];
    const view = {
      title: "T",
      game: { name: "G" },
      items: [{ name: "a" }, { name: "b", title: "X" }],
    };
    expect(html(nodes, view)).toBe("Ga/T;b/X;");
  });

  it("shows a section for a non-empty list, an object or a truthy scalar, and inverted when not", () => {
    const sec = (v: unknown, inverted = false) =>
      html([{ section: "v", inverted, children: [{ text: "y" }] }], { v });
    expect([sec([1, 2]), sec({}), sec(true), sec("x"), sec(3)]).toEqual(["yy", "y", "y", "y", "y"]);
    expect([sec([]), sec(false), sec(null), sec(""), sec(undefined)]).toEqual(["", "", "", "", ""]);
    expect([sec([], true), sec(false, true), sec([1], true)]).toEqual(["y", "y", ""]);
  });

  it("builds only allowed elements and attributes, and skips what it does not know", () => {
    const nodes: TreeNode[] = [
      {
        element: "div",
        attrs: {
          class: [{ text: "t-row t-state-" }, { field: "state" }],
          "aria-label": [{ field: "name" }],
          onclick: [{ text: "x()" }],
          style: [{ text: "color:red" }],
        },
        children: [
          { element: "script", attrs: {}, children: [{ text: "alert(1)" }] },
          { element: "br", attrs: {}, children: [{ text: "never" }] },
          { unknown: 1 } as unknown as TreeNode,
          { text: "ok" },
        ],
      },
    ];
    expect(html(nodes, { state: "li ve!x Y", name: "Ann" })).toBe(
      '<div class="t-row t-state-livex" aria-label="Ann"><br>ok</div>',
    );
  });

  it("lets an image load only same-host paths and data images", () => {
    const img = (src: string) =>
      html(
        [{ element: "img", attrs: { src: [{ field: "u" }], alt: [{ text: "a" }] }, children: [] }],
        {
          u: src,
        },
      );
    expect(img("/theming/a/x.png")).toBe('<img src="/theming/a/x.png" alt="a">');
    expect(img("data:image/svg+xml;base64,AAAA")).toContain('src="data:image/svg+xml;base64,AAAA"');
    for (const bad of [
      "//evil.test/x.png",
      "/\\evil.test/x.png",
      "https://evil.test/x.png",
      "javascript:alert(1)",
      "",
    ]) {
      expect(img(bad)).toBe('<img alt="a">');
    }
  });

  it("stops at eight nested sections, as theming's parser does", () => {
    let node: TreeNode = { text: "deep" };
    for (let i = 0; i < 9; i++) node = { section: "v", inverted: false, children: [node] };
    expect(html([node], { v: true })).toBe("");
  });
});
