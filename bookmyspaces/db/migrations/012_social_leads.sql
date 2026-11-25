-- Facebook/Instagram messages and Lead Ads, plus one central list of enquiries (leads).
ALTER TABLE crm.messages ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_channel_valid') THEN
    ALTER TABLE crm.messages ADD CONSTRAINT messages_channel_valid CHECK (channel IN ('whatsapp','facebook','instagram'));
  END IF;
END $$;

ALTER TABLE crm.customers ADD COLUMN IF NOT EXISTS fb_psid text;
ALTER TABLE crm.customers ADD COLUMN IF NOT EXISTS ig_sid text;
ALTER TABLE crm.customers ADD COLUMN IF NOT EXISTS ig_username text;
CREATE UNIQUE INDEX IF NOT EXISTS customers_fb_psid_unique ON crm.customers (fb_psid) WHERE fb_psid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_ig_sid_unique ON crm.customers (ig_sid) WHERE ig_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_email_idx ON crm.customers (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm.leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES crm.customers(id),
  source           text NOT NULL CHECK (source IN ('whatsapp','facebook','instagram','facebook_lead_ad','instagram_lead_ad')),
  external_id      text NOT NULL,          -- first platform message id, or Meta lead id
  social_id        text,                   -- PSID / Instagram-scoped id / WhatsApp number
  name             text,
  phone            text,
  email            text,
  message          text,
  property_id      uuid REFERENCES crm.properties(id),
  category         text CHECK (category IS NULL OR category IN ('room','hall','rooftop','food','general')),
  requested_dates  text,
  guests           int CHECK (guests IS NULL OR guests >= 0),
  budget           text,
  assigned_to      uuid REFERENCES crm.app_users(id),
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','follow_up','converted','lost')),
  last_contact_at  timestamptz,
  next_follow_up   date,
  notes            text,
  campaign_ref     text, campaign_name text, ad_id text, ad_name text, form_id text, form_name text,
  booking_id       uuid REFERENCES crm.bookings(id),
  is_test          boolean NOT NULL DEFAULT false,
  raw              jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS leads_customer_idx ON crm.leads (customer_id);
CREATE INDEX IF NOT EXISTS leads_open_idx ON crm.leads (status, next_follow_up) WHERE status NOT IN ('converted','lost');

ALTER TABLE crm.leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.leads FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON crm.leads FROM %I', r); END IF;
  END LOOP;
END $$;
