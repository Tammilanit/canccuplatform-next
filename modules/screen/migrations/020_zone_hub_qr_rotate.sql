-- The hub QR takes turns by default (contracts/screen.md, Header and hub QR; #787 D14). Additive:
-- a new zone, and a POST or PUT that leaves `hub_qr` out, get `rotate`. No row changes: 008 wrote
-- `always` into every zone, so a zone that never chose cannot be told from one that chose it, and
-- rewriting stored choices is a maintainer's call; an organiser switches an old zone in Studio.
ALTER TABLE screen_zones ALTER COLUMN hub_qr SET DEFAULT 'rotate';
