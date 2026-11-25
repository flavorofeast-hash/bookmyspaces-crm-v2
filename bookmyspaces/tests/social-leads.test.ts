import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { resetDb, closePool, seedSpaces, newCustomer } from './helpers'
import { q, q1 } from '@/lib/db'
import { processWebhook, simulateInbound } from '@/lib/whatsapp'
import { sendSocialText, simulateSocial, replyChannel } from '@/lib/social'
import { extractDetails, listLeads, updateLead } from '@/lib/leads'
import { createBooking } from '@/lib/bookings'

let sp: Awaited<ReturnType<typeof seedSpaces>>
let owner: string
beforeAll(async () => {
  await resetDb()
  sp = await seedSpaces()
  owner = (await q1<{ id: string }>(`INSERT INTO crm.app_users (email, name, role, password_hash) VALUES ('o@x', 'Owner', 'owner', 'x') RETURNING id`))!.id
  process.env.WHATSAPP_APP_SECRET = 's'; process.env.WHATSAPP_ACCESS_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1'
  process.env.META_PAGE_ID = 'PAGE1'; process.env.META_PAGE_ACCESS_TOKEN = 'page-token'
  process.env.META_GRAPH_BASE = 'https://graph.test/v25.0'
  await q(`UPDATE crm.business_settings SET auto_reply_enabled = false`)
})
afterAll(closePool)
afterEach(() => vi.unstubAllGlobals())

let calls: { url: string; init: any }[] = []
function mockGraph(fn: (url: string, init: any) => any) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, init })
    const r = fn(url, init)
    return new Response(JSON.stringify(r.json ?? r), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  }))
}
const now = () => Date.now()
const page = (messaging: any[], object = 'page') => ({ object, entry: [{ id: 'PAGE1', time: now(), messaging }] })

describe('extractDetails', () => {
  it('reads only what was written', () => {
    expect(extractDetails('Is the rooftop free on 12 Dec for 40 guests? budget 20k')).toEqual({ category: 'rooftop', guests: 40, requestedDates: '12 Dec', budget: '20k' })
    expect(extractDetails('Need 2 rooms 05/01 to 07/01')).toMatchObject({ category: 'room', requestedDates: '05/01, 07/01', guests: null, budget: null })
    expect(extractDetails('Hi')).toMatchObject({ category: 'general', guests: null, requestedDates: null, budget: null })
    expect(extractDetails('')).toEqual({ category: null, guests: null, requestedDates: null, budget: null })
  })
})

describe('WhatsApp enquiries become leads', () => {
  it('one lead per conversation, duplicates ignored, tests flagged', async () => {
    const msg = (id: string, text: string) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: '919800000001', profile: { name: 'Rina' } }], messages: [{ id, from: '919800000001', timestamp: String(Math.floor(now() / 1000)), type: 'text', text: { body: text } }] } }] }] })
    expect((await processWebhook(msg('wamid.L1', 'Skyline room for 3 people on 20 Dec?'))).errors).toEqual([])
    await processWebhook(msg('wamid.L1', 'Skyline room for 3 people on 20 Dec?')) // Meta retry
    await processWebhook(msg('wamid.L2', 'Also breakfast?'))
    const leads = await q<any>(`SELECT * FROM crm.leads WHERE source = 'whatsapp' AND phone = '919800000001'`)
    expect(leads).toHaveLength(1)
    expect(leads[0]).toMatchObject({ name: 'Rina', category: 'room', guests: 3, requested_dates: '20 Dec', property_id: sp.p1, status: 'new', is_test: false, external_id: 'wamid.L1' })
    await simulateInbound('9800000002', 'ZZ TEST Lead', 'hello', owner)
    expect((await q1<any>(`SELECT is_test FROM crm.leads WHERE name = 'ZZ TEST Lead'`))!.is_test).toBe(true)
    const visible = await listLeads({ view: 'all' }, '2026-11-25')
    expect(visible.some((l) => l.is_test)).toBe(false)
  })
})

