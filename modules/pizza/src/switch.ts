/**
 * Food's switch for an event (`pizza.enabled`, contracts/pizza.md, Feature flags; #747): off, its
 * pages answer "not at this event" and its scheduler leaves the event's orders alone; its data
 * stays, so switching it on again finds everything as it was. A flag never set is on.
 */
import type { TenantContext } from "@canccu/kit";

export const FOOD_FLAG = "pizza.enabled";

export const foodOn = (ctx: TenantContext): boolean => ctx.flags[FOOD_FLAG] !== false;
