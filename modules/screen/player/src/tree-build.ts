/** Builders for the parsed tree (tree.ts) the player's default templates (templates.ts) are written in. */
import type { TreeNode } from "./tree.js";

type Attrs = Record<string, TreeNode[]>;

export const t = (text: string): TreeNode => ({ text });
export const f = (field: string): TreeNode => ({ field });
export const sec = (section: string, ...children: TreeNode[]): TreeNode => ({
  section,
  inverted: false,
  children,
});
export const not = (section: string, ...children: TreeNode[]): TreeNode => ({
  section,
  inverted: true,
  children,
});
/** An element; `cls` names a `canccu-widget__…` part, `extra` adds attributes. */
export function el(
  tag: string,
  cls: string | null,
  children: TreeNode[],
  extra: Attrs = {},
): TreeNode {
  const attrs: Attrs = cls === null ? extra : { class: [t(`canccu-widget__${cls}`)], ...extra };
  return { element: tag, attrs, children };
}
export const title = (field: string): TreeNode => el("p", "title", [f(field)]);
export const img = (field: string, cls: string, alt: TreeNode[] = []): TreeNode =>
  el("img", cls, [], { src: [f(field)], alt });
