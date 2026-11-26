-- Announcements by level and placement (#780; contracts/moments.md, Levels, placement and the full
-- screen). Additive: three nullable columns, and a backfill that changes no meaning.

-- Where the card shows (`rail`, `hero`, `full`); `full_screen` stays, true exactly when it is `full`.
ALTER TABLE moments_announcements ADD COLUMN placement text;
-- The composer's icon; null reads as `info`.
ALTER TABLE moments_announcements ADD COLUMN icon text;
ALTER TABLE moments_announcement_templates ADD COLUMN icon text;

-- The rows stored before this keep the chain they had: `full` where it was full screen, else the
-- rail (an urgent one there keeps its old rail, hero, ticker chain; src/announce/chain.ts).
UPDATE moments_announcements
  SET placement = CASE WHEN full_screen THEN 'full' ELSE 'rail' END
  WHERE placement IS NULL;
