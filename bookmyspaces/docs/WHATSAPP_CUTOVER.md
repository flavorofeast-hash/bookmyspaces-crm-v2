# Moving WhatsApp to the new CRM — owner guide

**Old CRM (V3):** bookmyspaces-crm-v2.vercel.app — answers WhatsApp today.
**New CRM (V2):** bookmyspaces-crm-next.vercel.app — ready, but not receiving WhatsApp yet.

Customers notice nothing until **Part D**, which happens only when you decide. Until then the old CRM keeps answering exactly as now.

You need: a computer, your Facebook login (the one that manages the WhatsApp business number), your Vercel login, your Anthropic (Claude) login, and your own phone.

> **Never paste these values into chat, email or WhatsApp.** Copy them only into the Vercel screen described below.
> **Do not press “Reset” on the Meta App Secret** — that would stop the old CRM immediately.

---

## Part A — Collect 5 values (about 15 minutes)

Keep a private note open (for example Notepad, closed without saving afterwards). Collect:

**1. Phone number ID** (not secret)
Go to developers.facebook.com → **My Apps** → open your WhatsApp app → left menu **WhatsApp → API Setup**. Under “Send and receive messages”, choose your business number in **From** and copy the **Phone number ID** (a long number).

**2. App secret** (secret, copied — not new)
Same app → left menu **App settings → Basic** → next to **App secret** click **Show** → enter your Facebook password → copy it.
(The old CRM uses this same secret. Do not click Reset.)

**3. Access token** (secret, **new** — made only for the new CRM)
Go to business.facebook.com → **Settings** (gear) → **Users → System users**.
- If a system user already exists (the old CRM’s), select it. Otherwise click **Add**, name it `BookMySpaces CRM`, role **Admin**.
- Click **Assign assets** → **Apps** → your WhatsApp app → **Full control**; and **WhatsApp accounts** → your account → **Full control** → Save (skip if already assigned).
- Click **Generate new token** → choose your WhatsApp app → **Token expiration: Never** → tick **whatsapp_business_messaging** and **whatsapp_business_management** → **Generate token** → copy it (Meta shows it only once).
A new token does **not** switch off the old CRM’s token; both work.

**4. Verify token** (secret, **new** — you invent it)
Make up a random code of 32 letters and numbers (for example from a password manager’s generator). Do not reuse the old one: it was written in a public GitHub file.

**5. Claude AI key** (secret, **new** — only needed for AI replies)
Go to console.anthropic.com (it may open as platform.claude.com) → **API keys** → **Create key** → name `BookMySpaces V2` → copy it. Optional: **Limits** → set a monthly spend limit.
(The old CRM’s key cannot be copied: Vercel hides saved values.)

*Optional:* an OpenAI key as a backup (platform.openai.com → API keys → Create). The new CRM works without it.

## Part B — Put the values into the new CRM (about 10 minutes)

**6.** Go to vercel.com → project **bookmyspaces-crm-next** → **Settings → Environment Variables**.
**7.** For each row below click **Add New**, type the **Key** exactly as written, paste the value, under Environments tick **Production only**, switch **Sensitive** on, **Save**:

| Key (type exactly) | Value |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | value 1 |
| `WHATSAPP_APP_SECRET` | value 2 |
| `WHATSAPP_ACCESS_TOKEN` | value 3 |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | value 4 |
| `ANTHROPIC_API_KEY` | value 5 |
| `OPENAI_API_KEY` *(optional)* | OpenAI key |

Do not add anything else. (`APP_PUBLIC_URL` is already working; `ANTHROPIC_MODEL` is optional — the new CRM uses the same Claude model as the old one.)

**8.** Click **Deployments** → newest deployment → **⋯** → **Redeploy** → **Redeploy**. Wait until it says **Ready** (about 2 minutes).
**9.** Close your private note without saving.

Customers still notice nothing: Meta keeps sending messages to the old CRM.

## Part C — Test with your own phone (about 15 minutes)

**10.** Open the new CRM → **Settings → Connections**. These must show **Set**: *WhatsApp — receive messages*, *WhatsApp — send replies*, *AI replies*.
**11.** Paste this address into your browser, replacing `TOKEN` with value 4:
`https://bookmyspaces-crm-next.vercel.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=ok`
The page must show only **ok**.
**12.** From your own phone send “Hi” to the business WhatsApp number. (The old CRM answers as usual — that is expected. This opens WhatsApp’s 24-hour reply window for your number.)
**13.** Work through the **test checklist** below and tick each line.

## Part D — The switch (only when you approve)

