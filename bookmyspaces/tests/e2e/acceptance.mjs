// End-to-end acceptance test in a real Chrome browser against a running CRM.
// Usage: BASE=http://localhost:3000 node tests/e2e/acceptance.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import crypto from 'node:crypto'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const OUT = process.env.OUT ?? 'test-artifacts'
const SECRET = process.env.WHATSAPP_APP_SECRET ?? 'e2e-app-secret'
fs.mkdirSync(OUT, { recursive: true })
const results = []
const ist = (days) => new Date(Date.now() + 5.5 * 3600e3 + days * 864e5).toISOString().slice(0, 10)

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 1366, height: 900 })
page.setDefaultTimeout(20000)

async function step(name, fn) {
  try { const detail = await fn(); results.push({ name, ok: true, detail: detail ?? '' }); console.log('PASS', name, detail ?? '') }
  catch (e) { results.push({ name, ok: false, detail: e.message }); console.log('FAIL', name, e.message); await shot(`FAIL-${name.replace(/\W+/g, '_').slice(0, 40)}`) }
}
const shot = (n, full = true) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: full })
const go = (p) => page.goto(BASE + p, { waitUntil: 'networkidle0' })
const text = () => page.evaluate(() => document.body.innerText)
async function submit(selector) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click(selector)])
}
async function fill(name, value, scope = '') {
  const sel = `${scope} [name="${name}"]`.trim()
  await page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }, value)
}
const expectText = async (re, label) => { const t = await text(); if (!re.test(t)) throw new Error(`expected ${label ?? re} on ${page.url()}\n---\n${t.slice(0, 600)}`) }
function sign(raw) { return 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex') }
async function webhook(payload, sig = true) {
  const raw = JSON.stringify(payload)
  const r = await fetch(BASE + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': typeof sig === 'string' ? sig : sign(raw) } : {}) }, body: raw })
  return r.status
}
const waMsg = (id, from, body, name) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: name ? [{ wa_id: from, profile: { name } }] : [], messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }] } }] }] })

const EVT = ist(20)
let bookingA = '', bookingB = '', customerUrl = ''

await step('Logged-out visitor is sent to login (all six modules)', async () => {
  for (const p of ['/today', '/customers', '/bookings', '/billing', '/inbox', '/marketing', '/settings']) {
    await go(p); if (!page.url().includes('/login')) throw new Error(`${p} did not redirect, got ${page.url()}`)
  }
  const r = await fetch(BASE + '/customers', { redirect: 'manual' }); if (r.status !== 307) throw new Error('status ' + r.status)
})

await step('1. Log in (wrong password refused, right password accepted)', async () => {
  await go('/login'); await fill('email', 'owner@demo.test'); await fill('password', 'wrong-pass'); await submit('button[type=submit]')
  await expectText(/incorrect/i, 'error on wrong password')
  await fill('email', 'owner@demo.test'); await fill('password', 'Demo@12345'); await submit('button[type=submit]')
  if (!page.url().includes('/today')) throw new Error('not on Today: ' + page.url())
  await expectText(/Needs attention/); await shot('01-today-desktop')
})

await step('Today shows check-ins, events, follow-ups, balances, activity', async () => {
  const t = await text()
  for (const s of ['Follow-ups due', 'New enquiries', 'Check-ins', 'Check-outs', 'Events', 'Available now', 'Upcoming room bookings', 'Upcoming events', 'Outstanding balances', 'Recent activity', 'Ananya Chatterjee', 'Arjun Mehta']) if (!t.includes(s)) throw new Error('missing ' + s)
})

await step('2. Add a customer', async () => {
  await go('/customers/new')
  await fill('name', 'Rahul Verma'); await fill('phone', '98765 43210'); await fill('email', 'rahul@example.test')
  await page.select('select[name=source]', 'phone_call'); await fill('requirements', 'Haldi ceremony, ~70 guests, evening, veg food')
  await submit('button[type=submit]:not([name])')
  customerUrl = new URL(page.url()).pathname
  await expectText(/Customer saved/); await expectText(/\+91 98765 43210/); await shot('02-customer-created')
  return customerUrl
})

