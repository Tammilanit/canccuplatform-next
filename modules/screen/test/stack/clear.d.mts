// Types for clear.mjs, which runs as plain JavaScript inside the stack's containers.
interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export function overlapping(rect: Extent, others: Extent[]): number[];
export function emptiestBand(panel: Extent, parts: Extent[]): number;
