-- Pairing is the trust: a paired screen plays from anywhere unless the event lets screens play
-- only on the venue's network (contracts/tenants.md, Screen access; #783). Additive: every event,
-- old or new, starts with the default, since no event could choose before.
ALTER TABLE tenants ADD COLUMN screen_access text NOT NULL DEFAULT 'internet'
  CHECK (screen_access IN ('internet', 'restricted'));
