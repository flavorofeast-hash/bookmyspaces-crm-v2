// Acceptance test for a DEPLOYED preview that starts with an EMPTY test database.
// It builds everything through the screens (setup → owner → settings → workflow).
// Usage:
//   BASE=https://<preview-url> SETUP_CODE=<code> OWNER_EMAIL=<email> OWNER_PASSWORD=<pw> node tests/e2e/preview-acceptance.mjs
// Optional: VERCEL_BYPASS=<protection-bypass-token> if the preview is protected.
// Secrets are read from the environment and never printed.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const BASE = (process.env.BASE ?? '').replace(/\/$/, '')
const SETUP_CODE = process.env.SETUP_CODE ?? ''
const EMAIL = process.env.OWNER_EMAIL ?? 'owner@preview.test'
const PASSWORD = process.env.OWNER_PASSWORD ?? ''
const BYPASS = process.env.VERCEL_BYPASS ?? ''
const OUT = process.env.OUT ?? 'test-artifacts/preview'
if (!BASE || !PASSWORD) { console.error('Set BASE and OWNER_PASSWORD (and SETUP_CODE for a fresh database).'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })
const results = []
const ist = (days) => new Date(Date.now() + 5.5 * 3600e3 + days * 864e5).toISOString().slice(0, 10)
const RUN = Date.now().toString(36).slice(-5).toUpperCase() // unique per run so it can be repeated
const PHONE_A = '98' + String(Date.now()).slice(-8)
const PHONE_B = '97' + String(Date.now() + 7).slice(-8)

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 1366, height: 900 })
page.setDefaultTimeout(30000)
if (BYPASS) await page.setExtraHTTPHeaders({ 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' })

const shot = (n, full = true) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: full })
async function step(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true, detail: d ?? '' }); console.log('PASS', name, d ?? '') }
  catch (e) { results.push({ name, ok: false, detail: e.message.slice(0, 400) }); console.log('FAIL', name, e.message.slice(0, 300)); await shot('FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)).catch(() => {}) }
}
const go = (p) => page.goto(BASE + p, { waitUntil: 'networkidle0' })
const text = () => page.evaluate(() => document.body.innerText)
async function submit(sel) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), page.click(sel)])
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 400))
}
async function fill(name, value, scope = '') {
  await page.$eval(`${scope} [name="${name}"]`.trim(), (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
async function expectText(re, label) {
  let t = ''
  for (let i = 0; i < 20; i++) { t = await text(); if (re.test(t)) return; await new Promise((r) => setTimeout(r, 500)) }
  throw new Error(`expected ${label ?? re} on ${page.url().replace(BASE, '')}: ${t.slice(0, 300).replace(/\s+/g, ' ')}`)
}
async function tick(name, labelIncludes) {
  for (const b of await page.$$(`input[name=${name}]`)) {
    const l = await b.evaluate((el) => el.closest('label').innerText)
    if (l.includes(labelIncludes)) { const dis = await b.evaluate((el) => el.disabled); if (dis) throw new Error(`${labelIncludes} is not selectable (booked)`); await b.click(); return }
  }
  throw new Error('no space ' + labelIncludes)
}

let bookingA = '', bookingB = '', customerUrl = ''

await step('Preview opens and health endpoint answers', async () => {
  const h = await page.goto(BASE + '/api/health'); const j = JSON.parse(await h.text())
  if (j.database === 'missing-config') throw new Error('CRM_DATABASE_URL is not set for Preview')
  return `database: ${j.database}; whatsapp receive=${j.whatsapp.receive} send=${j.whatsapp.send}`
})

await step('Logged-out visitor is redirected to login/setup', async () => {
  await go('/today'); if (!/\/(login|setup)/.test(page.url())) throw new Error('not redirected: ' + page.url())
})

await step('First-time setup: create tables and owner (skipped if already done)', async () => {
  await go('/setup')
  if (page.url().includes('/login')) return 'already set up'
  if ((await text()).includes('Create database tables')) {
    await fill('code', SETUP_CODE); await submit('button[type=submit]'); await expectText(/Database tables created|Step 2 of 2/)
  }
  if ((await text()).includes('Create owner account')) {
    await fill('name', 'Preview Owner'); await fill('email', EMAIL); await fill('password', PASSWORD); await fill('code', SETUP_CODE)
    await submit('button[type=submit]'); await expectText(/Welcome|Business details/)
    return 'tables + owner created'
  }
  return 'tables existed'
})

await step('Log in (wrong password refused, correct accepted)', async () => {
  const ctx = await browser.createBrowserContext(); const p2 = await ctx.newPage()
  if (BYPASS) await p2.setExtraHTTPHeaders({ 'x-vercel-protection-bypass': BYPASS })
  await p2.goto(BASE + '/login', { waitUntil: 'networkidle0' }); await p2.type('[name=email]', EMAIL); await p2.type('[name=password]', 'definitely-wrong')
  await Promise.all([p2.waitForNavigation().catch(() => {}), p2.click('button[type=submit]')]); await new Promise((r) => setTimeout(r, 1500))
  if (!(await p2.evaluate(() => document.body.innerText)).includes('incorrect')) throw new Error('wrong password not refused')
  await ctx.close()
  await go('/login'); if (page.url().includes('/today')) return 'already signed in from setup'
  await fill('email', EMAIL); await fill('password', PASSWORD); await submit('button[type=submit]')
  await expectText(/Needs attention/); await shot('p01-today')
})

await step('Settings: business details, two properties, rooms (bulk), hall, rooftop, package', async () => {
  await go('/settings')
  if ((await text()).includes(`PRV${RUN} Skyline`)) return 'exists'
  await fill('business_name', 'BookMySpaces (PREVIEW TEST)', 'form:has([name=business_name])'); await fill('whatsapp_number', '919051459463', 'form:has([name=business_name])')
  await submit('form:has([name=business_name]) button[type=submit]'); await expectText(/Business details saved/)
  for (const p of [`PRV${RUN} Skyline`, `PRV${RUN} MonuRama`]) {
    await go('/settings'); const f = 'form:has(button::-p-text(Add property))'
    await fill('name', p, 'form:has([name=address]):not(:has([name=id]))'); await submit('form:not(:has([name=id])) button::-p-text(Add property)'); await expectText(/Property saved/)
  }
  const add = async (prop, name, kind, count, start, price, unit, cap) => {
    await go('/settings'); const f = 'form:has(input[name=count])'
    const val = await page.$$eval(`${f} select[name=property_id] option`, (os, p) => os.find((o) => o.textContent === p).value, prop)
    await page.select(`${f} select[name=property_id]`, val); await fill('name', name, f); await page.select(`${f} select[name=kind]`, kind)
    await fill('count', String(count), f); if (start) await fill('start_number', String(start), f); await fill('price', String(price), f)
    await page.select(`${f} select[name=price_unit]`, unit); await fill('capacity', String(cap), f)
    await submit(`${f} button[type=submit]`); await expectText(/Added \d+ space/)
  }
  await add(`PRV${RUN} Skyline`, 'Room', 'room', 4, 101, 2800, 'night', 2)
  await add(`PRV${RUN} Skyline`, 'Celebration Hall', 'hall', 1, null, 18000, 'slot', 120)
  await add(`PRV${RUN} Skyline`, 'Skyline Rooftop', 'rooftop', 1, null, 15000, 'slot', 80)
  await add(`PRV${RUN} MonuRama`, 'Family Room', 'room', 2, 1, 3200, 'night', 4)
  await go('/settings'); const pf = 'form:has([name=price_basis]):not(:has([name=id]))'
  await fill('name', `Gold ${RUN}`, pf); await fill('price', '750', pf); await submit(`${pf} button[type=submit]`); await expectText(/Package saved/)
  await go('/settings'); await expectText(/Room 104/); await shot('p02-settings')
})

await step('Add a customer (enquiry by phone)', async () => {
  await go('/customers/new')
  await fill('name', `Rahul Verma ${RUN}`); await fill('phone', PHONE_A); await page.select('select[name=source]', 'phone_call')
  await fill('requirements', 'Haldi, ~70 guests, evening, veg')
  await submit('button[type=submit]:not([name])'); customerUrl = new URL(page.url()).pathname
  await expectText(/Customer saved/); await shot('p03-customer')
})

await step('Duplicate mobile number is detected', async () => {
  await go('/customers/new'); await fill('name', 'Dup'); await fill('phone', '+91-' + PHONE_A); await submit('button[type=submit]:not([name])')
  await expectText(/already exists/); if (new URL(page.url()).pathname !== customerUrl) throw new Error('not redirected to existing customer')
})

const EVT = ist(30 + (parseInt(RUN, 36) % 200))
await step('Record an enquiry (hall, evening) and check availability', async () => {
  await go(customerUrl); await submit('a[href^="/bookings/new?customer="]')
  await fill('event_date', EVT); const v = await page.$$eval('select[name=slot] option', (o) => o.find((x) => x.textContent.startsWith('Evening')).value)
  await page.select('select[name=slot]', v); await submit('form[method=get] button.btn-primary')
  await expectText(/Halls & rooftop/); await shot('p04-availability')
  await tick('event_ids', 'Celebration Hall'); await fill('guests', '70'); await page.select('select[name=event_type]', 'Haldi')
  await submit('button[name=intent][value=enquiry]'); bookingA = new URL(page.url()).pathname
  await expectText(/Booking saved/); await expectText(/Enquiry/)
})

await step('Second enquiry for the same hall/time is allowed as tentative', async () => {
  await go(`/bookings/new?type=event&event_date=${EVT}&start_time=17:00&end_time=21:00`)
  await expectText(/Enquiry pending/); await tick('event_ids', 'Celebration Hall')
  await fill('new_name', `Sunita Paul ${RUN}`); await fill('new_phone', PHONE_B); await submit('button[name=intent][value=enquiry]')
  bookingB = new URL(page.url()).pathname; await expectText(/Booking saved/)
})

await step('Convert enquiry to confirmed booking', async () => { await go(bookingA); await submit('form button.btn-green'); await expectText(/Booking confirmed/) })

await step('Double booking refused by the database on the deployed site', async () => {
  await go(bookingB); await submit('form button.btn-green'); await expectText(/Double booking prevented/); await shot('p05-double-booking')
})

await step('Food line + quotation', async () => {
  await go(bookingA); await page.click('summary::-p-text(+ Add food / extra)'); const f = 'form:has(select[name=line_type])'
  await fill('description', 'Veg dinner buffet', f); await fill('qty', '70', f); await fill('unit_price', '600', f)
  await submit(`${f} button[type=submit]`); await expectText(/Item added/)
  await submit('form:has(input[name=type][value=quotation]) button'); await expectText(/QT-\d{4}-\d{4}/)
})

await step('Advance payment and receipt', async () => {
  await go(bookingA); await page.select('select[name=kind]', 'advance'); await fill('amount', '20000'); await page.select('select[name=method]', 'upi'); await fill('reference', `UPI-${RUN}`)
  await submit('form:has(input[name=amount]) button.btn-green'); await expectText(/receipt issued/); await expectText(/RCP-\d{4}-\d{4}/)
  await submit('a::-p-text(View / print)'); await expectText(/RECEIPT/i); await expectText(new RegExp(`UPI-${RUN}`)); await shot('p06-receipt')
})

await step('Outstanding balance on booking, Billing and Today', async () => {
  await go(bookingA); const bal = await page.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.innerText.startsWith('Balance due'))?.innerText.split('\n')[1])
  if (bal !== '₹40,000') throw new Error('balance ' + bal)
  await go('/billing'); await expectText(new RegExp(`Rahul Verma ${RUN}`)); await go('/today'); await expectText(/Outstanding balances/)
  return bal
})

await step('Final bill, then balance payment brings balance to zero', async () => {
  await go(bookingA); await submit('form:has(input[name=type][value=bill]) button'); await expectText(/Final bill issued/)
  await page.select('select[name=kind]', 'balance'); await fill('amount', '40000'); await page.select('select[name=method]', 'cash')
  await submit('form:has(input[name=amount]) button.btn-green'); await expectText(/receipt issued/)
  const bal = await page.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.innerText.startsWith('Balance due'))?.innerText.split('\n')[1])
  if (bal !== '₹0') throw new Error('balance ' + bal)
})

