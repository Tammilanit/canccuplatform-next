/** Pizzerias and menus per event (contracts/pizza.md, Pizzerias and menus; the menu CSV). */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { ErrorBody, SqlClient } from "@canccu/kit";
import { body, guestRead, notFound, ok, tenantOf, whoIs, write } from "./http.js";
import type { AppDeps, WriteCtx } from "./http.js";
import { newId } from "./ids.js";
import { guarded } from "./conflicts.js";
import { parseMenuCsv, writeMenuCsv } from "./menu-csv.js";
import type { Issue, MenuFile } from "./menu-csv.js";
import { applyMenu, menuInputOf, planMenu } from "./menus.js";
import type { MenuCounts } from "./menus.js";
import { NO_FACTS, authorize, may } from "./policy.js";
import type { Caller } from "./policy.js";
import { getPizzeria, listPizzerias, menuEntries } from "./store.js";
import type { MenuRow, PizzeriaRow } from "./store.js";
import {
  LIMITS,
  bad,
  optionalText,
  parseMenuBody,
  parseWebsite,
  requiredText,
} from "./validate.js";

type Params = { id: string };

/** The phone is for those who call: the crew and the menu writers (the holder sees it on the order). */
const seesPhone = (caller: Caller | null) =>
  may("menu.write", caller, NO_FACTS) || may("order.take_over", caller, NO_FACTS);

function menuView(entries: MenuRow[], hidden: boolean) {
  const line = (e: MenuRow) => ({
    id: e.id,
    ...(e.kind === "item" ? { number: e.number } : {}),
    name: e.name,
    description: e.description,
    price_cents: e.price_cents,
    // #789: an item's category, the own pizza's included toppings and extra price, a topping's tier.
    ...(e.kind === "item" ? { category: e.category } : {}),
    ...(e.kind === "base"
      ? { included_toppings: e.included_toppings, extra_topping_cents: e.extra_topping_cents }
      : {}),
    ...(e.kind === "topping" ? { tier: e.tier ?? "normal" } : {}),
    ...(hidden ? { hidden: e.hidden } : {}),
  });
  return {
    items: entries.filter((e) => e.kind === "item").map(line),
    base: ((b) => (b === undefined ? null : line(b)))(
      entries.find((e) => e.kind === "base" && !e.hidden),
    ),
    toppings: entries.filter((e) => e.kind === "topping").map(line),
  };
}

function pizzeriaView(p: PizzeriaRow, caller: Caller | null, entries?: MenuRow[], hidden = false) {
  return {
    id: p.id,
    name: p.name,
    website: p.website,
    service: p.service,
    ...(seesPhone(caller) ? { phone: p.phone } : {}),
    ...(p.hidden_at !== null ? { hidden: true } : {}),
    ...(entries === undefined ? {} : { menu: menuView(entries, hidden) }),
  };
}

function pizzeriaFields(b: Record<string, unknown>, current?: PizzeriaRow) {
  const has = (k: string) => b[k] !== undefined;
  const service = has("service") ? b.service : (current?.service ?? "delivery");
  if (service !== "delivery" && service !== "takeaway") bad("service", "delivery or takeaway");
  return {
    name:
      has("name") || current === undefined
        ? requiredText(b.name, "name", LIMITS.pizzeria)
        : current.name,
    phone: has("phone") ? optionalText(b.phone, "phone", LIMITS.phone) : (current?.phone ?? null),
    website: has("website") ? parseWebsite(b.website) : (current?.website ?? null),
    service: service as string,
  };
}

const exists = () =>
  new KitError("A pizzeria of that name is already here.", {
    status: 409,
    code: "pizzeria_exists",
  });

/** 400 `menu_csv_invalid` with every error by row and column; nothing was changed. */
class MenuCsvInvalid extends KitError {
  constructor(readonly errors: Issue[]) {
    super("The menu CSV has errors: nothing was imported.", {
      status: 400,
      code: "menu_csv_invalid",
    });
  }
  override toBody(): ErrorBody {
    return { error: { ...super.toBody().error, errors: this.errors } } as ErrorBody;
  }
}

