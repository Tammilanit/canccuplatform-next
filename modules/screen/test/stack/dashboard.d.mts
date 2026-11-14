// Types for dashboard.mjs, which runs as plain JavaScript inside the stack's containers.
interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export function crowded(boxes: Extent[][], gap: number): string[];
/** `doc` is the page's document (a DOM Document; the module has no DOM types). */
export function drawnWhole(doc?: object): boolean;
