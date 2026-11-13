-- The schedule calendar names the run-of-show item a bound window follows, and hides a crew-only
-- item's id from callers without `agenda.crew.read` (contracts/screen.md, Schedule windows).
-- Additive: rows kept before this fill on the next event for the item, or when the stream's
-- replay at start re-applies its last one (src/content/agenda.ts).
ALTER TABLE screen_agenda_items ADD COLUMN title text;
ALTER TABLE screen_agenda_items ADD COLUMN visibility text;
