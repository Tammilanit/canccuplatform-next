/**
 * The event's food settings (contracts/pizza.md, Settings), saved in admin with
 * `admin.settings.write` and read per event through the kit's settings client.
 */
import { withTenant } from "@canccu/kit";
import type { SettingsClient } from "@canccu/kit";

export interface PizzaSettings {
  /** O3: off stops new orders; the Food page says why. */
  ordering_open: boolean;
  /** O3: the organiser's words on the Food page while ordering is off ("" for none). */
  ordering_note: string;
  /** U2: `crew` lets only `pizza.order.open` start orders. */
  open_by: "anyone" | "crew";
  /** O5. */
  max_open_orders: number;
  /** U18. */
  max_items_per_person: number;
  /** M1: an order may settle to its payer instead of the organiser. */
  settle_to_payer: boolean;
  /** The scheduler's times (the plan's Forgotten orders), in minutes, each the legacy's value. */
  last_call_minutes: number;
  /** U3: an open order closes at its close time. */
  auto_close: boolean;
  remind_holder_minutes: number;
  /** The holder and the crew; also the gap between the holder's "arrived?" and the crew's. */
  remind_crew_minutes: number;
  release_after_minutes: number;
  /** "Has it arrived?" this long past the estimate, or after the call-in without one. */
  arrival_check_minutes: number;
  arrival_check_no_estimate_minutes: number;
  /** O7. */
  done_after_arrival_minutes: number;
  /** At the event day's turn (06:00): never called in → cancelled, called in → done (`timer`). */
  close_forgotten: boolean;
}

export const DEFAULT_SETTINGS: PizzaSettings = {
  ordering_open: true,
  ordering_note: "",
  open_by: "anyone",
  max_open_orders: 3,
  max_items_per_person: 5,
  settle_to_payer: false,
  last_call_minutes: 10,
  auto_close: true,
  remind_holder_minutes: 30,
  remind_crew_minutes: 60,
  release_after_minutes: 120,
  arrival_check_minutes: 30,
  arrival_check_no_estimate_minutes: 90,
  done_after_arrival_minutes: 120,
  close_forgotten: true,
};

/** Each time's bounds, as admin's declaration (modules/admin/declarations/pizza.yaml) has them. */
export const TIME_BOUNDS = {
  last_call_minutes: [1, 60],
  remind_holder_minutes: [5, 240],
  remind_crew_minutes: [10, 480],
  release_after_minutes: [30, 720],
  arrival_check_minutes: [5, 240],
  arrival_check_no_estimate_minutes: [15, 480],
  done_after_arrival_minutes: [15, 720],
} as const;
export type TimeKey = keyof typeof TIME_BOUNDS;

const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

function times(get: (key: TimeKey) => unknown): Record<TimeKey, number> {
  const out = {} as Record<TimeKey, number>;
  for (const [k, [min, max]] of Object.entries(TIME_BOUNDS) as [
    TimeKey,
    readonly [number, number],
  ][])
    out[k] = int(get(k), DEFAULT_SETTINGS[k], min, max);
  return out;
}

/** Admin keeps any string; the page shows one line of it. */
const noteOf = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, NOTE_MAX) : "");
export const NOTE_MAX = 200;

/** Reads the current settings of `tenant`, falling back to the defaults for anything not valid. */
export function settingsReader(client: SettingsClient): (tenant: string) => Promise<PizzaSettings> {
  return (tenant) =>
    withTenant(tenant, async () => {
      await client.ensure();
      const d = DEFAULT_SETTINGS;
      return {
        ordering_open: client.get("ordering_open", d.ordering_open) !== false,
        ordering_note: noteOf(client.get("ordering_note", d.ordering_note)),
        open_by:
          client.get("open_by", d.open_by) === "crew" ? ("crew" as const) : ("anyone" as const),
        max_open_orders: int(client.get("max_open_orders"), d.max_open_orders, 1, 20),
        max_items_per_person: int(
          client.get("max_items_per_person"),
          d.max_items_per_person,
          1,
          20,
        ),
        settle_to_payer: client.get("settle_to_payer", d.settle_to_payer) === true,
        auto_close: client.get("auto_close", d.auto_close) !== false,
        close_forgotten: client.get("close_forgotten", d.close_forgotten) !== false,
        ...times((k) => client.get(k)),
      };
    });
}