await step('Duplicate detection (same mobile typed differently)', async () => {
  await go('/customers/new'); await fill('name', 'Rahul V'); await fill('phone', '+91-9876543210'); await submit('button[type=submit]:not([name])')
  await expectText(/already exists/); if (new URL(page.url()).pathname !== customerUrl) throw new Error('not redirected to existing record')
})

await step('3. Record an enquiry from the customer (hall, evening slot)', async () => {
  await go(customerUrl); await submit('a[href^="/bookings/new?customer="]')
  await fill('event_date', EVT); const slotVal = await page.$$eval('select[name=slot] option', (o) => o.find((x) => x.textContent.startsWith('Evening')).value)
  await page.select('select[name=slot]', slotVal); await submit('form[method=get] button.btn-primary')
  await expectText(/Halls & rooftop/); await shot('03-availability')
  await page.click('input[name=event_ids][value]:not([disabled])') // first free event space
  const label = await page.$eval('input[name=event_ids]:checked', (el) => el.closest('label').innerText.split('\n')[0])
  if (!/Celebration Hall/.test(label)) { // make sure we picked the hall
    await page.click('input[name=event_ids]:checked'); const hall = await page.$$('input[name=event_ids]')
    for (const h of hall) { const l = await h.evaluate((el) => el.closest('label').innerText); if (l.includes('Celebration Hall')) { await h.click(); break } }
  }
  await fill('guests', '70'); await page.select('select[name=event_type]', 'Haldi')
  await submit('button[name=intent][value=enquiry]')
  bookingA = new URL(page.url()).pathname
  await expectText(/Booking saved/); await expectText(/Enquiry/); await expectText(/Celebration Hall/)
  return bookingA
})

await step('Second customer enquires for the same hall and time (tentative allowed)', async () => {
  await go(`/bookings/new?type=event&event_date=${EVT}&start_time=17:00&end_time=21:00`)
  await expectText(/Enquiry pending/, 'tentative badge for the hall')
  const boxes = await page.$$('input[name=event_ids]')
  for (const b of boxes) { const l = await b.evaluate((el) => el.closest('label').innerText); if (l.includes('Celebration Hall')) { await b.click(); break } }
  await fill('new_name', 'Sunita Paul'); await fill('new_phone', '9876500001')
  await submit('button[name=intent][value=enquiry]')
  bookingB = new URL(page.url()).pathname
  await expectText(/Booking saved/)
})

await step('4/5. Convert enquiry into a confirmed booking (availability checked)', async () => {
  await go(bookingA); await submit('form button.btn-green')
  await expectText(/Booking confirmed/); await expectText(/blocked/)
})

await step('6. Double booking is prevented (database refuses, UI explains who holds it)', async () => {
  await go(bookingB); await submit('form button.btn-green')
  await expectText(/Double booking prevented/); await expectText(/Celebration Hall is already booked by BK-/)
  await shot('06-double-booking-prevented')
  await go(`/bookings/new?type=event&event_date=${EVT}&start_time=18:00&end_time=20:00`)
  const disabled = await page.$$eval('input[name=event_ids]', (els) => els.filter((e) => e.closest('label').innerText.includes('Celebration Hall')).map((e) => e.disabled))
  if (!disabled[0]) throw new Error('hall checkbox should be disabled (Booked)')
})

await step('Add food line and issue a quotation', async () => {
  await go(bookingA)
  await page.click('summary::-p-text(+ Add food / extra)')
  const form = 'form:has(select[name=line_type])'
  await fill('description', 'Veg dinner buffet', form); await fill('qty', '70', form); await fill('unit_price', '600', form)
  await submit(`${form} button[type=submit]`)
  await expectText(/Item added/)
  await submit('form:has(input[name=type][value=quotation]) button')
  await expectText(/Quotation issued/); await expectText(/QT-\d{4}-\d{4}/)
})

await step('7/8. Record an advance and generate the receipt', async () => {
  await go(bookingA)
  const total = await page.$eval('input[name=amount]', (el) => el.max)
  await page.select('select[name=kind]', 'advance'); await fill('amount', '20000'); await page.select('select[name=method]', 'upi'); await fill('reference', 'UPI-E2E-001')
  await submit('form:has(input[name=amount]) button.btn-green')
  await expectText(/Payment recorded and receipt issued/); await expectText(/RCP-\d{4}-\d{4}/)
  await shot('07-advance-recorded')
  await submit('a::-p-text(View / print)')
  await expectText(/RECEIPT/i); await expectText(/UPI-E2E-001/); await expectText(/Balance due/)
  await shot('08-receipt')
  return `total ${total}`
})

