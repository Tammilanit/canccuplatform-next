-- Additive: where a finished sign-in sends the browser (#227, docs/plans/issue-188.md Q2). Kept
-- with the flow's state on the server, never read from the callback URL, so a crafted callback
-- cannot redirect anywhere. NULL is admin's own start page, as before.
ALTER TABLE admin_sign_in_flows ADD COLUMN IF NOT EXISTS return_path text;
