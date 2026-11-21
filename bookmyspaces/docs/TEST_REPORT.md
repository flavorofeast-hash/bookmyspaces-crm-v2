# BookMySpaces CRM v2 — Test Report

Run: 21 Nov 2026, test environment (local PostgreSQL 16 + production build of the app + Chrome). Every test listed was actually executed; nothing is reported as passed without running.

| Suite | Result |
|---|---|
| Integration tests (business rules against a real database) | 56 / 56 passed |
| Browser acceptance test (real Chrome, real screens) | 32 / 32 passed |
| Backup / migration / rollback / restore drill | 9 / 9 passed |
| Type check (tsc) and production build | clean |
| Dependency security audit (npm audit, production) | 0 known vulnerabilities |

## What was NOT tested against the real services (and why)

- **Real Meta WhatsApp / Facebook / Instagram**: no access to a Meta test app or tokens in this session. These were tested against a local stand-in for graph.facebook.com that returns Meta-shaped success and error responses, and with real HMAC-signed webhook payloads. Final confirmation needs one live test (see the delivery report).
- **Real Supabase**: no Supabase access (the dashboard is not signed in, and no credentials were available). The migration was tested on PostgreSQL 16 with a Supabase-style `extensions` schema and a simulated copy of the legacy production tables.
- **Vercel deployment**: no deploy access (GitHub push was not permitted for this session).

## Browser acceptance test (owner’s acceptance list)

| # | Step | Result | Detail |
|---|---|---|---|
| 1 | Logged-out visitor is sent to login (all six modules) | PASS |  |
| 2 | 1. Log in (wrong password refused, right password accepted) | PASS |  |
| 3 | Today shows check-ins, events, follow-ups, balances, activity | PASS |  |
| 4 | 2. Add a customer | PASS | /customers/6ca4e056-cd6f-4693-a1ae-6dba26b254e9 |
| 5 | Duplicate detection (same mobile typed differently) | PASS |  |
| 6 | 3. Record an enquiry from the customer (hall, evening slot) | PASS | /bookings/054d8760-a60d-44a0-818a-3b811e953733 |
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

Screenshots of each step: `test-artifacts/*.png` (also delivered with this report).

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
| phone normalisation | normalises Indian numbers in every common format to 91XXXXXXXXXX | PASS |
| customers | creates a customer with normalised phone and WhatsApp defaulting to phone | PASS |
| customers | detects a duplicate typed in a different format | PASS |
| customers | rejects an invalid number and a missing name | PASS |
| customers | edits a customer and blocks changing to another customer’s number | PASS |
| customers | searches by name, partial mobile and email | PASS |
| customers | adds and completes a follow-up | PASS |
| legacy lead import (82 leads) | imports all 82, merges duplicates by phone, keeps incomplete records and preserves originals | PASS |
| legacy lead import (82 leads) | is safe to run twice (nothing duplicated) | PASS |

## Backup, migration, rollback and restore drill

Simulated production database: the legacy tables (`leads` with 82 rows, plus `payments`, `messages`, `campaigns`, `packages`, `properties`, `settings`, `proposals` — names that also exist in the new CRM).

- PASS 1. Backup taken with pg_dump (20K)
- PASS 2a. Migration applied; re-running is a no-op
- PASS 2b. All legacy tables byte-for-byte unchanged after migration (including same-named payments/messages/campaigns/packages/properties)
- PASS 3a. Import found 82 leads: { found: 82, created: 74, merged: 8, skipped: 0, noPhone: 6 }
- PASS 3b. Every one of the 82 original lead IDs is linked to a customer
- PASS 3c. Legacy leads table untouched by the import
- PASS 4a. Rollback (DROP SCHEMA crm) removes the new CRM completely
- PASS 4b. Legacy data identical after rollback
- PASS 5. Backup restored into a fresh database; data identical to the original

## How to re-run
```
npm test                       # integration tests (needs TEST_DATABASE_URL or local Postgres on /tmp:5433)
tests/e2e/run-local.sh         # browser acceptance test
tests/e2e/backup-rollback.sh   # backup / rollback drill
```
