-- How many slides the running attempt of a render job has drawn, so Studio shows a deck render
-- slide by slide (#263). Additive. Screen's own: the contract's RenderJob does not carry it.
ALTER TABLE screen_render_jobs ADD COLUMN slides_done integer NOT NULL DEFAULT 0;