function csvBody(request: FastifyRequest): MenuFile {
  if (!(request.headers["content-type"] ?? "").startsWith("text/csv")) {
    throw new KitError("Send the menu as text/csv.", {
      status: 415,
      code: "unsupported_media_type",
    });
  }
  return parseMenuCsv(typeof request.body === "string" ? request.body : "");
}

/** What an import would do, pizzeria by pizzeria, matched by name in any case. */
async function plan(c: SqlClient, file: MenuFile) {
  const existing = await listPizzerias(c);
  const out = [];
  for (const p of file.pizzerias) {
    const match = existing.find((e) => e.name.toLowerCase() === p.name.toLowerCase());
    const entries = match === undefined ? [] : await menuEntries(c, [match.id], true);
    out.push({ file: p, match, items: planMenu(entries, p.menu).items });
  }
  return out;
}

export function menuRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Querystring: { hidden?: string } }>("/api/pizza/pizzerias", async (request) => {
    const { caller } = await whoIs(deps, request);
    guestRead(request, caller);
    const hidden = request.query.hidden === "true";
    if (hidden) authorize("menu.read_hidden", caller, NO_FACTS);
    return deps.db.tenant(async (c) => ({
      pizzerias: (await listPizzerias(c, hidden)).map((p) => pizzeriaView(p, caller)),
    }));
  });

  app.get<{ Params: Params; Querystring: { hidden?: string } }>(
    "/api/pizza/pizzerias/:id",
    async (request) => {
      const { caller } = await whoIs(deps, request);
      guestRead(request, caller);
      const hidden = request.query.hidden === "true";
      if (hidden) authorize("menu.read_hidden", caller, NO_FACTS);
      return deps.db.tenant(async (c) => {
        const p = await getPizzeria(c, request.params.id);
        if (p === null || (p.hidden_at !== null && !hidden)) throw notFound("pizzeria");
        return pizzeriaView(p, caller, await menuEntries(c, [p.id], hidden), hidden);
      });
    },
  );

  const audit = (
    w: WriteCtx,
    action: string,
    id: string,
    changes: Record<string, { old: unknown; new: unknown }>,
  ) =>
    deps.audit({
      tenant_id: w.ctx.tenant_id,
      actor_user_id: w.caller.user_id,
      action,
      target: { type: "pizzeria", id },
      changes,
    });
  const counts = (prefix: string, n: MenuCounts) =>
    Object.fromEntries(
      (Object.entries(n) as [string, number][]).map(
        ([k, v]): [string, { old: null; new: number }] => [`${prefix}${k}`, { old: null, new: v }],
      ),
    );

  app.post("/api/pizza/pizzerias", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      authorize("menu.write", w.caller, NO_FACTS);
      const f = pizzeriaFields(body(request));
      const id = newId("pz");
      await guarded(
        c,
        () =>
          c.query(
            `INSERT INTO pizza_pizzerias (id, name, phone, website, service) VALUES ($1, $2, $3, $4, $5)`,
            [id, f.name, f.phone, f.website, f.service],
          ),
        exists,
      );
      await audit(w, "pizza.pizzeria.added", id, { name: { old: null, new: f.name } });
      return ok(pizzeriaView((await getPizzeria(c, id)) as PizzeriaRow, w.caller), 201);
    }),
  );

  app.patch<{ Params: Params }>("/api/pizza/pizzerias/:id", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      authorize("menu.write", w.caller, NO_FACTS);
      const p = await getPizzeria(c, request.params.id);
      if (p === null) throw notFound("pizzeria");
      const b = body(request);
      const f = pizzeriaFields(b, p);
      const hidden = b.hidden === undefined ? p.hidden_at !== null : b.hidden === true;
      await guarded(
        c,
        () =>
          c.query(
            `UPDATE pizza_pizzerias SET name = $2, phone = $3, website = $4, service = $5, updated_at = $6,
               hidden_at = CASE WHEN $7 THEN COALESCE(hidden_at, $6) END WHERE id = $1`,
            [p.id, f.name, f.phone, f.website, f.service, w.now, hidden],
          ),
        exists,
      );
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      for (const k of ["name", "phone", "website", "service"] as const)
        if (p[k] !== f[k]) changes[k] = { old: p[k], new: f[k] };
      if ((p.hidden_at !== null) !== hidden)
        changes.hidden = { old: p.hidden_at !== null, new: hidden };
      await audit(w, "pizza.pizzeria.changed", p.id, changes);
      return ok(pizzeriaView((await getPizzeria(c, p.id)) as PizzeriaRow, w.caller));
    }),
  );

  app.put<{ Params: Params }>("/api/pizza/pizzerias/:id/menu", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      authorize("menu.write", w.caller, NO_FACTS);
      const p = await getPizzeria(c, request.params.id);
      if (p === null) throw notFound("pizzeria");
      const n = await applyMenu(c, p.id, parseMenuBody(body(request)), w.now);
      await audit(w, "pizza.menu.replaced", p.id, counts("items_", n));
      return ok(pizzeriaView(p, w.caller, await menuEntries(c, [p.id])));
    }),
  );

  app.post("/api/pizza/menu/import/preview", async (request) => {
    const { caller } = await whoIs(deps, request);
    authorize("menu.write", caller, NO_FACTS);
    tenantOf(request);
    const file = csvBody(request);
    return deps.db.tenant(async (c) => ({
      errors: file.errors,
      warnings: file.warnings,
      pizzerias: (await plan(c, file)).map((p) => ({
        name: p.match?.name ?? p.file.name,
        status: p.match === undefined ? "new" : "matched",
        items: p.items,
        base: p.file.menu.base?.name ?? null,
        toppings: p.file.menu.toppings.length,
      })),
    }));
  });

  app.post("/api/pizza/menu/import", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      authorize("menu.write", w.caller, NO_FACTS);
      const file = csvBody(request);
      if (file.errors.length > 0) throw new MenuCsvInvalid(file.errors);
      const total = { added: 0, updated: 0, hidden: 0 };
      let added = 0;
      for (const p of await plan(c, file)) {
        let id = p.match?.id;
        if (id === undefined) {
          id = newId("pz");
          added++;
          await c.query(
            `INSERT INTO pizza_pizzerias (id, name, phone, website, service) VALUES ($1, $2, $3, $4, $5)`,
            [id, p.file.name, p.file.phone, p.file.website, p.file.service ?? "delivery"],
          );
        } else {
          // Fields the file leaves empty stay as they are.
          await c.query(
            `UPDATE pizza_pizzerias SET phone = COALESCE($2, phone), website = COALESCE($3, website),
               service = COALESCE($4, service), updated_at = $5 WHERE id = $1`,
            [id, p.file.phone, p.file.website, p.file.service, w.now],
          );
        }
        const n = await applyMenu(c, id, p.file.menu, w.now);
        for (const k of ["added", "updated", "hidden"] as const) total[k] += n[k];
      }
      await deps.audit({
        tenant_id: w.ctx.tenant_id,
        actor_user_id: w.caller.user_id,
        action: "pizza.menu.imported",
        target: { type: "menu", id: "import" },
        changes: { pizzerias_added: { old: null, new: added }, ...counts("items_", total) },
      });
      return ok({
        pizzerias: file.pizzerias.length,
        pizzerias_added: added,
        items: total,
        warnings: file.warnings,
      });
    }),
  );

  app.get<{ Querystring: { pizzeria_id?: string } }>(
    "/api/pizza/menu.csv",
    async (request, reply) => {
      const { caller } = await whoIs(deps, request);
      authorize("menu.write", caller, NO_FACTS);
      const csv = await deps.db.tenant(async (c) => {
        const all = await listPizzerias(c);
        const chosen =
          request.query.pizzeria_id === undefined
            ? all
            : all.filter((p) => p.id === request.query.pizzeria_id);
        if (chosen.length === 0 && request.query.pizzeria_id !== undefined)
          throw notFound("pizzeria");
        const entries = await menuEntries(
          c,
          chosen.map((p) => p.id),
        );
        return writeMenuCsv(
          chosen.map((p) => ({
            name: p.name,
            phone: p.phone,
            website: p.website,
            service: p.service,
            menu: menuInputOf(entries.filter((e) => e.pizzeria_id === p.id)),
          })),
        );
      });
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="menu.csv"')
        .send(csv);
    },
  );
}
