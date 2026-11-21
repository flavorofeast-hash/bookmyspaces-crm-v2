-- BookMySpaces CRM v2 — core schema.
-- Everything lives in its own schema "crm", so the legacy tables in "public"
-- are never touched, renamed or dropped by this migration. Rolling back is
-- simply: DROP SCHEMA crm CASCADE;  (legacy data stays exactly as it was).

-- btree_gist powers the double-booking guard. On Supabase extensions live in
-- the "extensions" schema; elsewhere the default schema is used.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS crm;
SET search_path TO crm, public, extensions;

-- ── Users & settings ─────────────────────────────────────────────────────────
CREATE TABLE crm.app_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  name            text NOT NULL,
  role            text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  password_hash   text NOT NULL,
  session_version int  NOT NULL DEFAULT 1,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

CREATE TABLE crm.business_settings (
  id                    int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name         text NOT NULL DEFAULT 'BookMySpaces',
  address               text,
  phone                 text,
  email                 text,
  whatsapp_number       text,
  upi_id                text,
  bank_details          text,
  document_footer       text DEFAULT 'Thank you for choosing BookMySpaces.',
  gst_number            text,             -- reserved for future GST support
  checkin_time          time NOT NULL DEFAULT '14:00',
  checkout_time         time NOT NULL DEFAULT '11:00',
  business_hours_start  time NOT NULL DEFAULT '09:00',
  business_hours_end    time NOT NULL DEFAULT '21:00',
  auto_reply_enabled    boolean NOT NULL DEFAULT true,
  auto_reply_text       text NOT NULL DEFAULT 'Thank you for contacting BookMySpaces! Please share your dates, number of guests and what you are planning. Our team will reply shortly.',
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO crm.business_settings (id) VALUES (1);

-- ── Properties & spaces ──────────────────────────────────────────────────────
CREATE TABLE crm.properties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  address     text,
  phone       text,
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm.spaces (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES crm.properties(id),
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('room','hall','rooftop','other')),
  room_type    text,
  capacity     int CHECK (capacity IS NULL OR capacity >= 0),
  facilities   text,
  price        numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  price_unit   text NOT NULL DEFAULT 'night' CHECK (price_unit IN ('night','slot','day','hour','person')),
  active       boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

CREATE TABLE crm.event_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  CHECK (end_time > start_time)
);
INSERT INTO crm.event_slots (name, start_time, end_time, sort_order) VALUES
  ('Morning', '08:00', '14:00', 1),
  ('Evening', '16:00', '23:00', 2),
  ('Full day', '08:00', '23:00', 3);

CREATE TABLE crm.packages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  description  text,
  price        numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  price_basis  text NOT NULL DEFAULT 'per_person' CHECK (price_basis IN ('per_person','flat')),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Marketing campaigns (referenced by customers/bookings) ───────────────────
CREATE TABLE crm.campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{3,20}$'),
  channel     text,
  starts_on   date,
  ends_on     date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Customers ────────────────────────────────────────────────────────────────
CREATE TABLE crm.customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  phone              text,          -- canonical 91XXXXXXXXXX (digits only)
  whatsapp           text,          -- canonical; defaults to phone
  email              text,
  source             text NOT NULL DEFAULT 'walk_in',
  campaign_id        uuid REFERENCES crm.campaigns(id),
  requirements       text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  legacy_lead_ids    text[] NOT NULL DEFAULT '{}',
  legacy_data        jsonb,         -- full original lead row(s), preserved verbatim
  import_flags       text[] NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX customers_phone_unique ON crm.customers (phone) WHERE phone IS NOT NULL;
CREATE INDEX customers_whatsapp_idx ON crm.customers (whatsapp);
CREATE INDEX customers_name_idx ON crm.customers (lower(name));

CREATE TABLE crm.follow_ups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES crm.customers(id),
  booking_id   uuid,
  due_on       date NOT NULL,
  note         text NOT NULL,
  done_at      timestamptz,
  created_by   uuid REFERENCES crm.app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX follow_ups_due_idx ON crm.follow_ups (due_on) WHERE done_at IS NULL;

