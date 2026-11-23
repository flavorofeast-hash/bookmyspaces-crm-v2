-- Enquiry/booking assignment to a staff member (nullable; existing rows untouched)
ALTER TABLE crm.bookings ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES crm.app_users(id);
CREATE INDEX IF NOT EXISTS bookings_assigned_to_idx ON crm.bookings (assigned_to) WHERE assigned_to IS NOT NULL;
