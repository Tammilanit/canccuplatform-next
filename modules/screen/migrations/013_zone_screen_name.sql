-- The zone option `screen_name` (contracts/screen.md, Header and hub QR; #443). Additive: existing
-- zones get the contract's default, `auto` (the name shows while the event has two or more screens).
ALTER TABLE screen_zones ADD COLUMN screen_name text NOT NULL DEFAULT 'auto'
  CONSTRAINT screen_zones_screen_name CHECK (screen_name IN ('auto', 'always', 'never'));
