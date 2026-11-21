-- TEST DATA ONLY — run this in the SQL editor of the *test* Supabase project, never production.
-- Creates a table shaped exactly like the old CRM's public.leads with 82 synthetic leads,
-- including the awkward cases the real data has: duplicate phone numbers in different
-- formats, leads without a phone, and leads without a name.
-- Expected result of Settings → Import old leads:
--   Found 82 · 6 without a mobile number (kept and flagged) · duplicates merged by mobile
--   · pressing Import again: 82 already imported, 0 new customers.

DO $$
BEGIN
  IF current_database() <> 'postgres' OR EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'proposals') THEN
    RAISE EXCEPTION 'This looks like a production database (legacy tables present). Run this only on the empty TEST project.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), name text, phone text, email text,
  event_type text, event_date date, guest_count int, budget text, special_requirements text, venue text, status text,
  source text, notes text, followup_date timestamptz, inquiry_summary text, lead_score int DEFAULT 5, tags text[] DEFAULT '{}'
);

INSERT INTO public.leads (name, phone, email, event_type, event_date, guest_count, budget, venue, status, source, notes, created_at)
SELECT CASE WHEN g % 20 = 0 THEN NULL ELSE 'TEST Lead ' || g END,
       CASE WHEN g % 13 = 0 THEN NULL WHEN g % 9 = 0 THEN '+91 9100000001' ELSE '91000' || (10000 + g) END,
       'testlead' || g || '@example.test',
       (ARRAY['Birthday','Haldi','Reunion','Wedding guests'])[1 + g % 4],
       current_date + (10 + g % 60), 15 + g % 70, (20 + g) || 'k',
       CASE WHEN g % 2 = 0 THEN 'skyline' ELSE 'monurama' END, 'new_inquiry',
       CASE WHEN g % 3 = 0 THEN 'website' ELSE 'whatsapp' END,
       'TEST DATA — not a real customer', now() - (g || ' days')::interval
FROM generate_series(1, 82) g
WHERE NOT EXISTS (SELECT 1 FROM public.leads WHERE name LIKE 'TEST Lead %' OR email LIKE 'testlead%@example.test');

SELECT count(*) AS test_leads FROM public.leads;
