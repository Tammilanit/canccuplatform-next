-- Additive (step 6, #852, #122 link 4: living messages; contracts/bot.md, Living messages).
--
-- The living messages share `bot_posts` with the announcement post (D6 of
-- docs/plans/issue-122.md): kind `board` (key `board`, the pinned now-and-next board) and kind
-- `food_order` (key: the order's id), plus `run_of_show` (key: the source event's id) for the
-- one-off run-of-show posts, kept only so each is posted once.
--
-- `state` is what a food order's message shows, taken from the pizza events: counts, times,
-- the pizzeria's and the holder's names (L9), never anyone else and no user or Discord id.
-- `version` grows with every change any container records; the editor (in the container that
-- holds the event's client) shows a version and writes it to `shown_version`, so a change that
-- lands while it edits is never lost. `shown_hash` and `edited_at` keep edits to what changed
-- and at most one a minute per channel; `verify` asks the editor to check after a gap that the
-- message is still there (and pinned, for the board). The rows still go with the binding.
ALTER TABLE bot_posts ADD COLUMN IF NOT EXISTS state jsonb;
ALTER TABLE bot_posts ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;
ALTER TABLE bot_posts ADD COLUMN IF NOT EXISTS shown_version bigint NOT NULL DEFAULT 0;
ALTER TABLE bot_posts ADD COLUMN IF NOT EXISTS shown_hash text;
ALTER TABLE bot_posts ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE bot_posts ADD COLUMN IF NOT EXISTS verify boolean NOT NULL DEFAULT false;