-- ── Numbering (bookings + documents) ─────────────────────────────────────────
-- One row per series per year. The UPSERT takes a row lock, so concurrent
-- transactions are serialised; the increment rolls back with its transaction,
-- so numbers are never duplicated, never reused and never skipped.
CREATE TABLE crm.counters (
  series      text NOT NULL,
  year        int  NOT NULL,
  last_value  int  NOT NULL,
  PRIMARY KEY (series, year)
);

CREATE OR REPLACE FUNCTION crm.next_number(p_series text, p_prefix text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  y int := extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
  v int;
BEGIN
  INSERT INTO crm.counters (series, year, last_value) VALUES (p_series, y, 1)
  ON CONFLICT (series, year) DO UPDATE SET last_value = crm.counters.last_value + 1
  RETURNING last_value INTO v;
  RETURN p_prefix || '-' || y || '-' || lpad(v::text, 4, '0');
END $$;

-- ── Bookings ─────────────────────────────────────────────────────────────────
CREATE TABLE crm.bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                text NOT NULL UNIQUE,
  customer_id        uuid NOT NULL REFERENCES crm.customers(id),
  property_id        uuid REFERENCES crm.properties(id),
  booking_type       text NOT NULL CHECK (booking_type IN ('room_stay','event','event_with_stay')),
  event_type         text,
  guests             int CHECK (guests IS NULL OR guests >= 0),
  start_at           timestamptz NOT NULL,
  end_at             timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'enquiry'
                       CHECK (status IN ('enquiry','quoted','confirmed','completed','cancelled')),
  package_id         uuid REFERENCES crm.packages(id),
  food_requirements  text,
  notes              text,
  discount           numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  subtotal           numeric(12,2) NOT NULL DEFAULT 0,
  total              numeric(12,2) NOT NULL DEFAULT 0,
  source             text,
  campaign_id        uuid REFERENCES crm.campaigns(id),
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_by         uuid REFERENCES crm.app_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX bookings_customer_idx ON crm.bookings (customer_id);
CREATE INDEX bookings_dates_idx ON crm.bookings (start_at, end_at);
ALTER TABLE crm.follow_ups ADD CONSTRAINT follow_ups_booking_fk FOREIGN KEY (booking_id) REFERENCES crm.bookings(id);

CREATE TABLE crm.booking_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES crm.bookings(id) ON DELETE CASCADE,
  line_type   text NOT NULL CHECK (line_type IN ('space','food','package','extra')),
  space_id    uuid REFERENCES crm.spaces(id),
  description text NOT NULL,
  start_at    timestamptz,
  end_at      timestamptz,
  qty         numeric(10,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price  numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount      numeric(12,2) GENERATED ALWAYS AS (round(qty * unit_price, 2)) STORED,
  tax_rate    numeric(5,2) NOT NULL DEFAULT 0,   -- reserved for future GST; always 0 now
  holds       boolean NOT NULL DEFAULT false,    -- true while the booking is confirmed/completed
  sort_order  int NOT NULL DEFAULT 0,
  CHECK (line_type <> 'space' OR (space_id IS NOT NULL AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at)),
  -- THE double-booking guard: no two holding lines may overlap on the same physical space.
  CONSTRAINT no_double_booking EXCLUDE USING gist (
    space_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (holds AND space_id IS NOT NULL)
);
CREATE INDEX booking_items_booking_idx ON crm.booking_items (booking_id);
CREATE INDEX booking_items_space_idx ON crm.booking_items (space_id, start_at);

CREATE OR REPLACE FUNCTION crm.booking_items_set_holds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.holds := NEW.line_type = 'space' AND EXISTS (
    SELECT 1 FROM crm.bookings b WHERE b.id = NEW.booking_id AND b.status IN ('confirmed','completed'));
  RETURN NEW;
END $$;
CREATE TRIGGER booking_items_holds BEFORE INSERT OR UPDATE ON crm.booking_items
  FOR EACH ROW EXECUTE FUNCTION crm.booking_items_set_holds();

CREATE OR REPLACE FUNCTION crm.bookings_sync_holds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE crm.booking_items SET holds = holds WHERE booking_id = NEW.id;  -- re-runs the holds trigger
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_status_holds AFTER UPDATE OF status ON crm.bookings
  FOR EACH ROW EXECUTE FUNCTION crm.bookings_sync_holds();

-- ── Payments ─────────────────────────────────────────────────────────────────
CREATE TABLE crm.payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES crm.bookings(id),
  customer_id  uuid NOT NULL REFERENCES crm.customers(id),
  kind         text NOT NULL CHECK (kind IN ('advance','balance','payment','refund')),
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  method       text NOT NULL CHECK (method IN ('cash','upi','bank_transfer','card','cheque','other')),
  reference    text,
  paid_on      date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  note         text,
  voided_at    timestamptz,
  void_reason  text,
  created_by   uuid REFERENCES crm.app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
CREATE INDEX payments_booking_idx ON crm.payments (booking_id);

-- ── Documents (quotation / bill / receipt / refund) ──────────────────────────
CREATE TABLE crm.documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type       text NOT NULL CHECK (doc_type IN ('quotation','bill','receipt','refund')),
  number         text NOT NULL,
  booking_id     uuid NOT NULL REFERENCES crm.bookings(id),
  customer_id    uuid NOT NULL REFERENCES crm.customers(id),
  payment_id     uuid REFERENCES crm.payments(id),
  supersedes_id  uuid REFERENCES crm.documents(id),
  status         text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void')),
  void_reason    text,
  voided_at      timestamptz,
  amount         numeric(12,2) NOT NULL,  -- quotation/bill: total; receipt/refund: payment amount
  paid_to_date   numeric(12,2) NOT NULL,
  balance        numeric(12,2) NOT NULL,
  content        jsonb NOT NULL,          -- frozen copy of everything printed on the document
  public_token   text NOT NULL UNIQUE,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES crm.app_users(id),
  CONSTRAINT documents_number_unique UNIQUE (doc_type, number),
  CHECK (status = 'issued' OR void_reason IS NOT NULL)
);
CREATE INDEX documents_booking_idx ON crm.documents (booking_id);
CREATE UNIQUE INDEX documents_one_live_receipt_per_payment ON crm.documents (payment_id)
  WHERE payment_id IS NOT NULL AND status = 'issued';

-- Issued documents and payments are permanent records: no deletes, and only
-- the void fields may change.
CREATE OR REPLACE FUNCTION crm.protect_documents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Documents cannot be deleted; void them instead'; END IF;
  IF NEW.number <> OLD.number OR NEW.doc_type <> OLD.doc_type OR NEW.content <> OLD.content
     OR NEW.amount <> OLD.amount OR NEW.paid_to_date <> OLD.paid_to_date OR NEW.balance <> OLD.balance
     OR NEW.booking_id <> OLD.booking_id OR NEW.issued_at <> OLD.issued_at THEN
    RAISE EXCEPTION 'Issued documents cannot be changed; issue a new document instead';
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN RAISE EXCEPTION 'A void document cannot be re-issued'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_protect BEFORE UPDATE OR DELETE ON crm.documents
  FOR EACH ROW EXECUTE FUNCTION crm.protect_documents();

CREATE OR REPLACE FUNCTION crm.protect_payments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payments cannot be deleted; void them instead'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.kind <> OLD.kind OR NEW.booking_id <> OLD.booking_id
     OR NEW.customer_id <> OLD.customer_id OR NEW.paid_on <> OLD.paid_on OR NEW.method <> OLD.method THEN
    RAISE EXCEPTION 'Recorded payments cannot be changed; void and re-enter instead';
  END IF;
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS NULL THEN RAISE EXCEPTION 'A voided payment cannot be restored'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_protect BEFORE UPDATE OR DELETE ON crm.payments
  FOR EACH ROW EXECUTE FUNCTION crm.protect_payments();

-- Single source of truth for money per booking.
CREATE VIEW crm.booking_balances AS
SELECT b.id AS booking_id,
       b.total,
       COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NULL AND p.kind <> 'refund'), 0) AS received,
       COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NULL AND p.kind = 'refund'), 0)  AS refunded,
       COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NULL AND p.kind <> 'refund'), 0)
         - COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NULL AND p.kind = 'refund'), 0) AS net_paid,
       CASE WHEN b.status = 'cancelled' THEN 0
            ELSE b.total - (COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NULL AND p.kind <> 'refund'), 0)
                          - COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NULL AND p.kind = 'refund'), 0)) END AS balance
