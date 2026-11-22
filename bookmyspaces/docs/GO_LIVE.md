# BookMySpaces CRM V2 — Production go-live checklist

Status 22 Nov 2026: Preview accepted (19/19 hosted tests). Nothing below has been run on production yet.

## How production is laid out
| | V3 (today) | V2 (after switch) |
|---|---|---|
| Vercel project | `bookmyspaces-crm-v2` (unchanged; also serves the public website) | `bookmyspaces-crm-next` (separate project) |
| Team URL | bookmyspaces-crm-v2.vercel.app | **https://bookmyspaces-crm-next.vercel.app** (domain can be renamed for free) |
| Code | flavorofeast-hash/bookmyspaces-crm-v3 | fork flavorofeast-hash/bookmyspaces-crm-v2, branch `simplify` |
| Database | Supabase project `nssteddtqgqubggpcwae`, schema `public` | same project, **new schema `crm` only** |

- Vercel Standard Protection keeps Previews private but leaves the **production domain public**, so the team needs no Vercel accounts. Every CRM page, action and document requires the CRM login; only `/login`, `/setup` (locked by setup code once set up), customer document links with random tokens (`/d/…`), the signed WhatsApp webhook and `/api/health` (no data) are public.
- V2 never writes to V3's tables. The lead import only **reads** `public.leads`.

## 1. Owner login (required)
Sign in to the Supabase account that owns project `nssteddtqgqubggpcwae` (not flavor.of.east@gmail.com — that account cannot see it).

## 2. Backup — must pass before anything else
1. Supabase → project → Database → Backups: note the plan. Free plan = **no automatic backups**.
2. SQL editor → run `db/ops/preflight_readonly.sql` (changes nothing). Record legacy lead count.
3. SQL editor → run `db/ops/backup_v3_snapshot.sql`. Every row must show **OK**. This copies all V3 tables into `backup_v3_20261122` without touching V3.
4. Optional off-site copy: Table Editor → each table → Export CSV (or `pg_dump` with the Session pooler string).

## 3. Production database connection (no credentials pass through chat)
Choose one, **Production environment only, never Preview**:
- A. Supabase → Project Settings → Integrations → Vercel → connect `bookmyspaces-crm-next`, Production only (adds `POSTGRES_URL`, which V2 reads only in production), or
- B. Vercel → `bookmyspaces-crm-next` → Settings → Environment Variables → `CRM_DATABASE_URL` = Supabase "Session pooler" string, Production only.

Also add `CRM_SETUP_CODE` (any 8+ characters only you know), Production only.

## 4. Deploy V2 to its own production URL
Vercel → `bookmyspaces-crm-next` → Settings → Git → Production Branch = `simplify` → redeploy. (The fork's `main` is old code and must never be the production branch.) V3 is not touched.

## 5. First-time setup on production (the only database change)
`https://bookmyspaces-crm-next.vercel.app/setup` → setup code → **Create database tables** (creates schema `crm`) → create the shared login: username (e.g. `admin`) + **strong password** (10+ characters, not easy to guess). admin/admin is refused on production, at setup and at sign-in.

## 6. Configure and import
1. Settings → business details, properties, rooms/halls/rooftop, prices, packages (test-copy settings are not copied).
2. Settings → Import old leads → **Import old leads now**. Expect: Found N (from preflight), merged duplicates, leads without mobile kept and flagged. Press again: 0 new.

## 7. Go-live checks
- Private/incognito window: production URL opens the CRM login (no Vercel login screen).
- `BASE=https://bookmyspaces-crm-next.vercel.app node tests/e2e/forged-session-check.mjs` → PASS.
- Create one test enquiry → booking → advance → receipt; then cancel it.
- Share the URL + shared password with the team.

## Decisions for the owner
- Production URL name (keep `bookmyspaces-crm-next.vercel.app` or rename, e.g. `bookmyspaces-crm.vercel.app`).
- WhatsApp: keep the webhook on V3 for now, or move it to V2 (set `WHATSAPP_*` in `bookmyspaces-crm-next` Production + change the Meta webhook URL to `…/api/whatsapp/webhook`). Only one site can receive messages.
- Facebook/Instagram publishing: needs `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` (optional).
- When to stop using V3 for new enquiries (after the switch, new work should go into V2 only).
- Supabase Pro ($25/month) for automatic daily backups — optional; otherwise repeat step 2 periodically.

## Rollback (kept separate)
**Application:** V3 is never changed, so returning is "use the V3 URL again". If a V2 release misbehaves, Vercel → `bookmyspaces-crm-next` → Deployments → previous deployment → Instant Rollback.
**Database:** V2 data lives only in schema `crm`. To remove V2 completely: `DROP SCHEMA crm CASCADE;` (V3 tables untouched). V3 data can be restored table-by-table from `backup_v3_20261122`. Bookings/payments entered in V2 after the switch are not in V3 — note them before removing V2.
