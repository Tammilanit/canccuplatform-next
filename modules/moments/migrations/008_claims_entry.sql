-- Claims reports ordered by their stream entry (#657). Additive: two nullable columns.
-- Screen's replicas mint event ids on their own clocks, so UUIDv7 order is not the order of
-- Screen's stream; the entry id (`<ms>-<seq>`) is, and compares as two numbers. A mark written
-- before this has none: the next report is compared with it by event id, once.
ALTER TABLE moments_claims_marks
  ADD COLUMN claims_entry_ms bigint,
  ADD COLUMN claims_entry_seq bigint;
