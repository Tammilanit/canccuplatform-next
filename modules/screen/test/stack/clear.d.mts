// Types for clear.mjs, which runs as plain JavaScript inside the stack's containers.
interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export function overlapping(rect: Extent, others: Extent[]): number[];
export function emptiestBand(panel: Extent, parts: Extent[]): number;
interface ElementFacts {
  extent: Extent;
  classes: string[];
  inArt: boolean;
  inFx: boolean;
  hidden: boolean;
  leaf: boolean;
  text: boolean;
  mask: string;
}
export function opaqueShare(mask: string): number;
export function drawnParts(elements: ElementFacts[]): Extent[];
export function cutText(
  box: Extent,
  texts: {
    name: string;
    extent: Extent;
    scrollHeight: number;
    clientHeight: number;
    fontSize: number;
  }[],
): string[];
