// Types for readability.mjs, which runs as plain JavaScript in the screenshot run and the page.
export type Rgba = number[];
export interface Layer {
  color: Rgba;
  stops: Rgba[];
}
export interface Sample {
  text: string;
  where: string;
  fontPx: number;
  /** Cut by the box around it (readability.mjs, collectSamples). */
  clipped?: boolean;
  color: Rgba;
  /** The backgrounds under the text, outermost first. */
  layers: Layer[];
  /** The colours of the text and its grounds the check could not read (readability.mjs, judgePage). */
  unread?: string[];
}
export interface Viewport {
  width: number;
  height: number;
}
export interface PageSamples {
  samples: (Omit<Sample, "color" | "layers"> & {
    color: string;
    layers: { color: string; image: string }[];
  })[];
  tokens: Record<string, string>;
  viewport: Viewport;
}
export function readColor(value: string): Rgba | null;
export function parseColors(value: string): Rgba[];
export function unreadColors(value: string): string[];
export function contrast(a: Rgba, b: Rgba): number;
export function grounds(layers: Layer[]): Rgba[];
export function judge(
  samples: Sample[],
  viewport: Viewport,
  tokens: Record<string, Rgba>,
): string[];
export function judgePage(page: PageSamples): string[];
export function collectSamples(): PageSamples;
