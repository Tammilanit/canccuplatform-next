-- DESTRUCTIVE (AGENTS.md, Migrations; needs the maintainer's accept): drops the single-event
-- tables admin_settings and admin_profile, the contract step of 001's expand and contract
-- (0013 item 22). Nothing has read or written them since 001; their rows belong to no tenant, and
-- loading an event's profile again restores its settings. A stack set up after 001 never had
-- them, hence IF EXISTS.
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS admin_settings;
DROP TABLE IF EXISTS admin_profile;
