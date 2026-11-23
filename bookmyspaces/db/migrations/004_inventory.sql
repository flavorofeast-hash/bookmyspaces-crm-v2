-- 004: editable inventory details; "not configured" (NULL) prices; per-property food packages.
-- Additive only: existing rows keep their values.

ALTER TABLE crm.spaces ALTER COLUMN price DROP NOT NULL;
ALTER TABLE crm.spaces ALTER COLUMN price DROP DEFAULT;
ALTER TABLE crm.spaces ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE crm.spaces ADD COLUMN IF NOT EXISTS max_occupancy int CHECK (max_occupancy IS NULL OR max_occupancy >= 0);
ALTER TABLE crm.spaces ADD COLUMN IF NOT EXISTS booking_rules text;

ALTER TABLE crm.properties ADD COLUMN IF NOT EXISTS food_packages_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE crm.properties ADD COLUMN IF NOT EXISTS booking_rules text;

ALTER TABLE crm.packages ALTER COLUMN price DROP NOT NULL;
ALTER TABLE crm.packages ALTER COLUMN price DROP DEFAULT;
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES crm.properties(id);
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS min_guests int CHECK (min_guests IS NULL OR min_guests >= 0);
ALTER TABLE crm.packages ADD COLUMN IF NOT EXISTS add_ons text;

-- A space that is inactive or has no price set ("not configured") can never be added to a booking or confirmed.
CREATE OR REPLACE FUNCTION crm.guard_space_configured() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sp record;
BEGIN
  IF NEW.space_id IS NULL OR (TG_OP = 'UPDATE' AND NOT NEW.holds) THEN RETURN NEW; END IF;
  SELECT s.name, s.active, s.price, p.name AS property, p.active AS p_active INTO sp
    FROM crm.spaces s JOIN crm.properties p ON p.id = s.property_id WHERE s.id = NEW.space_id;
  IF NOT sp.active OR NOT sp.p_active OR sp.price IS NULL THEN
    RAISE EXCEPTION '% (%) is not configured for booking yet (inactive or no price set). Complete it in Settings → Rooms & spaces first.', sp.name, sp.property
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS booking_items_space_configured ON crm.booking_items;
CREATE TRIGGER booking_items_space_configured BEFORE INSERT OR UPDATE OF holds ON crm.booking_items
  FOR EACH ROW EXECUTE FUNCTION crm.guard_space_configured();
