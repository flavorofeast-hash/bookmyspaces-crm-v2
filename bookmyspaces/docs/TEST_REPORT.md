# Hosted Preview acceptance — 22 Nov 2026 (real Vercel Preview, real Supabase test DB)

- URL: https://bookmyspaces-crm-next-git-simplify-raju1605jobs-hashs-projects.vercel.app (Vercel project `bookmyspaces-crm-next`, fork `flavorofeast-hash/bookmyspaces-crm-v2`, branch `simplify`, commit 000ea2d)
- DB: separate Supabase test project via Vercel integration, Preview-only `CRMTEST_*` variables. Live V3 project/alias untouched.
- Driven in a real browser against the deployed site. WhatsApp/Facebook/Instagram NOT live-tested (no test credentials; correctly shown as not connected).

| # | Test | Result |
|---|---|---|
| 1 | Health endpoint; DB reachable; WhatsApp/Meta off in Preview | PASS |
| 2 | One-click test setup → crm tables + shared login admin/admin; default-password banner | PASS |
| 3 | Settings: business, 2 properties, 4 rooms (bulk) + 2 family rooms, hall, rooftop, package | PASS |
| 4 | Import 82 legacy leads: 74 new, 8 merged, 6 without mobile; re-run 0 new / 82 already imported | PASS |
| 5 | Add customer; duplicate mobile in different format redirects to existing record | PASS |
| 6 | Hall enquiry; second enquiry same hall/time allowed as tentative ("Enquiry pending") | PASS |
| 7 | Two tabs, same admin login, both "Confirm booking" fired at the same instant → one confirmed, other "Double booking prevented" | PASS |
| 8 | Food line + quotation QT-; total ₹60,000 | PASS |
| 9 | Advance ₹20,000 UPI → RCP-2026-0001, printable receipt, balance ₹40,000; Billing + Today show outstanding | PASS |
| 10 | Final bill BILL-2026-0001; balance ₹40,000 cash → RCP-2026-0002; balance ₹0 | PASS |
| 11 | Cancel booking (reason required) → hall freed; refund ₹15,000 (reason required, max = paid) → RFN-2026-0001 | PASS |
| 12 | Freed hall: other customer's enquiry now confirms | PASS |
| 13 | Event + stay: rooftop + 2 rooms confirmed (₹20,600); booked hall/rooms shown disabled for overlapping dates | PASS |
| 14 | Search by mobile → full history (quotation, bill, receipts, refund note) | PASS |
| 15 | Today, Bookings calendar, Billing, Inbox, Marketing pages load (200) | PASS |
| 16 | Marketing: campaign + WhatsApp link; draft post saved; publishing disabled (Meta not connected) | PASS |
| 17 | Sign out → protected pages redirect to /login; wrong password refused; admin/admin signs in | PASS |
| 18 | Webhook rejects unverified calls (403); pages refuse framing | PASS |
| 19 | Mobile 375px: no horizontal overflow on Today, Bookings, Settings, booking detail | PASS |

19/19 passed; no fixes needed.

---

# BookMySpaces CRM v2 — Test Report

**Update 22 Nov 2026 (shared login):** re-run after adding the shared `admin` login, one-click Preview setup and DB-stored session key. Results on the new commit:

| Suite | Result |
|---|---|
| Integration tests (real database) | **72 / 72** (adds: shared login on two devices, production refuses admin/admin and weak passwords, password change signs out all devices, username change, DB-stored session key not readable by anon; 5 rounds of two simultaneous confirmations for one hall → exactly one wins each time) |
| Browser acceptance test (real Chrome, local) | **32 / 32** (staff-permission step replaced by: two browsers signed in as `admin` at once confirm the same hall at the same moment → `won / refused`) |
| Migration / 82-lead import / rollback / restore drill | **12 / 12** (now includes 003_shared_login.sql) |
| Preview acceptance script, dry run on empty DB with only `CRM_DATABASE_URL` set | **21 / 21** (one-click setup → admin/admin; 82 leads: 74 new, 8 merged, 6 without phone; re-run 0 new; concurrent shared-login test) |
| Production mode (no `CRM_ENV`), real browser | admin/admin login **refused** with “only allowed on the test copy” |

