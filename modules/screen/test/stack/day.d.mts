// Types for day.mjs, which runs as plain JavaScript in the screenshot run.
export interface PlacedItem {
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  location: string;
  /** Minutes the fixture delays the item by once it is added; 0 for none. */
  delay: number;
}
export function placeDay(now: number): PlacedItem[];
