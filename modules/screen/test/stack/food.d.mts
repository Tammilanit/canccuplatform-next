// Types for food.mjs, which runs as plain JavaScript in the screenshot run and the page.
export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface FoodMeasure {
  box: Edges;
  /** The cue's frame on the box's region (cues.css), or null while no cue is drawn. */
  frame: Edges | null;
  /** The hub QR's card beside the box, or null where there is none. */
  qr: Edges | null;
  texts: (Edges & { text: string })[];
}
type FoodClaim = [
  string,
  { template: string; content: Record<string, unknown>; effect: { name: string } },
];
export const FOOD_CLAIM_OF: Record<"claim-food-long" | "claim-food-on-the-way-long", FoodClaim>;
export function withFoodClaim(view: string): <S>(s: S) => S;
export function measureFood(): FoodMeasure | null;
export function judgeFood(m: FoodMeasure | null): string[];
export function foodFits(page: unknown): Promise<void>;
export function roomReady(page: unknown, step: string): Promise<void>;
