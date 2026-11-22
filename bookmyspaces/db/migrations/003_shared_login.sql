-- Shared team login: usernames like "admin" are allowed (the column keeps its old
-- name "email"), and the session-signing secret can live in the database so the
-- Preview needs no extra secret configuration.
ALTER TABLE crm.app_users ADD COLUMN IF NOT EXISTS uses_default_password boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS crm.app_secrets (
  name        text PRIMARY KEY,
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm.app_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.app_secrets FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON crm.app_secrets FROM %I', r);
    END IF;
  END LOOP;
END $$;
