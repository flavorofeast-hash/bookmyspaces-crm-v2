-- Catalogue: event packages, food & catering, decoration & add-ons, and a read-only archive of old-CRM records.
-- Existing package rows keep working (new columns have safe defaults; existing rows count as approved).

ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'food';
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS inclusions text[] NOT NULL DEFAULT '{}';
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS max_guests int CHECK (max_guests IS NULL OR max_guests >= 0);
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS duration text;
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS food_type text;
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS kitchen_notes text;
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS is_popular boolean NOT NULL DEFAULT false;
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved';
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES crm.app_users(id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_kind_valid') THEN
    ALTER TABLE crm.packages ADD CONSTRAINT packages_kind_valid CHECK (kind IN ('event','food','dining'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_review_valid') THEN
    ALTER TABLE crm.packages ADD CONSTRAINT packages_review_valid CHECK (review_status IN ('approved','owner_review','historical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_food_type_valid') THEN
    ALTER TABLE crm.packages ADD CONSTRAINT packages_food_type_valid CHECK (food_type IS NULL OR food_type IN ('veg','non_veg','both'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm.addons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  category       text NOT NULL DEFAULT 'other' CHECK (category IN ('decoration','music','photography','food','guests','other')),
  description    text,
  price_min      numeric(12,2) CHECK (price_min IS NULL OR price_min >= 0),
  price_max      numeric(12,2) CHECK (price_max IS NULL OR price_max >= 0),
  unit           text NOT NULL DEFAULT 'fixed' CHECK (unit IN ('fixed','per_person')),
  property_id    uuid REFERENCES crm.properties(id),
  package_id     uuid REFERENCES crm.packages(id),
  image_url      text,
  active         boolean NOT NULL DEFAULT false,
  review_status  text NOT NULL DEFAULT 'owner_review' CHECK (review_status IN ('approved','owner_review','historical')),
  source         text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES crm.app_users(id),
  CHECK (price_min IS NULL OR price_max IS NULL OR price_min <= price_max)
);

-- Old-CRM proposals, invoices and payments: kept for reference only. Never counted as V2 bookings or payments.
CREATE TABLE IF NOT EXISTS crm.legacy_records (
  id             bigserial PRIMARY KEY,
  source         text NOT NULL,
  record_type    text NOT NULL CHECK (record_type IN ('proposal','invoice','payment','package')),
  legacy_id      text NOT NULL,
  number         text,
  customer_name  text,
  phone          text,
  event_date     date,
  amount         numeric(12,2),
  status         text,
  likely_test    boolean NOT NULL DEFAULT false,
  data           jsonb NOT NULL,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, record_type, legacy_id)
);

CREATE OR REPLACE FUNCTION crm.legacy_records_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Archived old-CRM records are read-only.' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS legacy_records_read_only ON crm.legacy_records;
CREATE TRIGGER legacy_records_read_only BEFORE UPDATE OR DELETE ON crm.legacy_records FOR EACH ROW EXECUTE FUNCTION crm.legacy_records_locked();

ALTER TABLE crm.addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.legacy_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.addons, crm.legacy_records FROM PUBLIC;
REVOKE ALL ON SEQUENCE crm.legacy_records_id_seq FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON crm.addons, crm.legacy_records FROM %I', r);
    END IF;
  END LOOP;
END $$;