Not yet run: the same scripts against a **hosted** Vercel Preview (needs the owner's Vercel/Supabase login — see DEPLOYMENT_GUIDE Part C).

---

Run: 22 Nov 2026 on commit 3f09ab7, in a separate test environment (local PostgreSQL 16 with Supabase-style roles and `extensions` schema, production build, real Chrome). Every test listed was executed in this run. Nothing touched production.

| Suite | Result |
|---|---|
| Integration tests (real database) | 66 / 66 passed |
| Browser acceptance test (real Chrome) | 32 / 32 passed |
| Supabase-like migration, 82-lead import, rollback, restore drill | 12 / 12 passed |
| Clean Vercel-style build (`npm ci` + `next build`, no env vars) | passed; site shows setup page, webhook refuses (503) |
| Type check and dependency audit | clean; 0 known vulnerabilities |

## Genuinely functional vs simulated

| Feature | Status |
|---|---|
| Login, sessions, permissions, customers, bookings, availability, double-booking block, billing, refunds, numbering, documents, Today, Settings, lead import | **Functional** — tested end to end against a real database |
| WhatsApp receive/send/status | **Code complete; tested against a simulated Meta API** (real signed webhooks). Needs one live test with a Meta test app |
| Facebook / Instagram publishing | **Code complete; tested against a simulated Meta API**. Needs your Page token for a live test |
| Google Business | **Manual** copy-and-post (functional); automatic posting awaits Google API approval |
| Production database backup | **Not verified** — no Supabase login available to Claude |

## Browser acceptance test

| # | Step | Result | Detail |
|---|---|---|---|
| 1 | Logged-out visitor is sent to login (all six modules) | PASS |  |
| 2 | 1. Log in (wrong password refused, right password accepted) | PASS |  |
| 3 | Today shows check-ins, events, follow-ups, balances, activity | PASS |  |
| 4 | 2. Add a customer | PASS | /customers/946d762e-d367-4298-bbc4-df25a17dfe5c |
| 5 | Duplicate detection (same mobile typed differently) | PASS |  |
| 6 | 3. Record an enquiry from the customer (hall, evening slot) | PASS | /bookings/44f22400-46f0-4adf-9e90-3fdbc9aa2954 |
| 7 | Second customer enquires for the same hall and time (tentative allowed) | PASS |  |
| 8 | 4/5. Convert enquiry into a confirmed booking (availability checked) | PASS |  |
| 9 | 6. Double booking is prevented (database refuses, UI explains who holds it) | PASS |  |
| 10 | Add food line and issue a quotation | PASS |  |
| 11 | 7/8. Record an advance and generate the receipt | PASS | total 60000 |
| 12 | 9. Outstanding balance shown (booking, Billing, Today) and consistent | PASS | balance ₹40,000 |
| 13 | Final bill issued with payments received and balance | PASS |  |
| 14 | 10. Find the customer by mobile and see complete history | PASS |  |
| 15 | Calendar shows the confirmed hall booking | PASS |  |
| 16 | Room booking with multiple rooms + rooftop booking through the UI | PASS |  |
| 17 | Cancel booking and record refund (refund note issued) | PASS |  |
| 18 | WhatsApp: webhook security (unsigned and forged rejected) | PASS | unsigned 401, forged 401, verify OK, wrong token 403 |
| 19 | WhatsApp: incoming message creates customer, appears in Inbox, auto-reply sent | PASS |  |
| 20 | WhatsApp: staff reply sent and shown with status | PASS |  |
| 21 | WhatsApp: delivery status update from Meta shown | PASS | status 200 |
| 22 | WhatsApp: failed send shows the real Meta error | PASS |  |
| 23 | Convert WhatsApp enquiry into a booking (customer prefilled) | PASS |  |
| 24 | Campaign tracking: WINTER26 enquiry counted | PASS | WINTER26 enquiries: 2 |
| 25 | Marketing: create post with image, preview, publish to Facebook & Instagram (confirmed post IDs) | PASS |  |
| 26 | Google Business: manual workflow (copy, open, mark as posted) | PASS |  |
| 27 | Settings: add rooms in bulk (no code needed) | PASS |  |
| 28 | Old-CRM lead import is repeat-safe | PASS |  |
| 29 | Permissions: staff cannot open Settings or void payments | PASS |  |
| 30 | Mobile layout (375×812): Today, booking, customer, inbox | PASS |  |
| 31 | Data persists after restart-equivalent (fresh session reads same records) | PASS |  |
| 32 | Public customer document link works without login | PASS |  |

## Integration tests

| Area | Test | Result |
|---|---|---|
| webhook security | accepts a correctly signed body and rejects unsigned, wrongly signed or tampered bodies | PASS |
| incoming messages | creates a new customer from a first message, saves it and sends one auto-reply | PASS |
| incoming messages | links a second message to the same customer, no second auto-reply, and ignores a duplicate delivery | PASS |
| incoming messages | links to an existing customer entered with a 10-digit number, and records voice notes and locations | PASS |
| incoming messages | tags customers who came from a Facebook/Instagram click-to-WhatsApp ad | PASS |
| sending replies | sends a reply inside the 24-hour window and records the WhatsApp message id | PASS |
| sending replies | shows the real Meta error when sending fails | PASS |
| sending replies | reports a network failure as failed, not sent | PASS |
| sending replies | blocks free text outside the 24-hour window but allows an approved template | PASS |
| sending replies | updates delivery status from Meta, never backwards, and records failure reasons | PASS |
| sending replies | refuses to send when WhatsApp is not configured | PASS |
| billing | issues a quotation (moves enquiry to quoted) | PASS |
| billing | a corrected quotation gets a new number and the old one shows VOID | PASS |
| billing | refuses a bill before confirmation | PASS |
| billing | records an advance (confirming the booking) and issues a receipt with the right balance | PASS |
| billing | refuses a payment larger than the balance | PASS |
| billing | issues the final bill showing payments received and balance | PASS |
| billing | records the balance payment; balance reaches 0 and everything reconciles | PASS |
| billing | voiding a payment keeps the receipt number (VOID) and restores the balance; numbers are never reused | PASS |
| billing | issued documents and payments cannot be edited or deleted | PASS |
| billing | cancellation and refund: refund cannot exceed what was paid; refund note issued | PASS |
| billing | a quotation can be voided by the owner with a reason; receipts cannot be voided directly | PASS |
| billing | 50 simultaneous payments get 50 unique, gap-free receipt numbers | PASS |
| bookings | creates a single-room booking priced per night | PASS |
| bookings | creates a multiple-room booking (wedding guest accommodation) | PASS |
| bookings | creates a hall booking with a package and a rooftop booking | PASS |
| bookings | creates an event with stay (hall + rooms) | PASS |
| bookings | shows availability: booked, tentative and free | PASS |
| bookings | refuses to confirm an overlapping booking for the same hall | PASS |
| bookings | allows the overlapping enquiry but refuses confirming it later | PASS |
| bookings | the database itself rejects a conflicting confirmed line inserted directly | PASS |
| bookings | allows morning and evening functions in one hall on the same day | PASS |
| bookings | allows a room check-out and the next check-in on the same day | PASS |
| bookings | cancelling frees the space for someone else | PASS |
| bookings | adding a conflicting space line to a confirmed booking is refused | PASS |
| bookings | rejects invalid status jumps | PASS |
| campaigns and enquiry tracking | validates campaign codes | PASS |
| campaigns and enquiry tracking | builds a campaign WhatsApp link containing the code | PASS |
| campaigns and enquiry tracking | counts enquiries and confirmed bookings per campaign end to end | PASS |
| content and publishing | saves content with platforms and image | PASS |
| content and publishing | shows Not connected when Meta credentials are missing (no publish button) | PASS |
| content and publishing | Facebook: marks Published only when Meta returns a post id | PASS |
| content and publishing | Facebook: a Meta error is recorded as Failed with the real message, never Published | PASS |
| content and publishing | Instagram: container then publish, using the public image URL | PASS |
| content and publishing | Google Business: manual posting is recorded as posted manually | PASS |
| login security | hashes and verifies passwords | PASS |
| login security | session tokens: valid, tampered, expired | PASS |
| login and sessions | logs in with the right password and sets a signed, httpOnly-style session cookie | PASS |
| login and sessions | refuses a wrong password with a message that does not reveal whether the email exists | PASS |
| login and sessions | locks an email after 10 failures in 15 minutes, even if the 11th password is right | PASS |
| login and sessions | a forged or tampered cookie is not accepted | PASS |
| login and sessions | changing a password signs out existing sessions | PASS |
| login and sessions | a deactivated user is signed out and cannot log in; the last owner cannot be deactivated | PASS |
| login and sessions | staff are refused owner-only actions on the server | PASS |
| login and sessions | passwords are stored only as salted scrypt hashes | PASS |
| database permissions (Supabase roles) | anon and authenticated roles cannot read or write any CRM table, even with Supabase-style default grants | PASS |
| database permissions (Supabase roles) | the server connection (table owner) still works normally | PASS |
| phone normalisation | normalises Indian numbers in every common format to 91XXXXXXXXXX | PASS |
| customers | creates a customer with normalised phone and WhatsApp defaulting to phone | PASS |
| customers | detects a duplicate typed in a different format | PASS |
| customers | rejects an invalid number and a missing name | PASS |
| customers | edits a customer and blocks changing to another customer’s number | PASS |
| customers | searches by name, partial mobile and email | PASS |
| customers | adds and completes a follow-up | PASS |
| legacy lead import (82 leads) | imports all 82, merges duplicates by phone, keeps incomplete records and preserves originals | PASS |
| legacy lead import (82 leads) | is safe to run twice (nothing duplicated) | PASS |

## Migration / import / rollback drill (simulated production with Supabase roles)

- PASS 1. Backup taken with pg_dump (20K)
- PASS 2a. Migration applied; re-running is a no-op
- PASS 2c. Double-booking extension installed in Supabase's extensions schema
- PASS 2d. Supabase public role (anon) is refused access to CRM tables
- PASS 2b. All legacy tables byte-for-byte unchanged after migration (including same-named payments/messages/campaigns/packages/properties)
- PASS 3a. Import found 82 leads: { found: 82, created: 74, merged: 8, skipped: 0, noPhone: 6 }
- PASS 3b. Every one of the 82 original lead IDs is linked to a customer
- PASS 3d. Second import: 82 skipped, customer count unchanged (74) — no duplicates
- PASS 3c. Legacy leads table untouched by the import
- PASS 4a. Rollback (DROP SCHEMA crm) removes the new CRM completely
- PASS 4b. Legacy data identical after rollback
- PASS 5. Backup restored into a fresh database; data identical to the original

## Re-run
```
npm test
tests/e2e/run-local.sh
tests/e2e/backup-rollback.sh
```
