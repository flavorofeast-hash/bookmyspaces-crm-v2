# WhatsApp: move from the old CRM (V3) to BookMySpaces CRM V2

**Owner approval is needed for step 4.** Until then V3 keeps working exactly as today.

## What V2 does (same as V3, plus more)
| | V3 (live today, commit b65414e) | V2 |
|---|---|---|
| Meta verification + signature check | yes | yes (rejects unsigned/forged requests) |
| New number → customer; existing number → matched | yes | yes |
| Duplicate deliveries ignored | partly | yes (by WhatsApp message id) |
| AI reply to each message | yes (Claude Haiku, OpenAI backup) | yes — same models, **owner switch**, uses only approved rates/packages, never confirms availability, blocks unapproved prices |
| Hand over to staff (asks for person, complaint, refund, payment, unsure) | yes | yes — chat marked “Needs staff”, AI stops until staff resume it |
| Photos, voice notes, documents from customers | ignored | stored and viewable in the Inbox |
| Staff reply, quick replies, templates, attachments | text only | text, approved quick replies, templates, photos/PDF/audio/video |
| Delivery / read ticks | logged only | shown on each message |
| Promotion code → campaign and property | no | yes |
| Failed deliveries | logged | kept in Settings → Connections with **Retry** |

## Step 1 — Copy the settings into V2 (owner, ~5 min)
In Vercel → project **bookmyspaces-crm-v2** (the old CRM) → Settings → Environment Variables, open each value below and add the same value to project **bookmyspaces-crm-next** (V2) → Settings → Environment Variables, environment **Production** only:

| Name | Notes |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | same token |
| `WHATSAPP_PHONE_NUMBER_ID` | the Production value |
| `WHATSAPP_APP_SECRET` | same Meta app secret |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | **choose a new random value** (the old one is written in a public GitHub file) |
| `ANTHROPIC_API_KEY` | for AI replies (same key V3 uses) |
| `OPENAI_API_KEY` | optional backup, as on V3 |
| `ANTHROPIC_MODEL` | optional; V2 defaults to the same model as V3 (claude-haiku-4-5-20251001) |

Then Deployments → latest → ⋯ → **Redeploy**. Nothing changes for customers yet: Meta still sends messages to V3.

## Step 2 — Check V2 (owner)
1. V2 → Settings → Connections: WhatsApp receive, WhatsApp send and AI replies show **Set**.
2. Open in a browser (put your new verify token in place of TOKEN):
   `https://bookmyspaces-crm-next.vercel.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=ok` → the page shows **ok**.

## Step 3 — Test in parallel, with your own phone
1. From your phone, send any WhatsApp message to the business number (V3 answers as usual; this opens WhatsApp’s 24-hour window).
2. V2 → Settings → Connections → **AI replies on WhatsApp → Switch on**.
3. V2 → Settings → Connections → **Test an incoming WhatsApp enquiry**: name `ZZ TEST Owner`, your mobile, a question such as “Do you have rooftop parties?”, tick **Also let the AI reply** → **Run test message**. The AI reply arrives on your phone from the business number, and the conversation shows in V2 Inbox marked **AI reply**.
4. In that conversation type a reply and press **Send on WhatsApp**, then send a small PDF with **Send file** — both arrive on your phone and show your name.
5. Ask “can I book 14 Feb for 30 people?” in another test → the chat is marked **Needs staff**.

## Step 4 — Switch the webhook (only with owner approval)
Meta for Developers → app **BMS Hospitality** → WhatsApp → **Configuration** → Webhook → **Edit**:
- Callback URL: `https://bookmyspaces-crm-next.vercel.app/api/whatsapp/webhook`
- Verify token: the new `WHATSAPP_WEBHOOK_VERIFY_TOKEN` value
- **Verify and save**, and check that the **messages** field is subscribed.

From this moment Meta sends messages only to V2, so customers never get two replies.

## Step 5 — Verify (5 min)
Send a message from your phone: it appears in V2 Inbox within seconds; the AI reply (if switched on) arrives; the reply’s ticks change to delivered/read. Check Settings → Connections → “deliveries that failed to process” shows **None**.

V3 still runs two scheduled jobs that send WhatsApp messages on their own (daily follow-ups at 14:30 IST and the campaign queue at 17:30 IST). After the switch, decide whether to keep them: they would not show in V2’s Inbox. To stop them: Vercel → bookmyspaces-crm-v2 → Settings → Cron Jobs → disable `/api/cron/followups` and `/api/cron/campaign-queue` (re-enable for rollback).

## Rollback (2 min)
Meta → Configuration → Webhook → Edit → Callback URL `https://bookmyspaces-crm-v2.vercel.app/api/whatsapp/webhook` with the **old** V3 verify token → Verify and save. V3 was never changed, so it carries on immediately. Re-enable its cron jobs if you disabled them.