FROM crm.bookings b
LEFT JOIN crm.payments p ON p.booking_id = b.id
GROUP BY b.id;

-- ── WhatsApp messages ────────────────────────────────────────────────────────
CREATE TABLE crm.messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid NOT NULL REFERENCES crm.customers(id),
  direction          text NOT NULL CHECK (direction IN ('in','out')),
  msg_type           text NOT NULL DEFAULT 'text',
  body               text,
  media_id           text,
  wa_message_id      text UNIQUE,
  status             text NOT NULL CHECK (status IN ('received','sending','sent','delivered','read','failed')),
  error_code         text,
  error_message      text,
  template_name      text,
  is_auto_reply      boolean NOT NULL DEFAULT false,
  sent_by            uuid REFERENCES crm.app_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  status_updated_at  timestamptz,
  read_by_staff      boolean NOT NULL DEFAULT false
);
CREATE INDEX messages_customer_idx ON crm.messages (customer_id, created_at);

CREATE TABLE crm.quick_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0
);
INSERT INTO crm.quick_replies (title, body, sort_order) VALUES
  ('Ask for details', 'Thank you for your enquiry! Could you please share the date, number of guests and the kind of event or stay you are planning?', 1),
  ('Availability confirmed', 'Good news — the space is available on your date. Shall I send you a quotation?', 2),
  ('Advance request', 'To confirm your booking we request an advance payment. You can pay by UPI or bank transfer; we will send a receipt immediately.', 3),
  ('Thank you', 'Thank you for choosing BookMySpaces! We look forward to hosting you.', 4);

