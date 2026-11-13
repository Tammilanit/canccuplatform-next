/** Types for studio-boxes.js, which the page loads as it is; only the tests read these. */

export interface Area {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

export interface Box {
  id: string;
  area: Area;
  /** Where the layout itself draws it; the space an edit must keep filled. */
  layoutArea?: Area;
  layer: number;
  hidden: boolean;
  /** A header, ticker or backdrop: it never grows into a hidden box's space. */
  frame: boolean;
}

export type Edge = "left" | "right" | "top" | "bottom";

export function overlaps(a: Area, b: Area): boolean;
export function sameArea(a: Area | undefined, b: Area | undefined): boolean;
export function fits(area: Area, grid: { columns: number; rows: number }): boolean;
export function resize(
  boxes: Box[],
  id: string,
  how: "narrower" | "wider" | "shorter" | "taller",
  grid: { columns: number; rows: number },
): Box[] | null;
export function drag(
  boxes: Box[],
  id: string,
  edge: Edge,
  line: number,
  grid: { columns: number; rows: number },
): Box[];
export function hide(boxes: Box[], id: string): Box[];
export function show(
  boxes: Box[],
  id: string,
  layoutAreas: Record<string, Area>,
  grid: { columns: number; rows: number },
): Box[] | null;

export interface Gap {
  area: Area;
  /** The box beside it the words name, and whose edge `fill` grows; null when none touches it. */
  box: string | null;
  edge: Edge | null;
  fills: boolean;
}

export function gaps(boxes: Box[], grid: { columns: number; rows: number }): Gap[];
export function fill(boxes: Box[], gap: Gap): Box[] | null;
export function gapWords(gap: Gap): { key: string; count: number };