describe('Facebook Messenger and Instagram DMs', () => {
  it('creates customer, message and lead; ignores retries; records page echoes without a lead', async () => {
    mockGraph((url) => url.includes('PSID1') ? { first_name: 'Arjun', last_name: 'Das' } : { error: { message: 'no' }, status: 400 })
    const ev = { sender: { id: 'PSID1' }, recipient: { id: 'PAGE1' }, timestamp: now(), message: { mid: 'm_1', text: 'Hall for wedding, 150 guests, MonuRama?' } }
    const r = await processWebhook(page([ev]))
    expect(r.errors).toEqual([])
    await processWebhook(page([ev]))
    const c = await q1<any>(`SELECT * FROM crm.customers WHERE fb_psid = 'PSID1'`)
    expect(c).toMatchObject({ name: 'Arjun Das', source: 'facebook', phone: null })
    expect(await q<any>(`SELECT * FROM crm.messages WHERE customer_id = $1`, [c.id])).toHaveLength(1)
    const l = await q1<any>(`SELECT * FROM crm.leads WHERE customer_id = $1`, [c.id])
    expect(l).toMatchObject({ source: 'facebook', social_id: 'PSID1', category: 'hall', guests: 150, property_id: sp.p2 })
    await processWebhook(page([{ sender: { id: 'PAGE1' }, recipient: { id: 'PSID1' }, timestamp: now(), message: { mid: 'm_echo', text: 'Thanks, sharing details', is_echo: true } }]))
    expect(await q<any>(`SELECT direction, status FROM crm.messages WHERE customer_id = $1 ORDER BY created_at`, [c.id])).toEqual([{ direction: 'in', status: 'received' }, { direction: 'out', status: 'sent' }])
    expect(await q<any>(`SELECT * FROM crm.leads WHERE customer_id = $1`, [c.id])).toHaveLength(1)
    expect(await replyChannel(c.id)).toBe('facebook')
  })

  it('Instagram DM with unknown profile gets a placeholder customer name but a blank lead name', async () => {
    mockGraph(() => ({ status: 400, json: { error: { message: 'no permission' } } }))
    await processWebhook(page([{ sender: { id: 'IGSID9' }, recipient: { id: 'IG1' }, timestamp: now(), message: { mid: 'ig_1', text: 'price?' } }], 'instagram'))
    const l = await q1<any>(`SELECT l.*, c.name AS cname FROM crm.leads l JOIN crm.customers c ON c.id = l.customer_id WHERE l.source = 'instagram'`)
    expect(l).toMatchObject({ name: null, social_id: 'IGSID9', message: 'price?' })
    expect(l.cname).toBe('Instagram user …SID9')
  })

  it('replies only inside 24 hours and records Meta failures', async () => {
    const c = (await q1<any>(`SELECT id FROM crm.customers WHERE fb_psid = 'PSID1'`))!.id
    mockGraph(() => ({ recipient_id: 'PSID1', message_id: 'm_out1' }))
    const ok = await sendSocialText(c, 'facebook', 'Yes, available to discuss', owner)
    expect(ok.ok).toBe(true)
    expect(calls[0].url).toBe('https://graph.test/v25.0/PAGE1/messages')
    expect(JSON.parse(calls[0].init.body)).toEqual({ recipient: { id: 'PSID1' }, messaging_type: 'RESPONSE', message: { text: 'Yes, available to discuss' } })
    expect((await q1<any>(`SELECT status FROM crm.leads WHERE customer_id = $1`, [c]))!.status).toBe('contacted')
    mockGraph(() => ({ status: 400, json: { error: { code: 10, message: 'Outside allowed window' } } }))
    const bad = await sendSocialText(c, 'facebook', 'again', owner)
    expect(bad).toMatchObject({ ok: false, error: 'Outside allowed window' })
    await q(`UPDATE crm.messages SET created_at = now() - interval '25 hours' WHERE customer_id = $1 AND direction = 'in'`, [c])
    await expect(sendSocialText(c, 'facebook', 'late', owner)).rejects.toThrow(/24 hours/)
  })

  it('owner test message never calls Meta and is flagged as a test', async () => {
    mockGraph(() => { throw new Error('must not call Meta') })
    const r = await simulateSocial('instagram', 'ZZ TEST Insta', 'rooftop 12 Dec', owner)
    expect(calls).toHaveLength(0)
    expect((await q1<any>(`SELECT is_test, category FROM crm.leads WHERE customer_id = $1`, [r!.customerId]))).toEqual({ is_test: true, category: 'rooftop' })
    await expect(simulateSocial('facebook', 'Real Person', 'x', owner)).rejects.toThrow(/ZZ TEST/)
  })
})

describe('Lead Ads', () => {
  const leadgen = (id: string) => ({ object: 'page', entry: [{ id: 'PAGE1', time: now(), changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: 'PAGE1', form_id: 'F1', ad_id: 'A1', created_time: Math.floor(now() / 1000) } }] }] })
  it('fetches the full lead, matches an existing customer by phone, attributes campaign, and never duplicates', async () => {
    const existing = await newCustomer('Kakoli Sen', '9830099999')
    mockGraph((url) => url.includes('/F1') ? { name: 'Rooftop Dec form' } : {
      id: 'LEAD1', created_time: '2026-11-25T05:00:00+0000', platform: 'ig', form_id: 'F1', ad_id: 'A1', ad_name: 'Rooftop reel', campaign_id: 'C1', campaign_name: 'MonuRama rooftop Dec',
      field_data: [{ name: 'full_name', values: ['Kakoli Sen'] }, { name: 'phone_number', values: ['+91 98300 99999'] }, { name: 'email', values: ['K@X.COM'] }, { name: 'event_date', values: ['24 Dec'] }, { name: 'guests', values: ['60 guests'] }],
    })
    expect((await processWebhook(leadgen('LEAD1'))).errors).toEqual([])
    await processWebhook(leadgen('LEAD1'))
    expect(calls[0].url).toContain('/LEAD1?fields=')
    const l = await q<any>(`SELECT * FROM crm.leads WHERE external_id = 'LEAD1'`)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ source: 'instagram_lead_ad', customer_id: existing, phone: '919830099999', email: 'k@x.com', campaign_name: 'MonuRama rooftop Dec', ad_name: 'Rooftop reel', form_name: 'Rooftop Dec form', guests: 60, requested_dates: '24 Dec', property_id: sp.p2, is_test: false })
    expect((await q1<any>(`SELECT email FROM crm.customers WHERE id = $1`, [existing]))!.email).toBe('k@x.com')
  })

  it('a lead that cannot be fetched yet is reported as an error (kept for retry), not half-saved', async () => {
    mockGraph(() => ({ status: 403, json: { error: { code: 200, message: 'Requires leads_retrieval' } } }))
    const r = await processWebhook(leadgen('LEAD2'))
    expect(r.errors[0]).toMatch(/leads_retrieval/)
    expect(await q<any>(`SELECT * FROM crm.leads WHERE external_id = 'LEAD2'`)).toHaveLength(0)
  })
})

