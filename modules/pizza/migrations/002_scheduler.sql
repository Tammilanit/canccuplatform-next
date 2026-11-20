-- The scheduler of #118 (contracts/pizza.md, The scheduler): additive only.

-- One row per due step of an order (O2): written by the tick from the order and the event's
-- settings, taken FOR UPDATE SKIP LOCKED, and marked sent in the transaction that took the step
-- and stored its events in the outbox. A sent row stays, so a step runs at most once per order.
CREATE TABLE pizza_due (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  order_id text NOT NULL,
  step text NOT NULL,
  due_at timestamptz NOT NULL,
  sent_at timestamptz,
  -- Passed over: too late to be news, or a later step of its kind was due too (the legacy rule).
  skipped boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, order_id, step),
  FOREIGN KEY (tenant_id, order_id) REFERENCES pizza_orders (tenant_id, id)
);
CREATE INDEX pizza_due_pending ON pizza_due (tenant_id, due_at) WHERE sent_at IS NULL;

-- Who the scheduler tells as "the crew": members whose session showed `pizza.order.manage` when
-- they last used pizza. No module answers who holds a right, so pizza keeps what it has seen.
CREATE TABLE pizza_crew (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  user_id text NOT NULL,
  seen_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

-- The hand-out nudge goes once per order (D12).
ALTER TABLE pizza_orders ADD COLUMN nudged_at timestamptz;

ALTER TABLE pizza_due ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_due FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_due USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_crew ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_crew FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_crew USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON pizza_due, pizza_crew TO canccu_pizza_app;