await step('9. Outstanding balance shown (booking, Billing, Today) and consistent', async () => {
  await go(bookingA)
  const bal = await page.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.innerText.startsWith('Balance due'))?.innerText.split('\n')[1])
  if (!bal || bal === '₹0') throw new Error('no balance: ' + bal)
  await go('/billing'); const t = await text(); if (!t.includes('Rahul Verma') || !t.includes(bal)) throw new Error(`billing missing ${bal}`)
  await go('/today'); await expectText(/Outstanding balances/)
  return `balance ${bal}`
})

await step('Final bill issued with payments received and balance', async () => {
  await go(bookingA); await submit('form:has(input[name=type][value=bill]) button')
  await expectText(/Final bill issued/)
  const href = await page.$$eval('a', (as) => as.find((a) => /^Bill BILL-/.test(a.textContent.trim()))?.getAttribute('href'))
  await go(href); await expectText(/Payments received/i); await expectText(/GST not applicable/); await shot('09-final-bill')
})

await step('10. Find the customer by mobile and see complete history', async () => {
  await go('/customers?q=98765%2043210'); await submit('a::-p-text(Rahul Verma)')
  const t = await text()
  for (const s of ['Bookings & enquiries', 'Payments & receipts', 'RCP-', 'QT-', 'BILL-', 'History', 'payment received', 'Haldi ceremony']) if (!t.includes(s)) throw new Error('missing ' + s)
  await shot('10-customer-history')
})

await step('Calendar shows the confirmed hall booking', async () => {
  await go(`/bookings?from=${EVT}`); await expectText(/Rahul Verma/); await shot('11-calendar')
})

await step('Room booking with multiple rooms + rooftop booking through the UI', async () => {
  const ci = ist(25), co = ist(27)
  await go(`/bookings/new?type=room_stay&checkin=${ci}&checkout=${co}`)
  const rooms = await page.$$('input[name=room_ids]:not([disabled])'); await rooms[0].click(); await rooms[1].click()
  await page.select('select[name=customer_id]', await page.$eval('select[name=customer_id] option:nth-child(2)', (o) => o.value))
  await submit('button[name=intent][value=confirm]'); await expectText(/Booking confirmed|Booking saved/); await expectText(/2 nights/)
  await go(`/bookings/new?type=event&event_date=${ist(26)}&start_time=18:00&end_time=23:00`)
  const roof = await page.$$('input[name=event_ids]'); for (const r of roof) { const l = await r.evaluate((el) => el.closest('label').innerText); if (l.includes('Skyline Rooftop')) { await r.click(); break } }
  await fill('new_name', 'Kavya Nair'); await fill('new_phone', '9876500002'); await submit('button[name=intent][value=confirm]')
  await expectText(/Skyline Rooftop/); await expectText(/Confirmed/)
})

await step('Cancel booking and record refund (refund note issued)', async () => {
  await go(bookingA)
  await page.click('summary::-p-text(Cancel booking)'); await fill('reason', 'Customer postponed (E2E)')
  await submit('form:has(input[name=to][value=cancelled]) button.btn-danger')
  await expectText(/Booking cancelled/)
  await page.click('summary::-p-text(Record a refund)')
  const f = 'form:has(input[name=note])'
  await fill('amount', '15000', f); await fill('note', 'Refund after cancellation, ₹5,000 retained', f)
  await submit(`${f} button.btn-danger`)
  await expectText(/Refund recorded/); await expectText(/RFN-\d{4}-\d{4}/)
  await go(bookingB); await submit('form button.btn-green'); await expectText(/Booking confirmed/) // hall free again → second customer can confirm
})