describe('follow-up and conversion', () => {
  it('assign, note, follow-up date, then a booking converts the lead and keeps the source', async () => {
    const lead = (await q1<any>(`SELECT * FROM crm.leads WHERE external_id = 'm_1'`))!
    await updateLead(lead.id, { status: 'follow_up', assignedTo: owner, nextFollowUp: '2026-11-20', note: 'Called, will confirm', propertyId: lead.property_id, category: 'hall', guests: 150 }, owner)
    const overdue = await listLeads({ view: 'overdue' }, '2026-11-25')
    expect(overdue.map((l) => l.id)).toContain(lead.id)
    const start = new Date('2027-02-10T10:00:00Z'), end = new Date('2027-02-10T16:00:00Z')
    const b = await createBooking({ customerId: lead.customer_id, bookingType: 'event', guests: 150, event: { spaceIds: [sp.rooftop], start, end, hours: 6 }, start, end }, owner)
    const after = (await q1<any>(`SELECT l.status, l.booking_id, l.source, l.notes, bk.source AS bsource FROM crm.leads l JOIN crm.bookings bk ON bk.id = l.booking_id WHERE l.id = $1`, [lead.id]))!
    expect(after).toMatchObject({ status: 'converted', booking_id: b.id, source: 'facebook', bsource: 'facebook' })
    expect(after.notes).toMatch(/Called, will confirm/)
  })
})

describe('Instagram API with Instagram login', () => {
  it('webhook signed with the Instagram app secret is accepted for Instagram only; replies go to graph.instagram.com', async () => {
    const { POST } = await import('@/app/api/whatsapp/webhook/route')
    const { createHmac } = await import('crypto')
    process.env.META_IG_LOGIN_APP_SECRET = 'igsecret'; process.env.META_IG_ACCESS_TOKEN = 'ig-token'; process.env.META_IG_ID = 'IGME'
    process.env.META_IG_GRAPH_BASE = 'https://ig.test/v25.0'
    const call = (payload: any, secret: string) => { const raw = JSON.stringify(payload); return POST(new Request('http://x/api/meta/webhook', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') } })) }
    mockGraph((url) => url.startsWith('https://ig.test') && url.includes('IGSID77') ? { name: 'Puja Roy', username: 'puja.r' } : { recipient_id: 'IGSID77', message_id: 'ig_out1' })
    const ev = { object: 'instagram', entry: [{ id: 'IGME', time: now(), messaging: [{ sender: { id: 'IGSID77' }, recipient: { id: 'IGME' }, timestamp: now(), message: { mid: 'ig_login_1', text: 'Skyline room 2 nights?' } }] }] }
    expect((await call(ev, 'igsecret')).status).toBe(200)
    expect((await call({ object: 'page', entry: [] }, 'igsecret')).status).toBe(401) // IG secret cannot sign Page/WhatsApp events
    expect((await call(ev, 'wrong')).status).toBe(401)
    const c = (await q1<any>(`SELECT id, name, ig_username FROM crm.customers WHERE ig_sid = 'IGSID77'`))!
    expect(c).toMatchObject({ name: 'Puja Roy', ig_username: 'puja.r' })
    const r = await sendSocialText(c.id, 'instagram', 'Yes, sharing rates', owner)
    expect(r.ok).toBe(true)
    expect(calls.at(-1)!.url).toBe('https://ig.test/v25.0/IGME/messages')
    expect(calls.at(-1)!.init.headers.Authorization).toBe('Bearer ig-token')
  })
})

describe('Page filter', () => {
  it('ignores Messenger events for any Page other than META_PAGE_ID', async () => {
    const before = (await q1<any>(`SELECT count(*)::int n FROM crm.messages`))!.n
    const r = await processWebhook({ object: 'page', entry: [{ id: 'OTHERPAGE', time: now(), messaging: [{ sender: { id: 'PSIDX' }, recipient: { id: 'OTHERPAGE' }, timestamp: now(), message: { mid: 'm_other', text: 'hi' } }] }] })
    expect(r.errors).toEqual([])
    expect((await q1<any>(`SELECT count(*)::int n FROM crm.messages`))!.n).toBe(before)
  })
})
