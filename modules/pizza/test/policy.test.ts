/**
 * The rights (D5, P5): every action of this issue, #118, #119 and the money issue, for every kind
 * of caller. Later issues call `authorize` and add no rights of their own.
 */
import { describe, expect, it } from "vitest";
import { ACTIONS, MANAGE, MENU_WRITE, OPEN, RECORD_READ, authorize } from "../src/policy.js";
import type { Action, Caller, Facts } from "../src/policy.js";

const caller = (user_id: string, rights: string[] = [], member = true): Caller => ({
  user_id,
  member,
  rights: new Set(rights),
});
const WHO: Record<string, Caller | null> = {
  guest: null,
  stranger: caller("u_out", [], false),
  member: caller("u_mem"),
  owner: caller("u_own"),
  holder: caller("u_hold"),
  crew: caller("u_crew", [MANAGE]),
  opener: caller("u_open", [OPEN]),
  menus: caller("u_menu", [MENU_WRITE]),
  treasurer: caller("u_rec", [RECORD_READ]),
};
const facts = (o: Partial<Facts> = {}): Facts => ({
  holder_user_id: "u_hold",
  owner_user_id: "u_own",
  state: "open",
  stale: false,
  holder_money_open: true,
  crew_only: false,
  ...o,
});

/** Who may do it, as `as` (`holder`, `crew`, …), or the error code everyone else gets. */
function outcome(action: Action, who: string, f: Facts = facts()): string {
  try {
    return authorize(action, WHO[who] ?? null, f).as;
  } catch (err) {
    return `${String((err as { status: number }).status)} ${(err as { code: string }).code}`;
  }
}
const row = (action: Action, f?: Facts) => Object.keys(WHO).map((w) => outcome(action, w, f));

describe("authorize", () => {
  it("lists every action once", () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
    expect(ACTIONS.length).toBeGreaterThanOrEqual(30);
  });

  it("answers a guest 401, a signed-in non-member 403 not_a_member, for every action", () => {
    for (const a of ACTIONS) {
      expect(outcome(a, "guest"), a).toBe("401 not_signed_in");
      expect(outcome(a, "stranger"), a).toBe("403 not_a_member");
    }
  });

  //                    guest, stranger, member, owner, holder, crew, opener, menus, treasurer
  const NH = "403 not_holder";
  const held = ["holder", "crew"];
  it.each<[Action, string[]]>([
    ["order.open", ["member", "member", "member", "member", "member", "member", "member"]],
    ["order.claim", ["member", "member", "member", "member", "member", "member", "member"]],
    ["item.add", ["member", "member", "member", "member", "member", "member", "member"]],
    ["order.read", ["member", "member", "member", "member", "member", "member", "member"]],
    ["order.take_over", ["403 missing_right", "403 missing_right", "403 missing_right", "crew", "403 missing_right", "403 missing_right", "403 missing_right"]],
    ...(
      [
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
        "money.edit",
        "money.payer",
        "receipt.add",
        "paid.tick",
      ] as Action[]
    ).map((a): [Action, string[]] => [a, [NH, NH, ...held, NH, NH, NH]]),
    ["money.read", [NH, NH, ...held, NH, NH, "right"]],
    ["receipt.read", [NH, NH, ...held, NH, NH, "right"]],
    ["item.edit", ["403 not_owner", "owner", ...held, "403 not_owner", "403 not_owner", "403 not_owner"]],
    ["item.remove", ["403 not_owner", "owner", ...held, "403 not_owner", "403 not_owner", "403 not_owner"]],
    ["item.hand_out", ["403 not_owner", "owner", ...held, "403 not_owner", "403 not_owner", "403 not_owner"]],
    ["menu.write", ["403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "right", "403 missing_right"]],
    ["menu.read_photo", ["403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "right", "403 missing_right"]],
    ["menu.read_hidden", ["403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "right", "403 missing_right"]],
    ["record.read", ["403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "right"]],
    ["record.export", ["403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "403 missing_right", "right"]],
  ])("%s", (action, expected) => {
    expect(row(action).slice(2)).toEqual(expected);
  });

  it("lets only pizza.order.open (or the crew) open when the event is crew only (U2)", () => {
    const f = facts({ crew_only: true });
    expect(row("order.open", f).slice(2)).toEqual([
      "403 missing_right",
      "403 missing_right",
      "403 missing_right",
      "right",
      "right",
      "403 missing_right",
      "403 missing_right",
    ]);
  });

  it("closes the owner's edits once the order is closed; the holder and crew still edit (U14)", () => {
    for (const state of ["closed", "placed", "arrived"] as const) {
      expect(outcome("item.edit", "owner", facts({ state })), state).toBe("403 closed");
      expect(outcome("item.edit", "holder", facts({ state })), state).toBe("holder");
      expect(outcome("item.remove", "crew", facts({ state })), state).toBe("crew");
    }
  });

  it("lets any member cancel an order left from an earlier day (E10), only while not called in", () => {
    expect(outcome("order.cancel", "member", facts({ stale: true }))).toBe("member");
    expect(outcome("order.cancel", "member", facts({ stale: true, state: "placed" }))).toBe(NH);
  });

  it("gives the holder the money until the day turns at 06:00, the crew always (Money)", () => {
    const after = facts({ holder_money_open: false, state: "done" });
    for (const a of ["money.edit", "money.payer", "receipt.add", "paid.tick"] as Action[]) {
      expect(outcome(a, "holder", after), a).toBe("403 money_locked");
      expect(outcome(a, "crew", after), a).toBe("crew");
    }
    expect(outcome("money.read", "holder", after)).toBe("holder");
  });

  it("treats a holder who also holds a crew right as the holder: no crew override", () => {
    const both = caller("u_hold", [MANAGE]);
    expect(authorize("order.close", both, facts()).as).toBe("holder");
  });

  it("refuses a crew right used away from the venue when admin access is restricted", () => {
    const away = { ...caller("u_crew", [MANAGE]), restricted: true };
    expect(() => authorize("order.take_over", away, facts())).toThrow(/admin/);
    const holder = { ...caller("u_hold", [MANAGE]), restricted: true };
    expect(authorize("order.close", holder, facts()).as).toBe("holder");
  });

  it("lets an owner tick only their own pizza (U9)", () => {
    expect(outcome("item.hand_out", "owner", facts({ state: "arrived" }))).toBe("owner");
    expect(outcome("item.hand_out", "member", facts({ state: "arrived" }))).toBe("403 not_owner");
  });
});