await step('WhatsApp: webhook security (unsigned and forged rejected)', async () => {
  const p = waMsg('wamid.E2E0', '919811100001', 'hello')
  const a = await webhook(p, false), b = await webhook(p, 'sha256=' + '0'.repeat(64))
  const v1 = await fetch(BASE + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=42').then((r) => r.text())
  const v2 = await fetch(BASE + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42').then((r) => r.status)
  if (a !== 401 || b !== 401 || v1 !== '42' || v2 !== 403) throw new Error(`unsigned ${a}, forged ${b}, verify ${v1}/${v2}`)
  return 'unsigned 401, forged 401, verify OK, wrong token 403'
})

await step('WhatsApp: incoming message creates customer, appears in Inbox, auto-reply sent', async () => {
  const s = await webhook(waMsg('wamid.E2E1', '919811100001', 'Hi! I saw your offer (WINTER26). Rooftop for 25 people on Saturday?', 'Neha Singh'))
  if (s !== 200) throw new Error('webhook ' + s)
  await go('/inbox'); await expectText(/Neha Singh/); await shot('12-inbox')
  await submit('a[href^="/inbox/"]')
  await expectText(/Rooftop for 25 people/); await expectText(/auto-reply/)
  const log = fs.readFileSync('/tmp/mock-graph.log', 'utf8'); if (!log.includes('919811100001')) throw new Error('auto-reply not sent to Meta')
})

await step('WhatsApp: staff reply sent and shown with status', async () => {
  await page.click('button::-p-text(Availability confirmed)')
  await submit('button::-p-text(Send on WhatsApp)')
  await expectText(/Message sent/); await expectText(/Good news — the space is available/); await expectText(/sent/)
  await shot('13-inbox-reply')
})

await step('WhatsApp: delivery status update from Meta shown', async () => {
  const log = fs.readFileSync('/tmp/mock-graph.log', 'utf8').trim().split('\n')
  const status = await webhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.MOCK' + log.filter((l) => l.includes('/messages')).length, status: 'read' }] } }] }] })
  await page.reload({ waitUntil: 'networkidle0' }); await expectText(/read/)
  return 'status ' + status
})

await step('WhatsApp: failed send shows the real Meta error', async () => {
  await webhook(waMsg('wamid.E2E2', '919999900000', 'Need a room', 'Test Fail'))
  await go('/inbox'); await submit('a::-p-text(Test Fail)')
  await page.click('button::-p-text(Thank you)'); await submit('button::-p-text(Send on WhatsApp)')
  await expectText(/did not accept the message/); await expectText(/not in allowed list/)
  await shot('14-inbox-failed')
})

await step('Convert WhatsApp enquiry into a booking (customer prefilled)', async () => {
  await go('/inbox'); await submit('a::-p-text(Neha Singh)'); await submit('a::-p-text(Convert to booking)')
  await expectText(/New booking for Neha Singh/)
})

await step('Campaign tracking: WINTER26 enquiry counted', async () => {
  await go('/marketing')
  const block = await page.$$eval('li', (lis) => lis.map((l) => l.innerText).find((t) => t.includes('WINTER26') && t.includes('enquiries')) ?? '')
  const m = block.match(/(\d+)\s*\nenquiries/)
  if (!m || Number(m[1]) < 2) throw new Error('expected at least 2 WINTER26 enquiries (sample Tanvi + WhatsApp Neha), got: ' + block.replace(/\n/g, ' '))
  await shot('15-marketing')
  return `WINTER26 enquiries: ${m[1]}`
})

await step('Marketing: create post with image, preview, publish to Facebook & Instagram (confirmed post IDs)', async () => {
  await go('/marketing/posts/new')
  await fill('title', 'E2E rooftop post'); await page.$eval('textarea[name=caption]', (el) => { const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(el, 'Sunset parties at Skyline Rooftop! Code WINTER26'); el.dispatchEvent(new Event('input', { bubbles: true })) })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  fs.writeFileSync('/tmp/e2e.png', png)
  const input = await page.$('input[name=image]'); await input.uploadFile('/tmp/e2e.png')
  await submit('form button[type=submit]')
  await expectText(/Post saved/); await expectText(/Connected to Page/)
  await submit('button::-p-text(Publish to Facebook now)'); await expectText(/Published on Facebook — confirmed by Meta/); await expectText(/Post ID: PAGE1_/)
  await submit('button::-p-text(Publish to Instagram now)'); await expectText(/Published on Instagram/); await expectText(/IGMEDIA/)
  await shot('16-post-published')
})

await step('Google Business: manual workflow (copy, open, mark as posted)', async () => {
  await page.select('select[name=platform]', 'google').catch(() => {})
  await submit('button::-p-text(Mark as posted)'); await expectText(/Marked as posted/)
})

await step('Settings: add rooms in bulk (no code needed)', async () => {
  await go('/settings')
  const f = 'form:has(input[name=count])'
  await fill('name', 'Room', f); await fill('count', '3', f); await fill('start_number', '301', f); await fill('price', '3000', f); await fill('capacity', '2', f)
  await submit(`${f} button[type=submit]`)
  await expectText(/Added 3 space/); await expectText(/Room 303/)
  await shot('17-settings')
})

await step('Old-CRM lead import is repeat-safe', async () => {
  await go('/settings#import'); await submit('button::-p-text(Import old leads now)')
  await expectText(/already imported/); await expectText(/0 new customers/)
})

await step('Permissions: staff cannot open Settings or void payments', async () => {
  const ctx = await browser.createBrowserContext(); const p2 = await ctx.newPage()
  await p2.goto(BASE + '/login'); await p2.type('[name=email]', 'staff@demo.test'); await p2.type('[name=password]', 'Demo@12345')
  await Promise.all([p2.waitForNavigation(), p2.click('button[type=submit]')])
  await p2.goto(BASE + '/settings', { waitUntil: 'networkidle0' })
  const t = await p2.evaluate(() => document.body.innerText)
  if (!p2.url().includes('/today') || !t.includes('Only the owner')) throw new Error('staff reached settings: ' + p2.url())
  await p2.goto(BASE + bookingB, { waitUntil: 'networkidle0' })
  const voidBtns = await p2.$$('summary::-p-text(Void)'); if (voidBtns.length) throw new Error('staff sees void')
  await ctx.close()
})

await step('Mobile layout (375×812): Today, booking, customer, inbox', async () => {
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true })
  for (const [p, n] of [['/today', '18-mobile-today'], [bookingB, '19-mobile-booking'], [customerUrl, '20-mobile-customer'], ['/inbox', '21-mobile-inbox']]) {
    await go(p)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflow > 2) throw new Error(`${p} scrolls sideways by ${overflow}px`)
    await shot(n, false)
  }
  const nav = await page.$$eval('nav.fixed a', (as) => as.map((a) => a.innerText.replace(/\d+/g, '').trim()))
  if (nav.join(',') !== 'Today,Customers,Bookings,Billing,Inbox,Marketing') throw new Error('bottom nav: ' + nav)
  await page.setViewport({ width: 1366, height: 900 })
})

