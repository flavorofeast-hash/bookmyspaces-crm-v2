-- PRODUCTION BACKUP (read-only for V3 data). Run in the production Supabase SQL editor BEFORE go-live.
-- Copies every table of the live V3 CRM (schema "public") into a new schema backup_v3_20261122,
-- then prints row counts side by side. It does not change, move or delete any V3 data.
-- Restore a single table later with:  INSERT INTO public.<t> SELECT * FROM backup_v3_20261122.<t>;
-- Remove the copy (after 30+ days):   DROP SCHEMA backup_v3_20261122 CASCADE;

CREATE SCHEMA IF NOT EXISTS backup_v3_20261122;
REVOKE ALL ON SCHEMA backup_v3_20261122 FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA backup_v3_20261122 FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON SCHEMA backup_v3_20261122 FROM authenticated'; END IF;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS backup_v3_20261122.%I AS TABLE public.%I', t.tablename, t.tablename);
    EXECUTE format('ALTER TABLE backup_v3_20261122.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Verification: every row must match (live = backup).
CREATE TEMP TABLE _cmp (tbl text, live bigint, backup bigint);
DO $$
DECLARE t record; a bigint; b bigint;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t.tablename) INTO a;
    EXECUTE format('SELECT count(*) FROM backup_v3_20261122.%I', t.tablename) INTO b;
    INSERT INTO _cmp VALUES (t.tablename, a, b);
  END LOOP;
END $$;
SELECT tbl, live, backup, CASE WHEN live = backup THEN 'OK' ELSE 'MISMATCH' END AS check FROM _cmp ORDER BY tbl;