await step('Find customer by mobile with complete history', async () => {
  await go('/customers?q=' + PHONE_A); await submit(`a::-p-text(Rahul Verma ${RUN})`)
  for (const s of ['RCP-', 'QT-', 'BILL-', 'History', 'payment received']) await expectText(new RegExp(s))
  await shot('p07-customer-history')
})

await step('Cancel + refund on a second booking (frees the hall for the other customer)', async () => {
  // book the rooftop for Sunita, take advance, cancel, refund
  await go(`/bookings/new?type=event&event_date=${EVT}&start_time=18:00&end_time=23:00`)
  await tick('event_ids', 'Skyline Rooftop'); await page.select('select[name=customer_id]', await page.$$eval('select[name=customer_id] option', (o, n) => o.find((x) => x.textContent.includes(n)).value, `Sunita Paul ${RUN}`))
  await submit('button[name=intent][value=confirm]'); await expectText(/Confirmed/); const url = new URL(page.url()).pathname
  await fill('amount', '5000'); await submit('form:has(input[name=amount]) button.btn-green'); await expectText(/receipt issued/)
  await page.click('summary::-p-text(Cancel booking)'); await fill('reason', 'Preview test cancellation'); await submit('form:has(input[name=to][value=cancelled]) button.btn-danger'); await expectText(/Booking cancelled/)
  await page.click('summary::-p-text(Record a refund)'); const f = 'form:has(input[name=note])'
  const max = await page.$eval(`${f} input[name=amount]`, (el) => el.max)
  if (max !== '5000') throw new Error('refund box should be capped at the ₹5,000 paid, got max=' + max) // server cap is also enforced (integration tests)
  await fill('amount', '4000', f); await fill('note', 'Refund, ₹1,000 retained', f); await submit(`${f} button.btn-danger`); await expectText(/RFN-\d{4}-\d{4}/)
})

