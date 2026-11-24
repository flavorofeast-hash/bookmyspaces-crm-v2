-- Marketing & Promotion Studio: media gallery, promotions, publishing log, free-promotion directory.
-- Additive only: existing posts/campaigns/media keep working.

-- Media gallery
ALTER TABLE crm.media DROP CONSTRAINT IF EXISTS media_mime_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_mime_valid') THEN
    ALTER TABLE crm.media ADD CONSTRAINT media_mime_valid CHECK (mime IN ('image/jpeg','image/png','image/webp'));
  END IF;
END $$;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES crm.properties(id);
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS has_text_overlay boolean NOT NULL DEFAULT false;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES crm.app_users(id);
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE crm.media ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS media_sha256_unique ON crm.media (sha256) WHERE sha256 IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_category_valid') THEN
    ALTER TABLE crm.media ADD CONSTRAINT media_category_valid CHECK (category IS NULL OR category IN ('rooms','rooftop','halls','food','cafe','decoration','events','exterior','other'));
  END IF;
END $$;

-- Property contact details used on promotions (owner confirms before publishing)
ALTER TABLE crm.properties ADD COLUMN IF NOT EXISTS promo_phones text;
ALTER TABLE crm.properties ADD COLUMN IF NOT EXISTS promo_whatsapp text;
ALTER TABLE crm.properties ADD COLUMN IF NOT EXISTS promo_location text;
ALTER TABLE crm.properties ADD COLUMN IF NOT EXISTS promo_highlights text;
ALTER TABLE crm.properties ADD COLUMN IF NOT EXISTS promo_contacts_confirmed boolean NOT NULL DEFAULT false;
UPDATE crm.properties SET promo_phones = '9051459463 / 7003853624', promo_whatsapp = '8017035546',
  promo_location = 'Mukundapur, near Ruby Hospital, EM Bypass, Kolkata',
  promo_highlights = 'Rooftop café · Celebration hall · Private dining · AC rooms'
  WHERE name = 'MonuRama Homestay' AND promo_phones IS NULL;
UPDATE crm.properties SET promo_phones = '9830509991 / 9123005489', promo_whatsapp = '8017035546',
  promo_location = 'Bangur, Jessore Road, near Kolkata Airport',
  promo_highlights = 'City-view rooms · Rooftop seating · Near the airport'
  WHERE name = 'Skyline Serenity' AND promo_phones IS NULL;

-- Promotions (one generated promotion = image + captions + optional video settings)
CREATE TABLE IF NOT EXISTS crm.promotions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES crm.properties(id),
  promo_type    text NOT NULL,
  language      text NOT NULL DEFAULT 'both' CHECK (language IN ('en','bn','both')),
  headline      text NOT NULL,
  offer_line    text,
  package_id    uuid REFERENCES crm.packages(id),
  addon_id      uuid REFERENCES crm.addons(id),
  media_ids     uuid[] NOT NULL DEFAULT '{}',
  captions      jsonb NOT NULL DEFAULT '{}',
  variant       int NOT NULL DEFAULT 0,
  campaign_id   uuid REFERENCES crm.campaigns(id),
  link          text,
  platforms     text[] NOT NULL DEFAULT '{}',
  planned_for   date,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','posted','archived')),
  approved_by   uuid REFERENCES crm.app_users(id),
  approved_at   timestamptz,
  created_by    uuid REFERENCES crm.app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promotions_planned ON crm.promotions (planned_for);

-- Free promotion directory
CREATE TABLE IF NOT EXISTS crm.promo_opportunities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            text NOT NULL,
  name                text NOT NULL,
  url                 text NOT NULL UNIQUE,
  audience            text,
  category            text,
  free_posting        text NOT NULL DEFAULT 'unknown' CHECK (free_posting IN ('yes','no','unknown')),
  membership_required text NOT NULL DEFAULT 'unknown' CHECK (membership_required IN ('yes','no','unknown')),
  rules               text,
  last_checked        date,
  status              text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','approved','posted','rejected','paid')),
  notes               text,
  created_by          uuid REFERENCES crm.app_users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- What happened to each promotion (created, downloads, copies, postings)
CREATE TABLE IF NOT EXISTS crm.promotion_events (
  id              bigserial PRIMARY KEY,
  promotion_id    uuid NOT NULL REFERENCES crm.promotions(id),
  kind            text NOT NULL CHECK (kind IN ('created','approved','downloaded_image','downloaded_video','copied_caption','copied_whatsapp','opened_destination','posted')),
  detail          text,
  opportunity_id  uuid REFERENCES crm.promo_opportunities(id),
  url             text,
  posted_on       date,
  user_id         uuid REFERENCES crm.app_users(id),
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promotion_events_promo ON crm.promotion_events (promotion_id);

-- Which property a WhatsApp enquiry is about (from the promotion code or the property name in the message)
ALTER TABLE crm.customers ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES crm.properties(id);

-- Same lockdown as every other CRM table: only the server connection can read or write.
ALTER TABLE crm.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.promo_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.promotion_events ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON crm.promotions, crm.promo_opportunities, crm.promotion_events FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE crm.promotion_events_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON crm.promotions, crm.promo_opportunities, crm.promotion_events FROM PUBLIC;
