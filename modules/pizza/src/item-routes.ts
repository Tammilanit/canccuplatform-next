/** The pizzas in an order (contracts/pizza.md, Pizzas): add, change, remove and hand out. */
import type { FastifyInstance } from "fastify";
import type { SqlClient } from "@canccu/kit";
import { body, notFound, ok, write } from "./http.js";
import type { AppDeps, WriteCtx } from "./http.js";
import {
  EDITABLE_BY_HOLDER,
  EDITABLE_BY_OWNER,
  addItem,
  editItem,
  handOut,
  handOutAll,
  removeItem,
} from "./items.js";
import { authorize } from "./policy.js";
import type { Action, As } from "./policy.js";
import { facts, orderFor, present } from "./present.js";
import { getItem, getOrder, liveMenu } from "./store.js";
import type { ItemRow, OrderRow } from "./store.js";
import { itemView } from "./views.js";
import { parseItemBody, snapshotOf } from "./validate.js";

type Params = { id: string };

async function itemFor(
  c: SqlClient,
  w: WriteCtx,
  id: string,
  action: Action,
): Promise<{ item: ItemRow; order: OrderRow; as: As }> {
  const item = await getItem(c, id);
  if (item === null) throw notFound("pizza");
  const order = await getOrder(c, item.order_id);
  if (order === null) throw notFound("pizza");
  return { item, order, as: authorize(action, w.caller, facts(w.ctx, w.now, order, item)).as };
}

export function itemRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post<{ Params: Params }>("/api/pizza/orders/:id/items", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const { order } = await orderFor(c, request.params.id, "item.add", w.caller, w.ctx, w.now);
      const menu = await liveMenu(c, order.pizzeria_id);
      const input = parseItemBody(body(request), menu);
      const settings = await deps.settings(w.ctx.tenant_id);
      const actor = { user_id: w.session.userId, name: w.session.userName };
      const { item } = await addItem(
        w.step(c),
        actor,
        order.id,
        input,
        snapshotOf(input, menu),
        settings.max_items_per_person,
        order.pizzeria_id,
      );
      return ok(itemView(item, w.caller, false), 201);
    }),
  );

  app.put<{ Params: Params }>("/api/pizza/items/:id", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const { item, order, as } = await itemFor(c, w, request.params.id, "item.edit");
      const menu = await liveMenu(c, order.pizzeria_id);
      const input = parseItemBody(body(request), menu);
      const actor = { user_id: w.session.userId, name: w.session.userName };
      const from = as === "owner" ? EDITABLE_BY_OWNER : EDITABLE_BY_HOLDER;
      const { after } = await editItem(
        w.step(c),
        actor,
        item,
        from,
        input,
        snapshotOf(input, menu),
        order.pizzeria_id,
      );
      if (as !== "owner") {
        await deps.audit({
          tenant_id: w.ctx.tenant_id,
          actor_user_id: w.caller.user_id,
          action: "pizza.item.changed",
          target: { type: "item", id: item.id },
          changes: {
            label: { old: item.label, new: after.label },
            note: { old: item.note, new: after.note },
          },
        });
      }
      return ok(itemView(after, w.caller, as !== "owner"));
    }),
  );

  app.delete<{ Params: Params }>("/api/pizza/items/:id", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const { item, as } = await itemFor(c, w, request.params.id, "item.remove");
      const actor = { user_id: w.session.userId, name: w.session.userName };
      await removeItem(
        w.step(c),
        actor,
        item,
        as === "owner" ? EDITABLE_BY_OWNER : EDITABLE_BY_HOLDER,
      );
      if (as !== "owner") {
        await deps.audit({
          tenant_id: w.ctx.tenant_id,
          actor_user_id: w.caller.user_id,
          action: "pizza.item.removed",
          target: { type: "item", id: item.id },
          changes: { label: { old: item.label, new: null } },
        });
      }
      return ok(null, 204);
    }),
  );

  app.post<{ Params: Params }>("/api/pizza/items/:id/hand-out", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const { item } = await itemFor(c, w, request.params.id, "item.hand_out");
      await handOut(w.step(c), item, body(request).handed_out !== false);
      return ok(
        await present(c, w.caller, w.ctx, w.now, (await getOrder(c, item.order_id)) as OrderRow),
      );
    }),
  );

  app.post<{ Params: Params }>("/api/pizza/orders/:id/hand-out", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const { order } = await orderFor(
        c,
        request.params.id,
        "order.hand_out",
        w.caller,
        w.ctx,
        w.now,
      );
      const m = await handOutAll(w.step(c), order.id);
      return ok(await present(c, w.caller, w.ctx, w.now, m.row));
    }),
  );
}
