-- The stack's database roles (0013 item 5), run by the db-roles service as the Postgres superuser
-- at every start. Idempotent. Passwords are set by the service from deploy/.env, not here.
--
-- canccu_migrator runs every module's migrations and owns the tables. CREATEROLE lets migrations
-- create each module's NOLOGIN app role (canccu_<module>_app); since Postgres 16 it manages only
-- the roles it created or was given ADMIN OPTION on, and it can never create a superuser.
-- canccu_app is the login role every module serves as: no superuser, no BYPASSRLS, owns nothing,
-- reaching tables only through the app roles its module's migrations grant it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_migrator') THEN
    CREATE ROLE canccu_migrator LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOCREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_app') THEN
    CREATE ROLE canccu_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
  END IF;
END
$$;
-- Re-asserted every start, so a role changed by hand is put back.
ALTER ROLE canccu_migrator NOSUPERUSER NOBYPASSRLS NOCREATEDB;
ALTER ROLE canccu_app NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE, CREATE ON SCHEMA public TO canccu_migrator;
GRANT USAGE ON SCHEMA public TO canccu_app;
REVOKE CREATE ON SCHEMA public FROM canccu_app;

-- A stack that ran before the split made its tables and app roles as the superuser: hand them to
-- the migrator, so later migrations (a drop included) may change them and it may grant the roles.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles o ON o.oid = c.relowner
    WHERE n.nspname = 'public' AND o.rolsuper AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO canccu_migrator', r.relname);
  END LOOP;
  FOR r IN
    SELECT rolname FROM pg_roles
    WHERE rolname LIKE 'canccu\_%\_app' AND NOT rolcanlogin AND NOT rolsuper
  LOOP
    EXECUTE format('GRANT %I TO canccu_migrator WITH ADMIN OPTION', r.rolname);
  END LOOP;
END
$$;
