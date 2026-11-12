-- The zone options `hero_region` and `grow_for_showcase` (contracts/screen.md, The hero role and the
-- showcase; #404). Additive: existing zones get the contract's defaults, null (no trade) and true.
-- `hero_region` is not checked against a layout: an unknown id is kept, so a zone survives a layout change.
ALTER TABLE screen_zones ADD COLUMN hero_region text
  CONSTRAINT screen_zones_hero_region CHECK (hero_region ~ '^[a-z][a-z0-9_-]{0,31}$');
ALTER TABLE screen_zones ADD COLUMN grow_for_showcase boolean NOT NULL DEFAULT true;
