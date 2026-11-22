# BookMySpaces CRM v2

A simple business-management system for BookMySpaces properties: enquiries, customers, bookings, payments, bills, WhatsApp and marketing in one place.

**Six modules:** Today · Customers · Bookings · Billing · Inbox · Marketing (plus Settings for the owner).

Stack: Next.js 14 on Vercel, Postgres on Supabase, Meta WhatsApp Cloud API. No AI services, no paid add-ons, no background jobs.

---

## 1. Going live: what to do (about 20 minutes)

The new CRM keeps all its data in a separate `crm` area of the database. **Old tables are not changed, moved or deleted.** Removing the new CRM is one command (`DROP SCHEMA crm CASCADE`), and old data stays as it was.

### Step 1 — Backup (Supabase)
Supabase → your project → **Database → Backups**. Confirm there is a backup from today, or download one. Free plans have no automatic backups. In that case, take one with `pg_dump` (see section 5).

### Step 2 — Put the code on GitHub
On your computer, in this folder:
```
git push origin simplify
```
Vercel then builds a **preview** for the `simplify` branch automatically. Production is not touched.

### Step 3 — Environment variables (Vercel → Project → Settings → Environment Variables)
For **Preview** only `CRM_DATABASE_URL` is required (one-click setup, shared login admin/admin). Production also needs `CRM_SETUP_CODE` and a strong password. See `.env.example` for details.

| Name | Where to get it |
|---|---|
| `CRM_DATABASE_URL` | Supabase → Project Settings → Database → Connection string → **Session pooler**. For a first test use a separate free Supabase project. |
| `CRM_SETUP_CODE` | Production only: a code only you know (8+ characters) |
| `SESSION_SECRET` | Optional (32+ random characters); generated automatically if empty |
| `APP_PUBLIC_URL` | The site address, e.g. `https://bookmyspaces-crm-v2.vercel.app` |
| `WHATSAPP_*` | Meta app (existing values) + **`WHATSAPP_APP_SECRET`** (Meta App → Settings → Basic → App secret) |
| `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Optional, for Facebook/Instagram publishing |

Redeploy after adding them.

### Step 4 — First-time setup
Open `<site>/setup`:
- **Preview / test copy:** click **Set up test copy** → tables created, shared login **admin / admin**.
- **Production:** setup code → **Create database tables** (only adds the `crm` area) → create the shared login (username + strong password, 10+ characters).

### Step 5 — Enter your business
**Settings** (top of the menu for the owner):
1. **Business details**: name, address, phone, WhatsApp number, UPI ID, bank details, check-in/out times.
2. **Properties**: e.g. Skyline Serenity, MonuRama Homestay.
3. **Rooms & spaces**: add each physical room, hall and rooftop. Several rooms at once: Name `Room`, How many `5`, Numbering from `101` gives Room 101 … Room 105. Set capacity, price and facilities.
4. **Event time slots**: Morning / Evening / Full day (editable).
5. **Packages**: food packages with price per guest or flat.
6. **Staff**: add reception staff (they cannot change Settings or void money records).
7. **Import old leads**: one button imports the 82 old-CRM leads. Every original field is kept, the same mobile number is merged, and leads without a number are kept and flagged. Safe to press twice.

### Step 6 — WhatsApp
Test first with a separate **Meta test app and test number**, with its webhook set to `<preview site>/api/whatsapp/webhook` and the same verify token. When happy, the **live** app needs no Meta change if the site address stays the same. Just make sure `WHATSAPP_APP_SECRET` is set, or incoming messages are refused (by design, for security).

> Vercel preview sites are often password-protected (“Vercel Authentication”). Meta cannot reach a protected preview. Either test WhatsApp on a site without protection, or add a Protection Bypass for the webhook path in Vercel.

---

## 2. Everyday use

| I want to… | Where |
|---|---|
| See what needs attention | **Today** |
| Record a walk-in / phone enquiry | **+ New enquiry** (Today or Customers) |
| Check if a hall/room is free | **Bookings → New booking** → choose dates → *Check availability* |
| Make a quotation | Booking page → **Issue quotation** (or *Save and issue quotation*) |
| Confirm a booking | Booking page → **Confirm booking** (the system refuses if someone else already holds that space and time) |
| Take an advance | Booking page → **Record payment & issue receipt** (can also confirm the booking) |
| Final bill / balance | Booking page → **Issue final bill**, then record the balance payment |
| Cancel & refund | Booking page → **Cancel booking**, then **Record a refund** |
| Send a document to the customer | Document → *Copy customer link* or the **WhatsApp** link next to it |
| Download / print a document | Document → **Print / Save as PDF** |
| Reply to WhatsApp | **Inbox** → choose chat → quick reply or type → Send |
| Plan & publish posts | **Marketing → New post** → Publish to Facebook / Instagram, or copy for Google |
| Track a campaign | **Marketing → New campaign** → copy its WhatsApp link into your posts |

### Money rules (built in)
- Separate numbering: `QT-2026-0001` quotations, `BILL-` bills, `RCP-` receipts, `RFN-` refund notes. Numbers are never reused or duplicated, even when two people save at the same moment.
- Issued documents never change. A correction creates a new document, and the old one shows **VOID**.
- Payments are never deleted. The owner can void one with a reason, and its receipt shows VOID.
- Balance = booking total − payments + refunds. It is calculated the same way on every screen and document.
- No GST in this version. Every line already stores a tax rate (0) and the business settings have a GST-number field, so GST can be added later without a redesign.

---

## 3. What is deliberately not included
- AI chatbot, AI summaries, AI scoring (retired: cost and complexity).
- Automatic follow-up messages and other background jobs. Follow-ups are reminders on Today, so nothing messages customers without you knowing.
- Automatic Google Business posting. Google must approve API access first, so posting is manual (copy & post) until then.

---

## 4. For developers

```
npm install
npm run dev                 # needs CRM_DATABASE_URL (dev = test copy, admin/admin allowed)
npm test                    # 66 integration tests against a real Postgres (TEST_DATABASE_URL)
npm run db:migrate          # apply db/migrations to CRM_DATABASE_URL
npm run db:import-leads     # same as Settings → Import old leads
npm run db:create-owner -- "Name" email 'password'
ALLOW_SAMPLE_SEED=yes npm run db:seed-sample   # TEST database only: realistic sample data
tests/e2e/run-local.sh      # full browser acceptance test (needs local Postgres on /tmp:5433 + Chrome)
tests/e2e/backup-rollback.sh
```

Code map: `src/lib/*` (business rules: customers, bookings, billing, whatsapp, marketing, today), `src/app/(app)/*` (screens), `db/migrations` (schema), `tests/` (integration + e2e). The previous V3 application is preserved under `../archive/v3-app` and in git history.

## 5. Backup & rollback
- **Backup:** Supabase dashboard backups, or `pg_dump -Fc "$CRM_DATABASE_URL" -f backup.dump`.
- **Restore:** `pg_restore -d <database-url> backup.dump`.
- **Remove the new CRM (keep old data):** `DROP SCHEMA crm CASCADE;`
- **Code rollback:** Vercel → Deployments → previous deployment → *Promote to Production* (instant).
