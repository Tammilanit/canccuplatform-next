/**
 * The event's food settings (contracts/pizza.md, Settings), saved in admin with
 * `admin.settings.write` and read per event through the kit's settings client.
 */
import { withTenant } from "@canccu/kit";
import type { SettingsClient } from "@canccu/kit";

export interface PizzaSettings {
  /** O3: off stops new orders; the Food page says why. */
  ordering_open: boolean;
  /** U2: `crew` lets only `pizza.order.open` start orders. */
  open_by: "anyone" | "crew";
  /** O5. */
  max_open_orders: number;
  /** U18. */
  max_items_per_person: number;
  /** M1: an order may settle to its payer instead of the organiser. */
  settle_to_payer: boolean;
}

export const DEFAULT_SETTINGS: PizzaSettings = {
  ordering_open: true,
  open_by: "anyone",
  max_open_orders: 3,
  max_items_per_person: 5,
  settle_to_payer: false,
};

const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

/** Reads the current settings of `tenant`, falling back to the defaults for anything not valid. */
export function settingsReader(client: SettingsClient): (tenant: string) => Promise<PizzaSettings> {
  return (tenant) =>
    withTenant(tenant, async () => {
      await client.ensure();
      const d = DEFAULT_SETTINGS;
      return {
        ordering_open: client.get("ordering_open", d.ordering_open) !== false,
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
      };
    });
}
