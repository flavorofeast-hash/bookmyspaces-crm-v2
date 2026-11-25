// End-to-end Facebook/Instagram/Lead Ads check against a running local CRM (mock Meta on :4010).
import crypto from 'node:crypto'
import pg from 'pg'
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE ?? 'http://localhost:3000', SECRET = process.env.WHATSAPP_APP_SECRET, VERIFY = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect()
const one = async (sql, a = []) => (await db.query(sql, a)).rows[0]
let fails = 0
const check = (ok, name, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) fails++ }
const post = async (payload, sig = true) => {
  const raw = JSON.stringify(payload)
  const h = { 'content-type': 'application/json' }
  if (sig) h['x-hub-signature-256'] = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  return fetch(`${BASE}/api/meta/webhook`, { method: 'POST', headers: h, body: raw })
}
let r = await fetch(`${BASE}/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY)}&hub.challenge=777`)
check(r.status === 200 && (await r.text()) === '777', 'meta webhook verification')
r = await post({ object: 'page', entry: [] }, false)
check(r.status === 401, 'unsigned page event refused')
const mid = 'm_e2e_' + Date.now()
r = await post({ object: 'page', entry: [{ id: 'PAGE1', time: Date.now(), messaging: [{ sender: { id: 'PSIDE2E' }, recipient: { id: 'PAGE1' }, timestamp: Date.now(), message: { mid, text: 'Rooftop at MonuRama on 31 Dec for 30 guests?' } }] }] })
check(r.status === 200, 'messenger event accepted')
const fb = await one(`SELECT l.*, c.name cname FROM crm.leads l JOIN crm.customers c ON c.id = l.customer_id WHERE l.external_id = $1`, [mid])
check(fb && fb.source === 'facebook' && fb.cname === 'ZZ TEST Messenger' && fb.is_test && fb.category === 'rooftop' && fb.guests === 30, 'messenger lead created', JSON.stringify(fb && { s: fb.source, n: fb.cname, c: fb.category }))
r = await post({ object: 'page', entry: [{ id: 'PAGE1', time: Date.now(), changes: [{ field: 'leadgen', value: { leadgen_id: 'LEADE2E', form_id: 'FORME2E', page_id: 'PAGE1' } }] }] })
const la = await one(`SELECT * FROM crm.leads WHERE external_id = 'LEADE2E'`)
check(la && la.source === 'facebook_lead_ad' && la.form_name === 'Skyline rooms form' && la.phone === '919800000077' && la.is_test, 'lead ad fetched and saved', JSON.stringify(la && { f: la.form_name, p: la.phone }))

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 })
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
await page.type('input[name=email]', 'admin'); await page.type('input[type=password]', 'admin')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type=submit]')])
await page.goto(`${BASE}/leads?tests=1`, { waitUntil: 'networkidle0' })
let txt = await page.evaluate(() => document.body.innerText)
check(txt.includes('ZZ TEST Messenger') && txt.includes('Facebook Lead Ad'), 'leads list shows both (tests shown)')
await page.screenshot({ path: '/tmp/leads.png' })
await page.goto(`${BASE}/leads`, { waitUntil: 'networkidle0' })
txt = await page.evaluate(() => document.body.innerText)
check(!txt.includes('ZZ TEST Messenger'), 'tests hidden by default')
await page.goto(`${BASE}/leads/${fb.id}`, { waitUntil: 'networkidle0' })
await page.select('select[name=status]', 'follow_up'); await page.type('input[name=next_follow_up]', '01012027'); await page.type('textarea[name=note]', 'Call back after 6pm')
await Promise.all([page.waitForNavigation(), page.click('form button[type=submit]')])
const upd = await one(`SELECT status, notes, next_follow_up::text d FROM crm.leads WHERE id = $1`, [fb.id])
check(upd.status === 'follow_up' && /Call back/.test(upd.notes ?? ''), 'lead updated from page', JSON.stringify(upd))
await page.screenshot({ path: '/tmp/lead.png', fullPage: true })
await page.goto(`${BASE}/inbox/${fb.customer_id}`, { waitUntil: 'networkidle0' })
txt = await page.evaluate(() => document.body.innerText)
check(txt.includes('Reply on Messenger') && txt.includes('Messenger'), 'inbox thread shows Messenger reply box')
await page.type('textarea[name=body]', 'Thanks! Sharing details shortly.')
await Promise.all([page.waitForNavigation(), page.click('form button[type=submit]:not(.btn-secondary)')])
const out = await one(`SELECT status, channel FROM crm.messages WHERE customer_id = $1 AND direction = 'out' ORDER BY created_at DESC LIMIT 1`, [fb.customer_id])
check(out && out.channel === 'facebook' && out.status === 'sent', 'staff reply sent via Messenger', JSON.stringify(out))
await page.screenshot({ path: '/tmp/thread.png', fullPage: true })
await page.goto(`${BASE}/today`, { waitUntil: 'networkidle0' })
check((await page.evaluate(() => document.body.innerText)).includes('New leads'), 'Today shows leads card')
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' })
const btn = await page.$$eval('button', (bs) => bs.map((b) => b.textContent).filter((t) => t.includes('Connect Facebook Page')))
check(btn.length === 1, 'settings has Connect Facebook Page')
await browser.close(); await db.end()
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0)