await step('Data persists after restart-equivalent (fresh session reads same records)', async () => {
  const ctx = await browser.createBrowserContext(); const p2 = await ctx.newPage()
  await p2.goto(BASE + '/login'); await p2.type('[name=email]', 'owner@demo.test'); await p2.type('[name=password]', 'Demo@12345')
  await Promise.all([p2.waitForNavigation(), p2.click('button[type=submit]')])
  await p2.goto(BASE + customerUrl, { waitUntil: 'networkidle0' })
  const t = await p2.evaluate(() => document.body.innerText); if (!t.includes('RFN-')) throw new Error('refund not visible in new session')
  await ctx.close()
})

await step('Public customer document link works without login', async () => {
  const ctx = await browser.createBrowserContext(); const p2 = await ctx.newPage()
  await go(bookingA)
  const wa = await page.$$eval('a', (as) => as.find((a) => a.textContent.trim() === 'WhatsApp' && a.href.includes('wa.me'))?.href)
  const link = decodeURIComponent(wa).match(/http:\/\/localhost:3000\/d\/[A-Za-z0-9_-]+/)[0]
  await p2.goto(link, { waitUntil: 'networkidle0' }); const t = await p2.evaluate(() => document.body.innerText)
  if (!/BookMySpaces/.test(t) || p2.url().includes('/login')) throw new Error('public doc failed')
  await ctx.close()
})

await browser.close()
fs.writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
