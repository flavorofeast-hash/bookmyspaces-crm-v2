-- Defence in depth for Supabase: the CRM is reached only from the server with the
-- database owner's connection string. Supabase's public API roles (anon,
-- authenticated) must never read or write CRM data, even if the "crm" schema were
-- ever exposed through the API by mistake.
REVOKE ALL ON SCHEMA crm FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA crm FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA crm FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm FROM PUBLIC;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA crm FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA crm FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA crm FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA crm REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA crm REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA crm REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Row-level security with no policies: blocks every role except the table owner
-- (the server's connection), as a second barrier behind the revokes above.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'crm' LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
