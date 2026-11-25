-- #789 item 8: the even-share limit (the menu's average × 1.3, to 10 cents), stored when the order
-- is called in, so a later menu edit does not move anyone's amount. Null until then, or when the
-- menu had no price at the call-in: the limit is then worked out from the menu as it is (D17).
-- A column only (additive). Up to 1.3 × the highest price a menu item can have.
-- After a revert the column and the ledger row stay (the kit skips a name already in the ledger): a
-- re-land with a changed body needs a new migration name, or an explicit DROP COLUMN migration.
ALTER TABLE pizza_orders
  ADD COLUMN even_limit_cents integer CHECK (even_limit_cents BETWEEN 0 AND 130000);
