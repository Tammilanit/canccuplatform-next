-- Screen's placements caught up after a restart (#611, E2). Additive: one nullable column.
-- The id of the newest `screen.claims.changed` applied on the zone: the replay of Screen's stream
-- at boot applies only newer ones, those the live subscription missed while Moments was down.
ALTER TABLE moments_zones ADD COLUMN claims_event_id text;
