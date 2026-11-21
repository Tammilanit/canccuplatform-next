/**
 * Who may do what (D5, P5; contracts/pizza.md, Rights). Every action of the step's issues is
 * listed here, so #118, #119 and the money issue only call `authorize` and add no rights. The
 * answer says through what the caller may act: a crew right (`crew`, `right`) is an override the
 * routes audit (D16), and counts only where admin is reachable (contracts/tenants.md, Admin access).
 */
import { AdminAccessRestricted, KitError, MissingRight, NotSignedIn } from "@canccu/kit";
import type { OrderState } from "./model.js";

export const OPEN = "pizza.order.open";
export const MANAGE = "pizza.order.manage";
export const MENU_WRITE = "pizza.menu.write";
export const RECORD_READ = "pizza.record.read";
export const RIGHTS = [OPEN, MANAGE, MENU_WRITE, RECORD_READ] as const;
/** Admin's right over the event's integrations: here, the AI reader's provider key (#644). */
export const INTEGRATIONS_WRITE = "admin.integrations.write";

export const ACTIONS = [
  // A member's own (#119)
  "order.read",
  "order.open",
  "order.claim",
  "item.add",
  "item.edit",
  "item.remove",
  "item.hand_out",
  // The holder's, or the crew's (#118)
  "order.release",
  "order.close",
  "order.reopen",
  "order.place",
  "order.edit",
  "order.arrive",
  "order.hand_out",
  "order.done",
  "order.undo",
  "order.cancel",
  "order.summary",
  "order.history",
  "order.names",
  // The crew's only
  "order.take_over",
  // Money (the money issue)
  "money.read",
  "money.edit",
  "money.payer",
  "receipt.add",
  "receipt.read",
  "paid.tick",
  // Pizzerias and menus, the record
  "menu.write",
  "menu.read_hidden",
  "menu.read_photo",
  "record.read",
  "record.export",
  // Admin → Integrations
  "reader.key",
] as const;
export type Action = (typeof ACTIONS)[number];

export interface Caller {
  user_id: string;
  member: boolean;
  rights: ReadonlySet<string>;
  /** Away from the venue and Tailscale while the event's admin access is restricted. */
  restricted?: boolean;
}

/** What the rules need to know of the order and the row an action is on. */
export interface Facts {
  holder_user_id: string | null;
  /** The row's owner, for item actions. */
  owner_user_id: string | null;
  state: OrderState;
  /** Open or closed from an earlier event day (E10). */
  stale: boolean;
  /** Before the order's event day turned at 06:00: the holder may still change its money. */
  holder_money_open: boolean;
  /** The event lets only `pizza.order.open` start orders (U2). */
  crew_only: boolean;
}

export const NO_FACTS: Facts = {
  holder_user_id: null,
  owner_user_id: null,
  state: "open",
  stale: false,
  holder_money_open: true,
  crew_only: false,
};

export type As = "member" | "owner" | "holder" | "crew" | "right";

const forbidden = (code: string, message: string) => new KitError(message, { status: 403, code });

const HOLDER_OR_CREW = new Set<Action>([
  "order.release",
  "order.close",
  "order.reopen",
  "order.place",
  "order.edit",
  "order.arrive",
  "order.hand_out",
  "order.done",
  "order.undo",
  "order.cancel",
  "order.summary",
  "order.history",
  "order.names",
]);
/** The holder's money is theirs only until the day turns; the crew's always. */
const MONEY_WRITES = new Set<Action>(["money.edit", "money.payer", "receipt.add", "paid.tick"]);
const OWNER = new Set<Action>(["item.edit", "item.remove", "item.hand_out"]);
const BY_RIGHT: Partial<Record<Action, string>> = {
  "order.take_over": MANAGE,
  "menu.write": MENU_WRITE,
  "menu.read_hidden": MENU_WRITE,
  "menu.read_photo": MENU_WRITE,
  "record.read": RECORD_READ,
  "record.export": RECORD_READ,
  "reader.key": INTEGRATIONS_WRITE,
};

/** How the caller may do `action`, or the error to answer. */
export function authorize(action: Action, caller: Caller | null, f: Facts): { as: As } {
  if (caller === null) throw new NotSignedIn("sign in first");
  if (!caller.member) throw forbidden("not_a_member", "Join the event to order food.");
  const has = (right: string) => caller.rights.has(right);
  const viaRight = (as: "crew" | "right"): { as: As } => {
    if (caller.restricted === true) {
      throw new AdminAccessRestricted("admin rights work only from the venue or Tailscale here");
    }
    return { as };
  };
  const holds = f.holder_user_id !== null && f.holder_user_id === caller.user_id;

  if (action === "order.read" || action === "order.claim" || action === "item.add") {
    return { as: "member" };
  }
  if (action === "order.open") {
    if (!f.crew_only) return { as: "member" };
    if (has(OPEN) || has(MANAGE)) return viaRight("right");
    throw new MissingRight(`needs right ${OPEN}`);
  }
  const right = BY_RIGHT[action];
  if (right !== undefined) {
    if (has(right)) return viaRight(action === "order.take_over" ? "crew" : "right");
    throw new MissingRight(`needs right ${right}`);
  }
  if (OWNER.has(action)) {
    if (holds) return { as: "holder" };
    if (f.owner_user_id === caller.user_id) {
      if (action !== "item.hand_out" && f.state !== "open") {
        throw new KitError("The order is closed: ask its holder.", { status: 403, code: "closed" });
      }
      return { as: "owner" };
    }
    if (has(MANAGE)) return viaRight("crew");
    throw forbidden("not_owner", "This is not your pizza.");
  }
  if (action === "money.read" || action === "receipt.read") {
    if (holds) return { as: "holder" };
    if (has(MANAGE)) return viaRight("crew");
    if (has(RECORD_READ)) return viaRight("right");
    throw forbidden("not_holder", "Only the order's holder and the crew see its money.");
  }
  if (MONEY_WRITES.has(action)) {
    if (holds && f.holder_money_open) return { as: "holder" };
    if (has(MANAGE)) return viaRight("crew");
    if (holds) throw forbidden("money_locked", "The event day has turned: ask the crew.");
    throw forbidden("not_holder", "Only the order's holder and the crew change its money.");
  }
  if (HOLDER_OR_CREW.has(action)) {
    if (holds) return { as: "holder" };
    if (has(MANAGE)) return viaRight("crew");
    // The legacy rule: an order left from an earlier day blocks nobody, any member may cancel it.
    if (action === "order.cancel" && f.stale && (f.state === "open" || f.state === "closed")) {
      return { as: "member" };
    }
    throw forbidden("not_holder", "Only the person holding this order can do that.");
  }
  throw new KitError(`unknown action ${action}`);
}

/** Whether `action` is allowed, for views that show more to those who may. */
export function may(action: Action, caller: Caller | null, f: Facts): boolean {
  try {
    authorize(action, caller, f);
    return true;
  } catch {
    return false;
  }
}
