# BookMySpaces CRM v2 — Deployment Guide

Prepared 22 Nov 2026. Live V3 is untouched. Nothing below changes production until **Part D**, and each step there needs your approval.

## Facts this guide relies on (checked 22 Nov 2026)
- GitHub `main` = `fc46825` (live V3). Branch `simplify` (v2, tip commit "Deployment guide v1 (final prep commit)"), built on `main`, changes only `bookmyspaces/` and `archive/`.
- Vercel deploys this repo through its GitHub app (`vercel[bot]`). Only `main` goes to **Production**.
- **Automatic Preview builds have been off since mid-2026.** The last Preview was 28 May 2026; the branch pushed on 15 Jul 2026 and `simplify` (pushed 22 Nov 2026) got none. A Preview must be created from the Vercel dashboard (Part C).
- `simplify` was pushed to GitHub on 22 Nov 2026 (tip `6843a9a`); `main` stayed `fc46825`.
- Vercel team: `raju1605jobs-hashs-projects`, project `bookmyspaces-crm-v2`, region `bom1`. The app lives in the `bookmyspaces/` folder (same as V3, so the Root Directory setting needs no change).
- A clean install (`npm ci`) and production build of `simplify` succeed with no environment variables. Without `CRM_DATABASE_URL` the site only shows setup instructions and refuses webhooks (HTTP 503).

## Part A — Push `simplify` to GitHub (main is not modified)

Run on your computer, in `Desktop\BookMySpaces_CRM_v2_Final\NEW_CRM_v2` (PowerShell or Git Bash), signed in to GitHub as **raju1605jobs-hash**:

```
git clone bookmyspaces-crm-v2_with-simplify-branch.bundle crm-v2
cd crm-v2
git checkout simplify
git log --oneline -1                      # must show "Deployment guide v1 (final prep commit)"
git remote set-url origin https://github.com/raju1605jobs-hash/bookmyspaces-crm-v2.git
git fetch origin main
git merge-base --is-ancestor origin/main simplify && echo "OK: simplify is built on the current main"
git push origin simplify                  # pushes ONLY the simplify branch
```

Safety: `git push origin simplify` sends only that branch. Never run `git push origin main` or `git push --all` until Part D.
If `merge-base` prints nothing, someone changed `main` since 21 Nov: stop and tell Claude.

## Part B — Environment variables (Vercel → bookmyspaces-crm-v2 → Settings → Environment Variables)

Enter values yourself; never paste them into chat. For each variable choose the environment(s) shown.

| Variable | Preview (testing) | Production (go-live) | Where to get the value |
|---|---|---|---|
| `CRM_DATABASE_URL` | **Test** Supabase project | Production Supabase project | Supabase → Project Settings → Database → Connection string → **Session pooler** (port 5432) |
| `SESSION_SECRET` | not needed | optional (if empty, a random key is generated and kept in the database) | Any password generator |
| `CRM_SETUP_CODE` | not needed | **required**, 8+ characters | You choose; only used once on `/setup` |
| `APP_PUBLIC_URL` | optional (the preview address) | `https://bookmyspaces-crm-v2.vercel.app` (or your domain) | Vercel deployment page |
| `WHATSAPP_ACCESS_TOKEN` | **Meta test app** token (or leave empty) | existing live value (already set) | Meta app → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | **test** number ID (or empty) | existing live value (already set) | same |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | test value | existing live value (already set) | your choice / existing |
| `WHATSAPP_APP_SECRET` | **test app** secret | live app secret (**new: required**) | Meta app → Settings → Basic → App secret |
| `META_PAGE_ID` | optional | optional | Facebook Page → About → Page ID |
| `META_PAGE_ACCESS_TOKEN` | optional | optional | Meta app → Graph API Explorer → Page token with `pages_manage_posts` |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | optional | optional | Graph API: `/{page-id}?fields=instagram_business_account` |

Important for Preview: if the existing `WHATSAPP_*` values are set for **All Environments**, the preview would send through your **live** WhatsApp number. Before testing replies on the preview, give Preview its own (test app) values or leave them empty for Preview.

