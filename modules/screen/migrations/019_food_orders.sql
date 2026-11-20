-- The food box's orders (contracts/screen.md, Widgets, `food_status`; #643): each pizza order's
-- event-wide part, kept from `pizza.order.*` and `pizza.item.*` and composed into the zones that
-- show the box. Additive. `revision` is the order's own (it grows with every change, a pizza's
-- too), so an event that comes twice or late changes nothing; a done or cancelled order keeps
-- its row (`over`) so an older event cannot bring it back.
CREATE TABLE screen_food_orders (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  order_id text NOT NULL,
  revision integer NOT NULL,
  over boolean NOT NULL DEFAULT false,
  "order" jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id)
);

ALTER TABLE screen_food_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_food_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_food_orders USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_food_orders TO canccu_screen_app;
