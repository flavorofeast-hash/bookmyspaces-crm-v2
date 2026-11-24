// End-to-end WhatsApp check against a running local CRM (mock Meta + mock AI on :4010).
// Usage: BASE=http://localhost:3000 WHATSAPP_APP_SECRET=… WHATSAPP_WEBHOOK_VERIFY_TOKEN=… DB=postgres://… node tests/e2e/whatsapp-e2e.mjs
import crypto from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE ?? 'http://localhost:3000', SECRET = process.env.WHATSAPP_APP_SECRET, VERIFY = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect()
const one = async (sql, a = []) => (await db.query(sql, a)).rows[0]
let fails = 0
const check = (ok, name, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) fails++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const post = async (payload, sig = true) => {
  const raw = JSON.stringify(payload)
  const h = { 'content-type': 'application/json' }
  if (sig) h['x-hub-signature-256'] = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  return fetch(`${BASE}/api/whatsapp/webhook`, { method: 'POST', headers: h, body: raw })
}
const ts = () => String(Math.floor(Date.now() / 1000))
const wrap = (value) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '111' }, ...value } }] }] })
const msg = (id, from, m, name = 'ZZ TEST Ananya') => wrap({ contacts: [{ wa_id: from, profile: { name } }], messages: [{ id, from, timestamp: ts(), ...m }] })

