# Current rollback points (24 Nov 2026) — V2 on its own database

**Code:** Vercel → project `bookmyspaces-crm-next` → Deployments. Last known-good before the handover changes: `dpl_BxtZS1DhbuBw6NQsZ3nyH59a55DC` (commit `edaab87`). Open it → **⋯ → Promote to Production / Instant Rollback**. Git copy: branch `rollback-2026-11-24` on raju1605jobs-hash/bookmyspaces-crm-v2.

**Database:** production Supabase project `psewvydpcmyerxfrweky` has a full snapshot of every `crm` table in schema `crm_backup_20261124` (taken before the handover changes; row counts verified: 68 customers, 2 bookings, 3 payments, 5 documents, 18 spaces). To inspect: SQL editor → `select * from crm_backup_20261124.customers`. Restore a table only after checking with the owner, e.g. `insert into crm.customers select * from crm_backup_20261124.customers b where not exists (select 1 from crm.customers c where c.id=b.id);`. The 24 Nov schema change (migration 005) only added a nullable `bookings.assigned_to` column; rolling back the code does not need a database change.

**V3** (bookmyspaces-crm-v2.vercel.app, its own database) is untouched and remains the fallback. Original V3 export: `bookmyspaces_v3_export_2026-11-23.json` in the Desktop folder BookMySpaces_CRM_v2_Final.

---

# BookMySpaces CRM v2 — Rollback procedures

Application rollback and database rollback are **independent**. Most problems need only the application rollback. The database rollback is rarely needed, because going live never changes or deletes the old tables.

---

## 1. Application rollback (code) — use this first

**What it does:** puts the previous version of the website back. Data in the database is not touched.

**When:** the new version misbehaves, a page fails, or you simply want V3 back.

**Before go-live, write down the rollback target:** Vercel → project `bookmyspaces-crm-v2` → **Deployments** → the deployment currently marked **Production** (today: built from commit `fc46825`, deployed 19 Jul 2026). Note its URL.

**Steps (about 1 minute, no code needed):**
1. Vercel → `bookmyspaces-crm-v2` → **Deployments**.
2. Find the previous production deployment (the V3 one noted above).
3. Click **⋯ → Promote to Production** (on some plans: **Instant Rollback**).
4. Open https://bookmyspaces-crm-v2.vercel.app/api/health. V3's health report (with `"checks"` and `"82 leads"`) means V3 is back.

**What happens to v2 data:** nothing. Anything entered in v2 stays in the `crm` schema, unused by V3, and is there again if you re-promote v2.

**WhatsApp:** the webhook URL is the same for V3 and v2, so after rollback new messages go to V3 again. No Meta change is needed.

**Optional, to make it permanent in git** (only if you will not re-try v2 soon): on GitHub open a Pull Request that reverts the merge commit of `simplify` into `main`. Until you do, the next push to `main` would deploy v2 again.

**Preview-only stage:** there is nothing to roll back. A Preview never affects production. To remove it, delete the `simplify` branch on GitHub or delete the preview deployment in Vercel.

---

## 2. Database rollback — only if really needed

**What v2 changes in the database:** going live (`/setup` → Create database tables) **only adds** a new schema `crm` with its own tables. The 50 legacy tables in `public` (leads, proposals, payments, conversations, …) are **not changed, moved or deleted**. The 82-lead import **reads** `public.leads` and copies into `crm.customers`; the original rows stay.

So V3 works on the same database whether or not the `crm` schema exists. The application rollback above is enough to return to V3.

**Remove the v2 data entirely (rarely needed):**
1. Make a backup first (Supabase → Database → Backups, or `pg_dump`). The v2 data is deleted by the next step.
2. Supabase → SQL Editor, run:
   ```sql
   DROP SCHEMA crm CASCADE;
   ```
3. Check that legacy data is intact: `SELECT count(*) FROM public.leads;` (expect 82).

**Restore the whole database to a backup (last resort, e.g. if someone changed legacy tables by hand):**
- Supabase → Database → Backups → choose the backup → **Restore** (paid plans), **or**
- from a `pg_dump` file: `pg_restore --clean --if-exists -d "<connection string>" backup.dump`.
- This overwrites everything since the backup, including V3 enquiries received since then. Use only with care.

**Tested:** on a simulated copy of production with Supabase-style roles, the backup → add CRM → import 82 leads → `DROP SCHEMA crm` → restore sequence kept the legacy data byte-for-byte identical (`tests/e2e/backup-rollback.sh`, 12/12 checks, 22 Nov 2026).

---

## 3. Quick decision table

| Situation | Do |
|---|---|
| v2 has a bug, want V3 back now | 1. Application rollback |
| Want to try v2 again later | Re-promote the v2 deployment (data still there) |
| Want v2 data gone for good | 1. Application rollback, then 2. `DROP SCHEMA crm CASCADE` after a backup |
| Legacy tables damaged (not caused by v2) | Restore a database backup |
