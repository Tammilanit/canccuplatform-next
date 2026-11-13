-- What the front-door screenshots (scripts/demo-screenshots-front.mjs) need and the CI stack has
-- no API for: people who signed in (admin's sign-in needs Discord, which CI cannot run), a session
-- without a role, and events before, after and away from their venue. Run by
-- scripts/demo-screenshots as the database superuser, after the first pass, on the CI stack only.
-- Superuser writes bypass RLS, so `tenant_id` is given, as deploy/compose.ci.yml's seed does.
BEGIN;

-- People (#437): 38 players, a long name, and Player Zero, who signed in a minute ago and has no
-- role yet. Last here spreads over the past day; a few are admins.
INSERT INTO admin_users (id, discord_id, name, handle, created_at, last_seen_at)
  SELECT 'u_demo_' || lpad(n::text, 2, '0'), 'demo-' || n, 'Player ' || n, 'player.' || n,
         now() - interval '2 days', now() - n * interval '37 minutes'
  FROM generate_series(1, 38) AS n
  ON CONFLICT (discord_id) DO NOTHING;
INSERT INTO admin_users (id, discord_id, name, handle, created_at, last_seen_at) VALUES
  ('u_demo_long', 'demo-long', 'Alexandria Vanderbilt-Montgomery of the Northern Crew',
   'alexandria.vanderbilt.montgomery', now(), now() - interval '30 minutes'),
  ('u_demo_new', 'demo-new', 'Player Zero', 'player.zero', now(), now() - interval '1 minute')
  ON CONFLICT (discord_id) DO NOTHING;
INSERT INTO admin_roles (user_id, role, granted_at)
  SELECT id, 'admin', now() FROM admin_users
  WHERE id IN ('u_demo_01', 'u_demo_02', 'u_demo_03', 'u_demo_04', 'u_demo_05', 'u_demo_long')
  ON CONFLICT (user_id) DO NOTHING;
-- The cookie canccu_session=demo-no-role (stored as its hash, as admin stores every session).
INSERT INTO admin_sessions (id_hash, user_id, created_at, last_seen_at, expires_at)
  VALUES (encode(sha256('demo-no-role'::bytea), 'hex'), 'u_demo_new', now(), now(),
          now() + interval '2 hours')
  ON CONFLICT (id_hash) DO UPDATE SET last_seen_at = now(), expires_at = now() + interval '2 hours';

-- Check-in (#441): the demo event's attendee network, whose password the done page shows.
UPDATE venue_info SET wifi = '[{"ssid": "demo-guest", "password": null, "note": null, "visibility": "public"}, {"ssid": "demo-attendees", "password": "demo-pass-2026", "note": null, "visibility": "attendees"}]'
  WHERE tenant_id = 'demo';

-- An archived event (sign-in's "Sign in to look back", check-in has closed), one that starts in
-- three days (check-in opens on …), and one whose venue is elsewhere (check in at the venue).
INSERT INTO venues (id, name, addresses, wifi)
  VALUES ('demo-elsewhere-venue', 'Demo Hall', '{192.0.2.0/24}',
          '[{"ssid": "demo-hall", "password": null, "note": null, "visibility": "public"}]')
  ON CONFLICT DO NOTHING;
INSERT INTO tenants (id, name, time_zone, venue_id, status, starts_at, ends_at) VALUES
  ('demo-archived', 'Demo Event', 'UTC', 'demo-venue', 'archived',
   now() - interval '30 days', now() - interval '29 days'),
  ('demo-soon', 'Demo Event', 'UTC', 'demo-venue', 'live',
   date_trunc('day', now()) + interval '3 days 17 hours', date_trunc('day', now()) + interval '4 days 22 hours'),
  ('demo-elsewhere', 'Demo Event', 'UTC', 'demo-elsewhere-venue', 'live', NULL, NULL)
  ON CONFLICT DO NOTHING;
INSERT INTO venue_info (tenant_id, venue_id, copied_at, revision, wifi)
  VALUES ('demo-elsewhere', 'demo-elsewhere-venue', now(), 1,
          '[{"ssid": "demo-hall", "password": null, "note": null, "visibility": "public"}]')
  ON CONFLICT DO NOTHING;
INSERT INTO hostnames (hostname, tenant_id, kind, status, is_primary) VALUES
  ('demo-archived.localhost', 'demo-archived', 'platform', 'active', true),
  ('demo-soon.localhost', 'demo-soon', 'platform', 'active', true),
  ('demo-elsewhere.localhost', 'demo-elsewhere', 'platform', 'active', true)
  ON CONFLICT DO NOTHING;
COMMIT;