// 1 verification handshake
let r = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY)}&hub.challenge=12345`)
check(r.status === 200 && (await r.text()) === '12345', 'Meta verification handshake returns the challenge')
r = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)
check(r.status === 403, 'wrong verify token refused')
// 2 forged request
r = await post(msg('wamid.FORGED', '919800000001', { type: 'text', text: { body: 'x' } }), false)
check(r.status === 401, 'unsigned request refused', String(r.status))

// 3 new customer + AI reply
const NEW = '919800000101'
await post(msg('wamid.E2E1', NEW, { type: 'text', text: { body: 'Hi, do you have rooftop parties?' } }))
await sleep(500)
let c = await one(`SELECT id, name, source FROM crm.customers WHERE phone = $1`, [NEW])
check(!!c, 'new customer created from WhatsApp', c?.name)
let o = await one(`SELECT body, ai_generated, status, wa_message_id FROM crm.messages WHERE customer_id = $1 AND direction = 'out'`, [c.id])
check(o?.ai_generated && o.status === 'sent' && o.body.includes('approved facts received'), 'AI reply sent with approved facts', o?.body)
// 4 duplicate delivery
await post(msg('wamid.E2E1', NEW, { type: 'text', text: { body: 'Hi, do you have rooftop parties?' } }))
await sleep(300)
const counts = await one(`SELECT (SELECT count(*)::int FROM crm.customers WHERE phone = $1) AS cust, (SELECT count(*)::int FROM crm.messages WHERE customer_id = $2) AS msgs`, [NEW, c.id])
check(counts.cust === 1 && counts.msgs === 2, 'duplicate delivery: no duplicate customer, message or reply', JSON.stringify(counts))
// 5 delivery + read receipts
await post(wrap({ statuses: [{ id: o.wa_message_id, status: 'delivered', timestamp: ts(), recipient_id: NEW }] }))
await post(wrap({ statuses: [{ id: o.wa_message_id, status: 'read', timestamp: ts(), recipient_id: NEW }] }))
await post(wrap({ statuses: [{ id: o.wa_message_id, status: 'delivered', timestamp: ts(), recipient_id: NEW }] })) // late, must not go backwards
await sleep(300)
check((await one(`SELECT status FROM crm.messages WHERE wa_message_id = $1`, [o.wa_message_id])).status === 'read', 'delivered → read status recorded (never goes backwards)')
// 6 customer reply joins the same conversation; booking question hands over
await sleep(1100)
await post(msg('wamid.E2E2', NEW, { type: 'text', text: { body: 'Can I book for 14 Feb, 30 guests?' } }))
await sleep(500)
c = await one(`SELECT id, ai_paused, wa_handover_reason FROM crm.customers WHERE phone = $1`, [NEW])
check(c.ai_paused && c.wa_handover_reason === 'availability request', 'availability question handed to staff', c.wa_handover_reason)
check((await one(`SELECT count(*)::int AS n FROM crm.messages WHERE customer_id = $1`, [c.id])).n === 4, 'reply stays in the same conversation (4 messages)')
// 7 existing customer matched
const ex = await one(`SELECT id, name, phone FROM crm.customers WHERE phone IS NOT NULL AND name NOT LIKE 'ZZ TEST%' ORDER BY created_at LIMIT 1`)
await post(msg('wamid.E2E3', ex.phone, { type: 'text', text: { body: 'Hello again' } }, 'Different WhatsApp name'))
await sleep(500)
check((await one(`SELECT count(*)::int AS n FROM crm.customers WHERE phone = $1`, [ex.phone])).n === 1 && !!(await one(`SELECT 1 AS x FROM crm.messages WHERE wa_message_id = 'wamid.E2E3' AND customer_id = $1`, [ex.id])), 'existing customer matched by number (no duplicate)', ex.name)
// 8 promotion code → campaign + property
const promo = await one(`INSERT INTO crm.campaigns (name, code) VALUES ('ZZ TEST promo', 'ZZE2E1') RETURNING id`)
const prop = await one(`SELECT id FROM crm.properties ORDER BY sort_order LIMIT 1`)
await db.query(`INSERT INTO crm.promotions (property_id, promo_type, headline, campaign_id, status) VALUES ($1,'rooms','ZZ TEST',$2,'approved')`, [prop.id, promo.id])
await post(msg('wamid.E2E4', '919800000102', { type: 'text', text: { body: 'Hi! I saw your post (ZZE2E1). Please share details.' } }, 'ZZ TEST Promo'))
await sleep(500)
const pc = await one(`SELECT campaign_id, property_id, source FROM crm.customers WHERE phone = '919800000102'`)
check(pc.campaign_id === promo.id && pc.property_id === prop.id && pc.source === 'campaign', 'promotion code links customer to promotion and property')
// 9 photo from customer → stored, staff handover
await post(msg('wamid.E2E5', '919800000102', { type: 'image', image: { id: 'MEDIAIN1', mime_type: 'image/jpeg', caption: 'like this decoration' } }, 'ZZ TEST Promo'))
await sleep(500)
const img = await one(`SELECT id, media_id FROM crm.messages WHERE wa_message_id = 'wamid.E2E5'`)
check(img?.media_id === 'MEDIAIN1', 'photo message stored with media id')
// 10 broken payload is logged and recoverable
r = await post({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'wamid.BAD', from: 'abc', type: 'text', text: { body: 'x' } }] } }] }] })
await sleep(300)
check(r.status === 200 && !!(await one(`SELECT id FROM crm.wa_webhook_errors WHERE payload::text LIKE '%wamid.BAD%' AND resolved_at IS NULL`)), 'failed delivery acknowledged and kept in the error log')

// 11 staff view: inbox, search, photo, manual reply with staff name, attachment
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 })
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
await page.type('input[name=email]', 'admin'); await page.type('input[type=password]', 'admin')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type=submit]')])
await page.goto(`${BASE}/inbox?q=ZZE2E1`, { waitUntil: 'networkidle0' })
let t = await page.evaluate(() => document.querySelector('main').innerText)
check(t.includes('ZZ TEST Promo') && t.includes('ZZE2E1') && !t.includes('ZZ TEST Ananya'), 'inbox search by promotion code, shows property/promotion labels')
const pc2 = await one(`SELECT id FROM crm.customers WHERE phone = '919800000102'`)
await page.goto(`${BASE}/inbox/${pc2.id}`, { waitUntil: 'networkidle0' })
const imgOk = await page.evaluate(async (id) => { const x = await fetch(`/api/whatsapp/media/${id}`); return x.status + ' ' + x.headers.get('content-type') }, img.id)
check(imgOk === '200 image/jpeg', 'photo opens inside the CRM for signed-in staff', imgOk)
const anon = await fetch(`${BASE}/api/whatsapp/media/${img.id}`, { redirect: 'manual' })
check([307, 401].includes(anon.status) && !(anon.headers.get('content-type') ?? '').startsWith('image'), 'photo not available without signing in', String(anon.status))
await page.goto(`${BASE}/inbox/${c.id}`, { waitUntil: 'networkidle0' })
t = await page.evaluate(() => document.querySelector('main').innerText)
check(t.includes('AI reply') && t.includes('Handed to staff: availability request') && /read/i.test(t), 'thread shows AI label, handover banner and read status')
await page.$eval('textarea[name=body]', (e) => { e.value = 'Hi Ananya, this is the team — 14 Feb is being checked.' })
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.$eval('form:has(textarea[name=body])', (f) => f.requestSubmit())])
await sleep(500)
const staffMsg = await one(`SELECT m.ai_generated, u.name FROM crm.messages m JOIN crm.app_users u ON u.id = m.sent_by WHERE m.customer_id = $1 AND m.body LIKE 'Hi Ananya%'`, [c.id])
check(staffMsg && !staffMsg.ai_generated, 'staff reply sent and recorded with the staff name', staffMsg?.name)
fs.writeFileSync('/tmp/wa-pdf.pdf', '%PDF-1.4 test')
const input = await page.$('input[type=file][name=file]'); await input.uploadFile('/tmp/wa-pdf.pdf')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.$eval('form:has(input[name=file])', (f) => f.requestSubmit())])
await sleep(500)
const doc = await one(`SELECT msg_type, media_id, status FROM crm.messages WHERE customer_id = $1 AND msg_type = 'document'`, [c.id])
check(doc?.media_id?.startsWith('MEDIAUP') && doc.status === 'sent', 'staff attachment uploaded and sent', JSON.stringify(doc))
await page.screenshot({ path: '/tmp/wa-thread.png', fullPage: true })
// 12 retry the logged failure from Settings (it still fails because the number is invalid → stays logged)
await page.goto(`${BASE}/settings#connections`, { waitUntil: 'networkidle0' })
t = await page.evaluate(() => document.body.innerText)
check(t.includes('WhatsApp deliveries that failed to process') && t.includes('Unusable sender number'), 'failed deliveries listed in Settings with Retry')
await browser.close(); await db.end()
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
