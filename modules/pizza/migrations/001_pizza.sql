-- The pizza module's tables (contracts/pizza.md). Requests run as canccu_pizza_app (SET LOCAL
-- ROLE), which RLS binds on every tenant table. Runs once: kit-ts runMigrations records it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_pizza_app') THEN
    CREATE ROLE canccu_pizza_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Pizzerias per event (D11). Never deleted: hidden, so old orders keep theirs (D17).
CREATE TABLE pizza_pizzerias (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  name text NOT NULL,
  phone text,
  website text,
  service text NOT NULL DEFAULT 'delivery' CHECK (service IN ('delivery', 'takeaway')),
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX pizza_pizzerias_name ON pizza_pizzerias (tenant_id, lower(name))
  WHERE hidden_at IS NULL;

-- A pizzeria's menu: items by number, the own pizza's base, its toppings. Hidden, never deleted,
-- when a menu drops them (the legacy rule); ordered rows keep their own snapshot (D15).
CREATE TABLE pizza_menu_entries (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  pizzeria_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('item', 'base', 'topping')),
  number text,
  name text NOT NULL,
  description text,
  price_cents integer CHECK (price_cents BETWEEN 0 AND 99999),
  position integer NOT NULL DEFAULT 0,
  hidden_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, pizzeria_id) REFERENCES pizza_pizzerias (tenant_id, id) ON DELETE CASCADE,
  CHECK ((kind = 'item') = (number IS NOT NULL))
);
CREATE UNIQUE INDEX pizza_menu_entries_number ON pizza_menu_entries (tenant_id, pizzeria_id, number)
  WHERE kind = 'item' AND hidden_at IS NULL;
CREATE UNIQUE INDEX pizza_menu_entries_base ON pizza_menu_entries (tenant_id, pizzeria_id)
  WHERE kind = 'base' AND hidden_at IS NULL;
CREATE UNIQUE INDEX pizza_menu_entries_topping ON pizza_menu_entries (tenant_id, pizzeria_id, lower(name))
  WHERE kind = 'topping' AND hidden_at IS NULL;

-- One row per group order, from open to done or cancelled; every transition is one conditional
-- UPDATE of this row (E1). People's names are kept as they were then, and anonymised by retention.
CREATE TABLE pizza_orders (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  -- The event day (D4): it turns at 06:00 in the event's time zone.
  day date NOT NULL,
  seq integer NOT NULL,
  pizzeria_id text NOT NULL,
  -- As ordered: a later rename of the pizzeria does not rewrite the record.
  pizzeria_name text NOT NULL,
  state text NOT NULL CHECK (state IN ('open', 'closed', 'placed', 'arrived', 'done', 'cancelled')),
  closes_at timestamptz NOT NULL,
  note text,
  opened_at timestamptz NOT NULL,
  opened_by_user_id text,
  holder_user_id text,
  holder_name text,
  claimed_at timestamptz,
  closed_at timestamptz,
  placed_at timestamptz,
  estimate_at timestamptz,
  arrived_at timestamptz,
  pickup text,
  done_at timestamptz,
  done_reason text CHECK (done_reason IN ('handed_out', 'holder', 'timer')),
  cancelled_at timestamptz,
  cancel_reason text,
  cancelled_by_user_id text,
  auto_released boolean NOT NULL DEFAULT false,
  -- Money, in the API only (never on the bus).
  payer_user_id text,
  payer_name text,
  total_cents integer CHECK (total_cents BETWEEN 0 AND 500000),
  -- NULL: exact when every pizza has a price, otherwise even.
  split text CHECK (split IN ('exact', 'even')),
  settle_to text NOT NULL DEFAULT 'organiser' CHECK (settle_to IN ('organiser', 'payer')),
  revision integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, pizzeria_id) REFERENCES pizza_pizzerias (tenant_id, id),
  UNIQUE (tenant_id, day, seq)
);
-- One open order per pizzeria (D1), and one held per person (E14): the backstops of the checks.
CREATE UNIQUE INDEX pizza_orders_one_open ON pizza_orders (tenant_id, pizzeria_id)
  WHERE state IN ('open', 'closed');
CREATE UNIQUE INDEX pizza_orders_one_held ON pizza_orders (tenant_id, holder_user_id)
  WHERE state IN ('open', 'closed') AND holder_user_id IS NOT NULL;
CREATE INDEX pizza_orders_day ON pizza_orders (tenant_id, day, seq);

-- A person's pizzas, each with what was ordered as it was then (D15).
CREATE TABLE pizza_items (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  -- The order rows were added in; two added in the same instant still keep theirs.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  order_id text NOT NULL,
  -- NULL once anonymised: the row still counts.
  user_id text,
  name text,
  kind text NOT NULL CHECK (kind IN ('menu', 'custom', 'text')),
  menu_item_id text,
  number text,
  label text NOT NULL,
  description text,
  toppings jsonb,
  text text,
  note text,
  comment text,
  price_cents integer CHECK (price_cents BETWEEN 0 AND 99999),
  handed_out_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES pizza_orders (tenant_id, id)
);
CREATE INDEX pizza_items_order ON pizza_items (tenant_id, order_id, seq);
CREATE INDEX pizza_items_user ON pizza_items (tenant_id, user_id);

-- The order's own history (D16; the legacy pizza_order_log).
CREATE TABLE pizza_order_log (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id bigint GENERATED ALWAYS AS IDENTITY,
  order_id text NOT NULL,
  at timestamptz NOT NULL,
  -- NULL: the module itself (the scheduler, an archive).
  actor_user_id text,
  actor_name text,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES pizza_orders (tenant_id, id)
);
CREATE INDEX pizza_order_log_order ON pizza_order_log (tenant_id, order_id, id);

-- Idempotent writes (E2): a key's answer for 24 hours.
CREATE TABLE pizza_idempotency (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  user_id text NOT NULL,
  key text NOT NULL,
  at timestamptz NOT NULL,
  status integer,
  body jsonb,
  PRIMARY KEY (tenant_id, user_id, key)
);

-- The kit's outbox (E12): events stored in the write's transaction, sent after it commits.
CREATE TABLE pizza_outbox (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event text NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

ALTER TABLE pizza_pizzerias ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_pizzerias FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_pizzerias USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_menu_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_menu_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_menu_entries USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_orders USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_items FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_items USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_order_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_order_log FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_order_log USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_idempotency USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_outbox USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox TO canccu_pizza_app;

-- Global: the events with pending outbox rows, so the sender finds them without a tenant set.
CREATE TABLE pizza_outbox_tenants (
  tenant_id text PRIMARY KEY
);
-- Global: every event pizza has served, so a deleted user is forgotten in each of them.
CREATE TABLE pizza_tenants (
  tenant_id text PRIMARY KEY
);
GRANT SELECT, INSERT, UPDATE, DELETE ON pizza_outbox_tenants, pizza_tenants TO canccu_pizza_app;
