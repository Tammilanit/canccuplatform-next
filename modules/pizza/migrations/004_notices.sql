-- The notices to the people in an order (#703; contracts/pizza.md, Notices): additive only.

-- The order's last money change: "your share is ready" waits a few minutes after it, so the holder
-- finishes the total, the split and who is paid before anyone is told.
ALTER TABLE pizza_orders ADD COLUMN money_changed_at timestamptz;
-- When "your share is ready" went out: only later changes are news to the people in the order.
ALTER TABLE pizza_orders ADD COLUMN shares_sent_at timestamptz;
