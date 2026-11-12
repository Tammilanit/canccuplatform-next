-- Quiet changes (#388): the reminders that have fired, so that after a change made with
-- `announce: false` a reminder that already fired does not fire again (contracts/agenda.md,
-- Reminders). A fired timer row is deleted, so this is the only record of it. Additive: one table.
CREATE TABLE IF NOT EXISTS agenda_reminders_fired (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  item_id text NOT NULL,
  lead_minutes integer NOT NULL,
  PRIMARY KEY (tenant_id, item_id, lead_minutes)
);
-- No foreign key to agenda_items, on purpose: the timer loop writes here while a writer may hold
-- the item's row lock and wait for the loop's timer rows, and a foreign key's check would make the
-- loop wait for that row lock in turn (a deadlock). A removed item's rows are never read again.

ALTER TABLE agenda_reminders_fired ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_reminders_fired FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_reminders_fired USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT ON agenda_reminders_fired TO canccu_agenda_app;
