-- Money and receipts (#644; contracts/pizza.md, Money, Receipts, The AI reader): additive only.

-- Who set the order's total and when, and the receipt whose read it confirmed (NULL: typed in).
ALTER TABLE pizza_orders ADD COLUMN total_set_at timestamptz;
ALTER TABLE pizza_orders ADD COLUMN total_set_by_name text;
ALTER TABLE pizza_orders ADD COLUMN total_receipt_id text;

-- Receipt photos, kept in the files volume (`/files/<tenant>/pizza/receipts/<id>.<ext>`) with their
-- location data stripped. `read` is the last machine read: a suggestion, never the order's money.
CREATE TABLE pizza_receipts (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  order_id text NOT NULL,
  file text NOT NULL,
  type text NOT NULL CHECK (type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer NOT NULL,
  added_at timestamptz NOT NULL,
  added_by_user_id text,
  added_by_name text,
  read jsonb,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES pizza_orders (tenant_id, id)
);
CREATE INDEX pizza_receipts_order ON pizza_receipts (tenant_id, order_id, added_at);

-- The holder's "paid me" memo per person (U12 A): only for an order that settles to its payer.
CREATE TABLE pizza_paid (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  order_id text NOT NULL,
  user_id text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, order_id, user_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES pizza_orders (tenant_id, id)
);

-- How to pay a payer ("Pay me with"), kept per person so it is offered again next time.
CREATE TABLE pizza_pay_details (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  user_id text NOT NULL,
  mobilepay text,
  iban text,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

-- The AI reader's provider key (Admin → Integrations): sealed with the platform's secrets key,
-- bound to its event, never returned. One per event.
CREATE TABLE pizza_reader_keys (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  provider text NOT NULL,
  sealed text NOT NULL,
  last4 text NOT NULL,
  set_at timestamptz NOT NULL,
  set_by_user_id text,
  set_by_name text,
  last_used_at timestamptz,
  -- The provider refused the key: the reader stops until a key is set again (no retry loop).
  rejected_at timestamptz,
  PRIMARY KEY (tenant_id)
);

-- Every call to the provider, for the daily cap and the month's count; no photo and no answer.
CREATE TABLE pizza_reads (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id bigint GENERATED ALWAYS AS IDENTITY,
  at timestamptz NOT NULL,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receipt', 'menu')),
  outcome text NOT NULL CHECK (outcome IN ('ok', 'failed', 'rejected')),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX pizza_reads_day ON pizza_reads (tenant_id, day);

ALTER TABLE pizza_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_receipts USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_paid ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_paid FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_paid USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_pay_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_pay_details FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_pay_details USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_reader_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_reader_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_reader_keys USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pizza_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pizza_reads USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON pizza_receipts, pizza_paid, pizza_pay_details, pizza_reader_keys, pizza_reads TO canccu_pizza_app;