**14.** In Meta write down the current webhook first: developers.facebook.com → your app → **WhatsApp → Configuration** → note the **Callback URL** shown (it should be `https://bookmyspaces-crm-v2.vercel.app/api/whatsapp/webhook`). Take a screenshot.
**15.** Click **Edit** → Callback URL: `https://bookmyspaces-crm-next.vercel.app/api/whatsapp/webhook` → Verify token: value 4 → **Verify and save**. Under Webhook fields make sure **messages** is **Subscribed**.
**16.** Immediately stop the old CRM’s automatic WhatsApp jobs so customers only hear from one system: vercel.com → project **bookmyspaces-crm-v2** (the old CRM) → **Settings → Cron Jobs** → **Disable Cron Jobs**. (This stops automatic follow-ups, stay reminders and campaign messages from the old CRM. The old CRM itself stays online.)
**17.** From your phone send a new message → it appears in the new CRM **Inbox** within a few seconds → do the “after the switch” lines of the checklist.

## Undo (2 minutes, any time)
**18.** Meta → your app → WhatsApp → Configuration → **Edit** → put back the Callback URL from step 14 and the old CRM’s verify token → **Verify and save**.
If you don’t have the old verify token (Vercel hides it): vercel.com → old CRM project **bookmyspaces-crm-v2** → Settings → Environment Variables → `WHATSAPP_WEBHOOK_VERIFY_TOKEN` → **Edit** → enter a new random code → Save → Deployments → newest → **Redeploy**; then use that new code in Meta.
**19.** Vercel → old CRM → Settings → Cron Jobs → **Enable**.
The old CRM was never changed, so it carries on at once.

---

## Test checklist

**Before the switch (Part C)** — new CRM → Settings → Connections → *Test an incoming WhatsApp enquiry*. Always use a name starting with `ZZ TEST` and your own mobile.

| # | Do this | You should see | ✓ |
|---|---|---|---|
| 1 | Name `ZZ TEST Owner`, your mobile, message “Do you have rooftop parties?”, **leave the AI box unticked** → Run | Inbox opens; customer shows the message; nothing arrives on your phone | |
| 2 | Run it again with the same mobile and message “Second test” | Same conversation (no second customer) with 2 messages | |
| 3 | Settings → Connections → **AI replies on WhatsApp → Switch on** | Shows **On** | |
| 4 | Test again, message “What do you offer for birthdays?”, **tick “Also let the AI reply”** | A reply arrives on your phone from the business number; in Inbox it is labelled **AI reply** | |
| 5 | Test again with “Can I book 14 Feb for 30 people?” (AI box ticked) | Short polite reply on your phone; the chat is marked **Needs staff**; the AI stops replying | |
| 6 | In that conversation type a reply → **Send on WhatsApp** | Arrives on your phone; Inbox shows your name under it | |
| 7 | **Send file** with a small photo or PDF | Arrives on your phone; shows in Inbox with your name | |
| 8 | Look at the ticks under your replies | Show **sent** (delivered/read only start updating after the switch — Meta still sends ticks to the old CRM) | |
| 9 | Promotion: copy the code from any promotion (Marketing → Promotion Studio), test with “I saw your post (CODE)” | Inbox shows the property and the promotion code for that customer | |
| 10 | Decide: keep AI replies **On** for the switch (like today’s old CRM) or **Off** (staff reply to everything) | — | |

**After the switch (Part D)** — use your own phone, then a second phone (family member) as a new customer.

| # | Do this | You should see | ✓ |
|---|---|---|---|
| 11 | Send a message from your phone | Appears in Inbox in seconds, once only | |
| 12 | Send a photo and a voice note | Both open inside the Inbox | |
| 13 | (AI on) Ask a general question | One AI reply, not two; nothing from the old CRM | |
| 14 | Reply from the Inbox | Ticks change to **delivered**, then **read** after you open it | |
| 15 | Second phone (never contacted you before) sends “Hi” | A **new customer** appears in Customers | |
| 16 | An existing customer messages | Goes into their existing record (no duplicate) | |
| 17 | Settings → Connections → “WhatsApp deliveries that failed to process” | Shows **None** (if not, press **Retry**) | |
| 18 | Next day after 14:30 and 17:30 | No automatic follow-ups or campaign messages from the old CRM | |

If anything in the “after the switch” table fails, do **Undo** (steps 18–19) and tell your developer which line failed.

---

## Security notes
- **Exposed publicly:** the old webhook verify token (in a file called `PROJECT_ACCESS.md` in the public GitHub repositories) and an older one in code history. A verify token cannot send or read messages; the new CRM uses a fresh one (value 4), so the old one stops mattering after the switch.
- **Not exposed (checked across all GitHub history):** the WhatsApp access token, the Meta app secret, AI keys, database passwords.
- **After the switch has worked for 2 weeks:** delete the old CRM’s access token (Meta → System users → old token → Revoke) and the old Claude/OpenAI keys if nothing else uses them; make the old GitHub repository private (GitHub → `flavorofeast-hash/bookmyspaces-crm-v3` → Settings → Change visibility → Private). Keep them until then so Undo works.
- The app secret is shared by both CRMs (one Meta app). Only change it if you suspect a leak, and then update it in **both** Vercel projects at the same time.
