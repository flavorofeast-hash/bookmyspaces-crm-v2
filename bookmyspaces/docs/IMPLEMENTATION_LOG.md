# Implementation log — 21 Nov 2026

| Time (IST) | What | Result |
|---|---|---|
| 10:00 | Backups: full-history bundle of GitHub repo (208 commits, 9 branches, 12 tags), Desktop git bundle + full file archive (383 files), deployment snapshot (no secrets) | Saved to Desktop › BookMySpaces_CRM_v2_Final › `_backups/2026-11-21/`; both bundles test-restored |
| 10:25 | Tried GitHub write access for a `simplify` branch | **Denied** by the session's permission system → work kept on a local branch and delivered to the Desktop |
| 10:28 | Local PostgreSQL 16 test database started; schema design | — |
| 10:30 | New schema `crm` (separate from legacy `public` tables): customers, properties, spaces, slots, packages, bookings, booking_items, payments, documents, counters, messages, campaigns, posts, media, activity | Database-level double-booking guard (exclusion constraint) and locked gap-free numbering verified by hand |
| 10:35–10:55 | Business rules: customers + phone de-duplication + legacy import, bookings + availability, billing (quotation/bill/receipt/refund/void), WhatsApp (webhook, signature, 24 h window, templates, delivery status), marketing (campaigns, tracking links, Facebook/Instagram publishing confirmed by post ID), Today | 56 integration tests written and passing |
| 10:55–11:10 | Screens for all six modules + Settings + login + first-time setup + printable documents | Build passes |
| 11:10 | Realistic sample data script; local end-to-end run with a stand-in for Meta's API | First run: 27/32. Fixed 2 real bugs (lost messages after Settings saves; customer not shown on new-booking screen) and 3 test errors → 32/32 |
| 11:20 | Backup/migration/rollback/restore drill on a simulated production copy | 9/9 — legacy tables byte-for-byte unchanged |
| 11:25 | Supabase dashboard checked in the built-in browser | Not signed in → production backup **not verifiable** from here |
| 11:30 | Security audit: Next.js 14 (also used by the old CRM) is out of support with critical advisories | Upgraded to Next.js 15.5.29 / React 19 (same stack, patched line); removed unused `zod`; pinned patched PostCSS → **0 known vulnerabilities** |
| 11:40 | Full re-test on the upgraded framework | 56/56 integration, 32/32 browser, 9/9 drill |

## Key decisions
- **Separate `crm` schema** instead of rewriting legacy tables: the production migration only adds new tables, never alters or drops old ones, and rollback is `DROP SCHEMA crm CASCADE`.
- **App-managed login** (scrypt-hashed passwords in `crm.app_users`, signed session cookie) instead of Supabase Auth: fewer moving parts, fully testable, and the database is reached only from the server (`CRM_DATABASE_URL`). The `crm` schema is not exposed through Supabase's public API.
- **No background jobs**: follow-ups are reminders on Today; nothing messages customers automatically except the optional first-message auto-reply.
- **AI retired**: no Anthropic/OpenAI calls remain.
- **Documents are HTML print pages** ("Save as PDF"): no paid PDF service.
- **Images stored in the database** (≤5 MB JPG/PNG): no storage service to configure.

## Removed
18 old screens, 44 of 48 old API endpoints, all AI features, Google Sheets sync, both cron jobs, 14 packages (`@anthropic-ai/sdk`, `openai`, `ai`, `googleapis`, `mammoth`, `pdf-parse`, `multer`, `xlsx`, `framer-motion`, `recharts`, `react-hook-form`, `@hookform/resolvers`, `uuid`, `zod`), repair scripts and ~70 audit reports. The previous application is preserved in `archive/v3-app`, in git history and in the backup bundles. Legacy database tables are untouched.
