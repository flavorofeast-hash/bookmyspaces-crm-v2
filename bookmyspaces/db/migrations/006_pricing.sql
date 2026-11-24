-- Flexible pricing: owner-set min/max range per space, weekday and date-specific rates, append-only price audit.
-- Existing rows are untouched (new columns are nullable; existing prices stay valid because no range is set).

ALTER TABLE crm.spaces ADD COLUMN IF NOT EXISTS min_price numeric(12,2) CHECK (min_price IS NULL OR min_price >= 0);
ALTER TABLE crm.spaces ADD COLUMN IF NOT EXISTS max_price numeric(12,2) CHECK (max_price IS NULL OR max_price >= 0);

-- Pricing unit may be left unconfirmed (NULL) — such a space cannot be booked. 'session' added for e.g. a studio.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'crm.spaces'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%price_unit%' LOOP
    EXECUTE format('ALTER TABLE crm.spaces DROP CONSTRAINT %I', c);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_price_unit_valid') THEN
    ALTER TABLE crm.spaces ADD CONSTRAINT spaces_price_unit_valid CHECK (price_unit IS NULL OR price_unit IN ('night','slot','day','hour','person','session'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_price_range_valid') THEN
    ALTER TABLE crm.spaces ADD CONSTRAINT spaces_price_range_valid CHECK (min_price IS NULL OR max_price IS NULL OR min_price <= max_price);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_price_within_range') THEN
    ALTER TABLE crm.spaces ADD CONSTRAINT spaces_price_within_range CHECK (price IS NULL OR ((min_price IS NULL OR price >= min_price) AND (max_price IS NULL OR price <= max_price)));
  END IF;
END $$;
ALTER TABLE crm.spaces ALTER COLUMN price_unit DROP NOT NULL;

CREATE TABLE IF NOT EXISTS crm.space_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid NOT NULL REFERENCES crm.spaces(id) ON DELETE CASCADE,
  weekday     smallint CHECK (weekday BETWEEN 1 AND 7),   -- ISO: 1 = Monday … 7 = Sunday
  on_date     date,
  price       numeric(12,2) NOT NULL CHECK (price >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES crm.app_users(id),
  CHECK ((weekday IS NULL) <> (on_date IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS space_rates_weekday_uq ON crm.space_rates (space_id, weekday) WHERE weekday IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS space_rates_date_uq ON crm.space_rates (space_id, on_date) WHERE on_date IS NOT NULL;

-- Server-side guard: a weekday/date rate must lie inside the space's range; a range cannot be narrowed past existing rates.
CREATE OR REPLACE FUNCTION crm.space_rate_in_range() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sp record;
BEGIN
  SELECT name, min_price, max_price INTO sp FROM crm.spaces WHERE id = NEW.space_id;
  IF (sp.min_price IS NOT NULL AND NEW.price < sp.min_price) OR (sp.max_price IS NOT NULL AND NEW.price > sp.max_price) THEN
    RAISE EXCEPTION 'Rate % for % is outside the allowed range % – %.', NEW.price, sp.name, sp.min_price, sp.max_price USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS space_rates_in_range ON crm.space_rates;
CREATE TRIGGER space_rates_in_range BEFORE INSERT OR UPDATE ON crm.space_rates FOR EACH ROW EXECUTE FUNCTION crm.space_rate_in_range();

CREATE OR REPLACE FUNCTION crm.space_range_covers_rates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM crm.space_rates r WHERE r.space_id = NEW.id
             AND ((NEW.min_price IS NOT NULL AND r.price < NEW.min_price) OR (NEW.max_price IS NOT NULL AND r.price > NEW.max_price))) THEN
    RAISE EXCEPTION 'Some weekday or date rates for % are outside the new range. Change those rates first.', NEW.name USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS spaces_range_covers_rates ON crm.spaces;
CREATE TRIGGER spaces_range_covers_rates BEFORE UPDATE OF min_price, max_price ON crm.spaces FOR EACH ROW EXECUTE FUNCTION crm.space_range_covers_rates();

-- A space with no confirmed pricing unit is "not configured" for booking, like one without a price.
CREATE OR REPLACE FUNCTION crm.guard_space_configured() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sp record;
BEGIN
  IF NEW.space_id IS NULL OR (TG_OP = 'UPDATE' AND NOT NEW.holds) THEN RETURN NEW; END IF;
  SELECT s.name, s.active, s.price, s.price_unit, p.name AS property, p.active AS p_active INTO sp
    FROM crm.spaces s JOIN crm.properties p ON p.id = s.property_id WHERE s.id = NEW.space_id;
  IF NOT sp.active OR NOT sp.p_active OR sp.price IS NULL OR sp.price_unit IS NULL THEN
    RAISE EXCEPTION '% (%) is not configured for booking yet (inactive, no price or no pricing unit). Complete it in Settings → Rooms & spaces first.', sp.name, sp.property
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- Append-only price history.
CREATE TABLE IF NOT EXISTS crm.price_audit (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid,
  user_name   text NOT NULL,
  user_login  text NOT NULL,
  property    text,
  space_id    uuid,
  space       text NOT NULL,
  rate_type   text NOT NULL CHECK (rate_type IN ('standard','weekday','date','range','unit')),
  weekday     smallint,
  on_date     date,
  old_value   text,
  new_value   text
);
CREATE INDEX IF NOT EXISTS price_audit_at_idx ON crm.price_audit (at DESC);
CREATE INDEX IF NOT EXISTS price_audit_space_idx ON crm.price_audit (space_id, at DESC);

CREATE OR REPLACE FUNCTION crm.price_audit_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Price history cannot be changed or deleted.' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS price_audit_no_change ON crm.price_audit;
CREATE TRIGGER price_audit_no_change BEFORE UPDATE OR DELETE ON crm.price_audit FOR EACH ROW EXECUTE FUNCTION crm.price_audit_locked();
DROP TRIGGER IF EXISTS price_audit_no_truncate ON crm.price_audit;
CREATE TRIGGER price_audit_no_truncate BEFORE TRUNCATE ON crm.price_audit FOR EACH STATEMENT EXECUTE FUNCTION crm.price_audit_locked();

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON crm.space_rates, crm.price_audit FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Same lockdown as every other CRM table: no API-role access, RLS on with no policies (server connection only).
ALTER TABLE crm.space_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.price_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.space_rates, crm.price_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE crm.price_audit_id_seq FROM PUBLIC;
