-- The zone's pinned energy level (contracts/screen.md, Motion and burn-in drift; #445). Additive:
-- existing zones get null, the contract's default (the event's level, moved by the day).
ALTER TABLE screen_zones ADD COLUMN motion_level text
  CONSTRAINT screen_zones_motion_level CHECK (motion_level IN ('none', 'calm', 'lively', 'party'));
