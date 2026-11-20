# pizza

The pizza module serves [contracts/pizza.md](../../contracts/pizza.md): the event's group food orders, their lifecycle and rights, pizzerias and menus, money on the order, the menu CSV and the export for the payment system (#117, the [step 5 plan](../../docs/briefs/step-5-pizza.md#plan)). The scheduler and the pages come with #118 and #119.

## How it works

- **Tenancy:** each request's event comes from its `Host` (the kit's `installTenancy`). Every table is per tenant under RLS; work runs as `canccu_pizza_app`. The global `pizza_tenants` lists the events pizza has served (a deleted user is forgotten in each) and `pizza_outbox_tenants` the events with unsent events.
- **The lifecycle** (`lifecycle.ts`, `items.ts`): an order is a row in `pizza_orders` from open to done or cancelled. Every step is one conditional `UPDATE … WHERE state = ANY(…)` in the request's transaction, which also reads what the row was (`FOR UPDATE`): of two racing requests one changes the row, the other finds it moved on and is told why (`conflicts.ts`), or, for a step already taken, gets the order back without a second event. Opening is serialised per event by an advisory lock (the event's count and the day's numbers); a pizza's write first bumps its order's revision, which takes the order's row lock and checks its state in one step. Partial unique indexes back one open order per pizzeria and one held per person. `scheduled()` is the module's own steps (actor null) for #118's scheduler.
- **Idempotency** (`idempotency.ts`): every write carries an `Idempotency-Key`; its row is written in the write's transaction, so a retry waits on the first and reads its answer (E2).
- **Events** (`events.ts`): stored in `pizza_outbox` in the write's transaction and sent after it commits (the kit's `Outbox`; a loop resends what a failed send left, every 2 s). The Person's Discord id comes from `GET /internal/tenants/users/{user_id}`, cached a few minutes; `null` when the tenants module does not answer (E13).
- **Rights and visibility** (`policy.ts`, `views.ts`, `present.ts`): `authorize(action, caller, facts)` lists every action of step 5 with who may take it and through what; a crew right counts only where admin is reachable. Each read is drawn for its caller: a guest, a member or the holder and crew (D9). Membership is read in `people.ts`; until the tenants module serves it (#150) every signed-in session on the event's hostname counts, as in agenda and notify.
- **Menus** (`menus.ts`, `menu-csv.ts`, `validate.ts`): one plan for the JSON menu, the menu CSV and the profile; the preview runs it without writing.
- **Money** (`money.ts`, `money-routes.ts`): each person's amount by the largest remainder; changes once an order is closed are audited and tell the people whose amount moved.
- **The record and the export** (`record.ts`, `export-csv.ts`, `record-routes.ts`); **privacy** (`privacy.ts`, `consumer.ts`): the export and delete, the 12-month anonymisation, deleted users and events, a member who left, clone.
- **Audit** (`audit.ts`): entries go to the tenants module in the request that made the change, before it commits.

## Environment

`CANCCU_DATABASE_URL`, `CANCCU_MIGRATE_DATABASE_URL` (the migration role), `CANCCU_TENANTS_URL`, plus the kit's `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL`, `CANCCU_SERVICE_KEY`. Optional: `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME`, `CANCCU_IP_MODE=demo` (only with version `dev`).

Through Caddy: `/api/pizza/health` and the contract's `/api/pizza/…` paths.

## Check

```sh
npm ci && npm run lint && npm run typecheck && npm test
```

The tests need a real Postgres, because RLS cannot be faked; without `CANCCU_DATABASE_URL` they are skipped. They drop and recreate the module's tables, so they refuse a database whose name does not end in `_test` ([docs/ci.md](../../docs/ci.md#modules)). The ported legacy tests are the spec: `orders.test.ts` and `cancel.test.ts` (`pizza-orders`), `items.test.ts` (`pizza-routes`), `system.test.ts` (`pizza-db`), `validate.test.ts`, `summary.test.ts` (`pizza-summary`, `pizza-menu-filter`) and `record.test.ts` (`pizza-report`). `ci/stack-smoke.sh` checks the module on the running stack.