CREATE TABLE crm.wa_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,       -- exact template name approved in WhatsApp Manager
  language        text NOT NULL DEFAULT 'en',
  description     text,
  uses_name_param boolean NOT NULL DEFAULT false
);

-- ── Marketing content ────────────────────────────────────────────────────────
CREATE TABLE crm.media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    text NOT NULL,
  mime        text NOT NULL CHECK (mime IN ('image/jpeg','image/png')),
  bytes       bytea NOT NULL,
  size        int NOT NULL CHECK (size <= 5242880),
  public_token text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm.posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid REFERENCES crm.campaigns(id),
  title        text NOT NULL,
  caption      text NOT NULL DEFAULT '',
  platforms    text[] NOT NULL DEFAULT '{}',
  planned_for  date,
  media_id     uuid REFERENCES crm.media(id),
  notes        text,
  created_by   uuid REFERENCES crm.app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm.post_publications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid NOT NULL REFERENCES crm.posts(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('facebook','instagram','google')),
  status        text NOT NULL CHECK (status IN ('published','failed','posted_manually')),
  external_id   text,
  permalink     text,
  error         text,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES crm.app_users(id),
  CHECK (status <> 'published' OR external_id IS NOT NULL)
);

-- ── Activity log ─────────────────────────────────────────────────────────────
CREATE TABLE crm.activity (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  user_id      uuid REFERENCES crm.app_users(id),
  customer_id  uuid REFERENCES crm.customers(id),
  booking_id   uuid REFERENCES crm.bookings(id),
  action       text NOT NULL,
  detail       text
);
CREATE INDEX activity_at_idx ON crm.activity (at DESC);
CREATE INDEX activity_customer_idx ON crm.activity (customer_id, at DESC);

-- ── Login protection ─────────────────────────────────────────────────────────
CREATE TABLE crm.login_failures (
  id     bigserial PRIMARY KEY,
  email  text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_failures_email_idx ON crm.login_failures (email, at DESC);
