-- WhatsApp parity with V3: AI replies (owner switch, off by default), staff handover, media details, webhook error log.
ALTER TABLE crm.messages ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;
ALTER TABLE crm.messages ADD COLUMN IF NOT EXISTS media_mime text;
ALTER TABLE crm.messages ADD COLUMN IF NOT EXISTS media_filename text;

ALTER TABLE crm.customers ADD COLUMN IF NOT EXISTS ai_paused boolean NOT NULL DEFAULT false;
ALTER TABLE crm.customers ADD COLUMN IF NOT EXISTS wa_handover_at timestamptz;
ALTER TABLE crm.customers ADD COLUMN IF NOT EXISTS wa_handover_reason text;

ALTER TABLE crm.business_settings ADD COLUMN IF NOT EXISTS ai_reply_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS crm.wa_webhook_errors (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL,
  error        text NOT NULL,
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES crm.app_users(id)
);
ALTER TABLE crm.wa_webhook_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.wa_webhook_errors FROM PUBLIC;
REVOKE ALL ON SEQUENCE crm.wa_webhook_errors_id_seq FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON crm.wa_webhook_errors FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE crm.wa_webhook_errors_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
