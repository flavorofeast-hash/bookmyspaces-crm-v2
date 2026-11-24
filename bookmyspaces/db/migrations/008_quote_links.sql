-- Quotation lines remember which catalogue package/add-on they came from (prevents charging twice). Follow-ups get a method.
ALTER TABLE crm.booking_items ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES crm.packages(id);
ALTER TABLE crm.booking_items ADD COLUMN IF NOT EXISTS addon_id uuid REFERENCES crm.addons(id);
ALTER TABLE crm.follow_ups ADD COLUMN IF NOT EXISTS method text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_method_valid') THEN
    ALTER TABLE crm.follow_ups ADD CONSTRAINT follow_ups_method_valid CHECK (method IS NULL OR method IN ('call','whatsapp','visit','email'));
  END IF;
END $$;
