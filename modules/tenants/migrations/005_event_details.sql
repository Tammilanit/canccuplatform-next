-- What the Event page sets beside the name (#782 part B, contracts/tenants.md, Current event): a
-- short name for narrow screens, the poster text, the event's contact person (one of the people
-- with a role, by user id) and the venue's street address. Additive: every column has an empty
-- default, so old events read as before.
ALTER TABLE tenants ADD COLUMN short_name text NOT NULL DEFAULT ''
  CHECK (char_length(short_name) <= 24);
ALTER TABLE tenants ADD COLUMN description text NOT NULL DEFAULT ''
  CHECK (char_length(description) <= 500);
ALTER TABLE tenants ADD COLUMN contact_user_id text;
ALTER TABLE venue_info ADD COLUMN address text NOT NULL DEFAULT ''
  CHECK (char_length(address) <= 300);
