// Types for dashboard.mjs, which runs as plain JavaScript inside the stack's containers.
interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export function crowded(boxes: Extent[][], gap: number): string[];
