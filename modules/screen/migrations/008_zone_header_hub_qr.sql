-- The zone options `header` and `hub_qr` (contracts/screen.md, Header and hub QR; #349). Additive:
-- existing zones get the contract's defaults, null (the layout's own, else `separate`) and `always`.
ALTER TABLE screen_zones ADD COLUMN header text
  CONSTRAINT screen_zones_header CHECK (header IN ('separate', 'shared'));
ALTER TABLE screen_zones ADD COLUMN hub_qr text NOT NULL DEFAULT 'always'
  CONSTRAINT screen_zones_hub_qr CHECK (hub_qr IN ('always', 'rotate'));
