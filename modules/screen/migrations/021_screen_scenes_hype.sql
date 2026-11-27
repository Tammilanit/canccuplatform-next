-- The hype Moments sends with each zone's scene (contracts/screen.md, Motion and burn-in drift;
-- #787 D12, D13). Additive: null until Moments sends one, which keeps the level as before. Kept
-- beside `scene`, as a zone with no scene still has a hype.
ALTER TABLE screen_scenes ADD COLUMN hype jsonb;