Variables the V3 site uses that v2 ignores (leave them until V3 is retired): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_*`, `WATI_*`, `CRON_SECRET`, `DATABASE_URL`.

## Part C — Preview deployment and testing
1. **Test database:** create a **free** Supabase project `bookmyspaces-test` (separate from production). In its SQL Editor run `db/test-data/legacy_leads_82_TEST.sql` (82 synthetic leads; it refuses to run on a database that has legacy tables).
2. **Remove production secrets from Preview:** Vercel → Settings → Environment Variables. For each existing variable that is ticked for *Preview* (especially `WHATSAPP_*`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_*`): **Edit → untick Preview** (keep Production ticked). This only removes them from Preview; the Production values are not changed.
3. **Add one Preview-only variable:** `CRM_DATABASE_URL` = the test project's Session pooler string. Tick **Preview only**. Nothing else is required for Preview.
4. **Create the Preview:** Vercel → Deployments → **Create Deployment** (or ⋯ menu) → Git reference **`simplify`** → Deploy. (Or Settings → Git → check "Ignored Build Step" is *Automatic*, then any push to `simplify` builds a Preview.) The address will look like `bookmyspaces-crm-v2-git-simplify-raju1605jobs-hashs-projects.vercel.app`.
5. **Protection:** previews are normally behind "Vercel Authentication". For automated testing, create a **Protection Bypass for Automation** (Settings → Deployment Protection) and give it to Claude through a secure channel, or temporarily turn protection off for Preview.
6. Open `<preview>/setup` → **Set up test copy** (one click: creates the `crm` tables and the shared login **admin / admin**). This button only exists on Preview; production requires the setup code and a strong password.
7. Try the workflow: Settings (properties, rooms) → + New enquiry → New booking → Confirm → Record payment → receipt → balance.
8. WhatsApp test (optional): Meta test app webhook → `<preview>/api/whatsapp/webhook`. Vercel preview protection blocks Meta; either disable "Vercel Authentication" for previews temporarily or add a Protection Bypass.

## Part D — Production go-live (each step needs your approval)
1. **Backup**: Supabase (production) → Database → Backups → confirm a backup from today, **or** download one. Do not continue without it.
2. Production variables: set `CRM_DATABASE_URL` (production pooler string), `CRM_SETUP_CODE`, `APP_PUBLIC_URL`, and **`WHATSAPP_APP_SECRET`** (`SESSION_SECRET` optional). The other `WHATSAPP_*` are already set.
3. Note the current production deployment in Vercel (Deployments → the one marked Production) — this is the instant rollback target.
4. Merge: on GitHub open a Pull Request `simplify → main` and merge it (or `git checkout main && git merge --ff-only simplify && git push origin main`). Vercel deploys to production.
5. Open `/setup` once → **Create database tables** (adds the `crm` schema only; legacy tables untouched) → create the shared login (username `admin` or your choice + a **strong** password, 10+ characters; `admin/admin` is refused on production).
6. Settings → **Import old leads** (82 expected; safe to repeat).
7. Smoke test: log in, add a test enquiry, open Inbox, send yourself a WhatsApp message to the business number and check it appears.
8. The live Meta webhook URL (`/api/whatsapp/webhook`) stays the same — **no Meta dashboard change**.

## Rollback (any time)

Full details, with application and database rollback documented separately: `docs/ROLLBACK.md`.

- **Code**: Vercel → Deployments → previous production deployment → ⋯ → **Promote to Production** (about a minute). V3 is back exactly as before because its tables were never changed.
- **Database (optional)**: the v2 data lives only in schema `crm`. To remove it: `DROP SCHEMA crm CASCADE;` (legacy `public` tables are unaffected). Only do this after exporting anything you want to keep.
- **Git**: `main` can be reset to `fc46825` by reverting the merge commit; the backup bundles in `_backups/2026-11-21/` hold the full original history.

## Shared team login
- One username/password for the whole team (no individual staff accounts). Several people can be signed in at once on different devices.
- **Preview/test copy:** `admin` / `admin`. A yellow banner reminds you it is the test password.
- **Production:** `admin/admin` and other weak passwords are refused — both when creating and when signing in. Set a strong one on `/setup`, in Settings → Login, or with `npm run db:set-password -- admin '<strong password>'`.
- Settings → Login: change username, change password (signs out every other device), sign out all devices.
- Environment detection: Vercel sets `VERCEL_ENV` (`preview`/`production`). Self-hosted `next start` counts as production unless `CRM_ENV=preview` is set.