await step('Import 82 test leads (needs db/test-data/legacy_leads_82_TEST.sql run on the test DB)', async () => {
  await go('/settings#import'); const t = await text()
  if (t.includes('No old-CRM leads table')) throw new Error('public.leads not present in the test database — run legacy_leads_82_TEST.sql first')
  await submit('button::-p-text(Import old leads now)'); const t1 = await text()
  const m = t1.match(/Found (\d+) old leads: (\d+) new customers, (\d+) merged.*?, (\d+) already imported, (\d+) without/)
  if (!m || m[1] !== '82') throw new Error('unexpected: ' + (m ? m[0] : t1.slice(0, 200)))
  await go('/settings#import'); await submit('button::-p-text(Import old leads now)'); const t2 = await text()
  if (!/82 already imported/.test(t2) || !/: 0 new customers, 0 merged/.test(t2)) throw new Error('second import was not a no-op')
  return `first run: ${m[2]} new, ${m[3]} merged, ${m[5]} without phone; second run: 82 skipped, 0 new`
})

await step('WhatsApp webhook security on the deployed site', async () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
  const h = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}
  const a = await fetch(BASE + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body }).then((r) => r.status)
  const b = await fetch(BASE + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64), ...h }, body }).then((r) => r.status)
  if (![401, 503].includes(a) || ![401, 503].includes(b)) throw new Error(`unsigned ${a}, forged ${b}`)
  return `unsigned → ${a}, forged → ${b} (${a === 503 ? 'no WhatsApp secret set for Preview: all webhook calls refused' : 'signature required'})`
})

await step('Mobile layout on the deployed site', async () => {
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true })
  for (const p of ['/today', bookingA, customerUrl]) { await go(p); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 2) throw new Error(`${p} overflows ${o}px`) }
  await shot('p08-mobile-today', false); await page.setViewport({ width: 1366, height: 900 })
})

await browser.close()
fs.writeFileSync(`${OUT}/preview-results.json`, JSON.stringify({ base: BASE, run: RUN, at: new Date().toISOString(), results }, null, 2))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed against ${BASE}`)
process.exit(failed.length ? 1 : 0)
