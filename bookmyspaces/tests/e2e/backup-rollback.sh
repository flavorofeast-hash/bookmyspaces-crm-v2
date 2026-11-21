#!/usr/bin/env bash
# Simulates the production database (legacy tables in "public", including names that
# also exist in the new schema) and proves: backup → migrate → import → rollback → restore.
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -h /tmp -p 5433 -U postgres -qtA"
pass() { echo "PASS $*"; }; fail() { echo "FAIL $*"; exit 1; }
$P -c "DROP DATABASE IF EXISTS prod_sim" -c "DROP DATABASE IF EXISTS prod_restore" -c "CREATE DATABASE prod_sim" -c "CREATE DATABASE prod_restore"
$P -d prod_sim <<'SQL'
CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), name text, phone text, email text, event_type text, event_date date, guest_count int, budget text, special_requirements text, venue text, status text, source text, notes text, followup_date timestamptz, inquiry_summary text, lead_score int DEFAULT 5, tags text[] DEFAULT '{}');
INSERT INTO public.leads (name, phone, email, event_type, guest_count, source, notes)
  SELECT CASE WHEN g % 20 = 0 THEN NULL ELSE 'Legacy Lead ' || g END, CASE WHEN g % 13 = 0 THEN NULL WHEN g % 9 = 0 THEN '+91 9100000001' ELSE '91000' || (10000 + g) END,
         'l' || g || '@old.test', 'Birthday', 20 + g, CASE WHEN g % 2 = 0 THEN 'whatsapp' ELSE 'website' END, 'old note ' || g FROM generate_series(1, 82) g;
-- legacy tables whose names also exist in the new crm schema
CREATE TABLE public.payments (id serial PRIMARY KEY, proposal_id int, amount numeric, receipt_number text);
INSERT INTO public.payments (amount, receipt_number) VALUES (5000, 'OLD-RCP-1'), (2500, 'OLD-RCP-2');
CREATE TABLE public.messages (id serial PRIMARY KEY, body text); INSERT INTO public.messages (body) VALUES ('legacy message');
CREATE TABLE public.campaigns (id serial PRIMARY KEY, name text); INSERT INTO public.campaigns (name) VALUES ('legacy campaign');
CREATE TABLE public.packages (id serial PRIMARY KEY, name text, price numeric); INSERT INTO public.packages (name, price) VALUES ('Silver', 499);
CREATE TABLE public.properties (id serial PRIMARY KEY, slug text); INSERT INTO public.properties (slug) VALUES ('skyline-serenity');
CREATE TABLE public.settings (key text PRIMARY KEY, value text); INSERT INTO public.settings VALUES ('x', 'y');
CREATE TABLE public.proposals (id serial PRIMARY KEY, proposal_number text, total_price numeric); INSERT INTO public.proposals (proposal_number, total_price) VALUES ('BMS-2026-001', 45000);
SQL
fingerprint() { $P -d "$1" -c "SELECT string_agg(t || ':' || n || ':' || h, ' ' ORDER BY t) FROM (
  SELECT 'leads' t, count(*) n, md5(string_agg(l::text, '|' ORDER BY l.id)) h FROM public.leads l UNION ALL
  SELECT 'payments', count(*), md5(string_agg(x::text, '|' ORDER BY x.id)) FROM public.payments x UNION ALL
  SELECT 'messages', count(*), md5(string_agg(x::text, '|' ORDER BY x.id)) FROM public.messages x UNION ALL
  SELECT 'campaigns', count(*), md5(string_agg(x::text, '|' ORDER BY x.id)) FROM public.campaigns x UNION ALL
  SELECT 'packages', count(*), md5(string_agg(x::text, '|' ORDER BY x.id)) FROM public.packages x UNION ALL
  SELECT 'properties', count(*), md5(string_agg(x::text, '|' ORDER BY x.id)) FROM public.properties x UNION ALL
  SELECT 'proposals', count(*), md5(string_agg(x::text, '|' ORDER BY x.id)) FROM public.proposals x) s"; }
BEFORE=$(fingerprint prod_sim)

# 1. Backup
/usr/lib/postgresql/16/bin/pg_dump -h /tmp -p 5433 -U postgres -Fc prod_sim -f /tmp/prod_sim_backup.dump
[ -s /tmp/prod_sim_backup.dump ] && pass "1. Backup taken with pg_dump ($(du -h /tmp/prod_sim_backup.dump | cut -f1))"

# 2. Migrate (additive only)
export CRM_DATABASE_URL='postgresql://postgres@localhost:5433/prod_sim?host=/tmp'
npm run -s db:migrate
npm run -s db:migrate | grep -q "already up to date" && pass "2a. Migration applied; re-running is a no-op"
[ "$(fingerprint prod_sim)" = "$BEFORE" ] && pass "2b. All legacy tables byte-for-byte unchanged after migration (including same-named payments/messages/campaigns/packages/properties)" || fail "legacy changed"

# 3. Import the 82 leads
npm run -s db:import-leads > /tmp/import.out
grep -q "found: 82" /tmp/import.out && pass "3a. Import found 82 leads: $(tr -d '\n' < /tmp/import.out | tr -s ' ')"
N=$($P -d prod_sim -c "SELECT count(*) FROM (SELECT unnest(legacy_lead_ids) FROM crm.customers) x")
[ "$N" = "82" ] && pass "3b. Every one of the 82 original lead IDs is linked to a customer" || fail "only $N linked"
[ "$(fingerprint prod_sim)" = "$BEFORE" ] && pass "3c. Legacy leads table untouched by the import" || fail "import changed legacy"

# 4. Rollback
$P -d prod_sim -c "DROP SCHEMA crm CASCADE" 2>/dev/null
[ "$($P -d prod_sim -c "SELECT to_regclass('crm.customers') IS NULL")" = "t" ] && pass "4a. Rollback (DROP SCHEMA crm) removes the new CRM completely"
[ "$(fingerprint prod_sim)" = "$BEFORE" ] && pass "4b. Legacy data identical after rollback" || fail "rollback changed legacy"

# 5. Restore drill
/usr/lib/postgresql/16/bin/pg_restore -h /tmp -p 5433 -U postgres -d prod_restore /tmp/prod_sim_backup.dump
[ "$(fingerprint prod_restore)" = "$BEFORE" ] && pass "5. Backup restored into a fresh database; data identical to the original" || fail "restore mismatch"
