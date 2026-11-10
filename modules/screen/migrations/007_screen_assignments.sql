-- The per-event table `assignments` takes the module's prefix, `screen_assignments` (plan #107, D3;
-- #230). A rename only: rows, columns, keys, RLS, its policy and the grants go with the table, so
-- no data changes. The stack runs one screen container, and `compose up` stops the old one before
-- the new one migrates, so no running code names the old table. Keys and indexes are renamed too,
-- so no name of the old table is left behind.
ALTER TABLE assignments RENAME TO screen_assignments;
ALTER TABLE screen_assignments RENAME CONSTRAINT assignments_pkey TO screen_assignments_pkey;
ALTER TABLE screen_assignments RENAME CONSTRAINT assignments_device_id_fkey TO screen_assignments_device_id_fkey;
ALTER TABLE screen_assignments RENAME CONSTRAINT assignments_one_target TO screen_assignments_one_target;
ALTER TABLE screen_assignments RENAME CONSTRAINT assignments_not_self TO screen_assignments_not_self;
ALTER TABLE screen_assignments RENAME CONSTRAINT assignments_zone TO screen_assignments_zone;
ALTER TABLE screen_assignments RENAME CONSTRAINT assignments_mirror_zone TO screen_assignments_mirror_zone;
ALTER TABLE screen_assignments RENAME CONSTRAINT assignments_mirror_device TO screen_assignments_mirror_device;
ALTER INDEX assignments_zone RENAME TO screen_assignments_zone;
ALTER INDEX assignments_mirror_zone RENAME TO screen_assignments_mirror_zone;
ALTER INDEX assignments_mirror_device RENAME TO screen_assignments_mirror_device;
