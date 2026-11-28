// Types for timeline-fit.mjs, which runs as plain JavaScript inside the stack's containers.
interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export function touchingNext(boxes: Extent[], gap?: number): number[];
export function outsideBlock(pairs: { name: string; block: Extent; text: Extent }[]): string[];
export function timelineComposed(state: unknown): boolean;
export function timelineFits(page: unknown): Promise<void>;
