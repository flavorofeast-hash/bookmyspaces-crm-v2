import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { createHmac } from 'crypto'
import { resetDb, closePool } from './helpers'
import { q, q1 } from '@/lib/db'
import { verifySignature, processWebhook, sendText, sendTemplate, windowOpen, handleStatus } from '@/lib/whatsapp'

const SECRET = 'meta-test-app-secret'
beforeAll(async () => {
  await resetDb()
  process.env.WHATSAPP_APP_SECRET = SECRET
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-me'
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'
  process.env.WHATSAPP_PHONE_NUMBER_ID = '111222333'
  process.env.META_GRAPH_BASE = 'https://graph.test/v21.0'
  await q(`UPDATE crm.business_settings SET business_hours_start = '00:00', business_hours_end = '23:59'`)
  await q(`INSERT INTO crm.campaigns (name, code) VALUES ('Diwali offer', 'DIWALI26')`)
})
afterAll(closePool)
afterEach(() => vi.unstubAllGlobals())

let sent: any[] = []
function mockGraph(reply: (body: any) => { status: number; json: any }) {
  sent = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const body = JSON.parse(init.body)
    sent.push({ url, body, auth: init.headers.Authorization })
    const r = reply(body)
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } })
  }))
}
const okGraph = () => mockGraph(() => ({ status: 200, json: { messages: [{ id: 'wamid.OUT' + Math.random().toString(36).slice(2) }] } }))

const payload = (msgs: any[], contacts: any[] = [], statuses: any[] = []) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '111222333' }, contacts, messages: msgs, statuses } }] }],
})
const sign = (raw: string, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')

describe('webhook security', () => {
  it('accepts a correctly signed body and rejects unsigned, wrongly signed or tampered bodies', () => {
    const raw = JSON.stringify(payload([]))
    expect(verifySignature(raw, sign(raw))).toBe(true)
    expect(verifySignature(raw, null)).toBe(false)
    expect(verifySignature(raw, sign(raw, 'wrong-secret'))).toBe(false)
    expect(verifySignature(raw + ' ', sign(raw))).toBe(false)
    expect(verifySignature(raw, 'sha256=abc')).toBe(false)
    expect(verifySignature(raw, sign(raw), '')).toBe(false) // no secret configured → reject
  })
})

describe('incoming messages', () => {
  it('creates a new customer from a first message, saves it and sends one auto-reply', async () => {
    okGraph()
    const r = await processWebhook(payload([{ id: 'wamid.IN1', from: '919812300001', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hi, is the hall free on 20 Dec? DIWALI26' } }],
      [{ wa_id: '919812300001', profile: { name: 'Sourav Basu' } }]))
    expect(r.errors).toEqual([])
    expect(r.inbound[0]).toMatchObject({ createdCustomer: true, duplicate: false, campaign: 'DIWALI26', autoReplied: true })
    const c = await q1<any>(`SELECT c.*, cp.code FROM crm.customers c LEFT JOIN crm.campaigns cp ON cp.id = c.campaign_id WHERE phone = '919812300001'`)
    expect(c).toMatchObject({ name: 'Sourav Basu', whatsapp: '919812300001', source: 'campaign', code: 'DIWALI26' })
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('https://graph.test/v21.0/111222333/messages')
    expect(sent[0].auth).toBe('Bearer test-token')
    expect(sent[0].body).toMatchObject({ to: '919812300001', type: 'text' })
  })

  it('links a second message to the same customer, no second auto-reply, and ignores a duplicate delivery', async () => {
    okGraph()
    const m = { id: 'wamid.IN2', from: '919812300001', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'MEDIA1', caption: 'Photo of decoration we like' } }
    const r1 = await processWebhook(payload([m]))
    const r2 = await processWebhook(payload([m]))
    expect(r1.inbound[0]).toMatchObject({ createdCustomer: false, duplicate: false, autoReplied: false })
    expect(r2.inbound[0].duplicate).toBe(true)
    expect(sent).toHaveLength(0)
    const n = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.customers WHERE phone = '919812300001'`)
    expect(n!.n).toBe(1)
    const msgs = await q<any>(`SELECT msg_type, body, media_id FROM crm.messages WHERE customer_id = (SELECT id FROM crm.customers WHERE phone = '919812300001') AND direction = 'in' ORDER BY created_at`)
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ msg_type: 'image', media_id: 'MEDIA1' })
  })

  it('links to an existing customer entered with a 10-digit number, and records voice notes and locations', async () => {
    okGraph()
    await q(`INSERT INTO crm.customers (name, phone, whatsapp) VALUES ('Existing Guest', '919812300002', '919812300002')`)
    await processWebhook(payload([
      { id: 'wamid.IN3', from: '919812300002', type: 'audio', audio: { id: 'VOICE1' } },
      { id: 'wamid.IN4', from: '919812300002', type: 'location', location: { latitude: 22.57, longitude: 88.36, name: 'Salt Lake' } },
    ]))
    const rows = await q<any>(`SELECT m.msg_type, m.body, c.name FROM crm.messages m JOIN crm.customers c ON c.id = m.customer_id WHERE c.phone = '919812300002' AND direction = 'in' ORDER BY m.created_at, m.msg_type`)
    expect(rows.map((r) => r.msg_type).sort()).toEqual(['audio', 'location'])
    expect(rows.find((r) => r.msg_type === 'location').body).toContain('Salt Lake')
    expect(rows[0].name).toBe('Existing Guest')
  })

  it('tags customers who came from a Facebook/Instagram click-to-WhatsApp ad', async () => {
    okGraph()
    await processWebhook(payload([{ id: 'wamid.IN5', from: '919812300003', type: 'text', text: { body: 'Interested' }, referral: { source_url: 'https://www.instagram.com/p/abc', source_type: 'ad', headline: 'Rooftop parties' } }]))
    const c = await q1<any>(`SELECT source, requirements FROM crm.customers WHERE phone = '919812300003'`)
    expect(c).toMatchObject({ source: 'instagram', requirements: 'Came from ad: Rooftop parties' })
  })
})

describe('sending replies', () => {
  it('sends a reply inside the 24-hour window and records the WhatsApp message id', async () => {
    okGraph()
    const c = await q1<any>(`SELECT id FROM crm.customers WHERE phone = '919812300001'`)
    const r = await sendText(c.id, 'Yes, the hall is free. Shall I send a quotation?', null)
    expect(r.ok).toBe(true)
    const m = await q1<any>(`SELECT status, wa_message_id FROM crm.messages WHERE id = $1`, [r.messageId])
    expect(m.status).toBe('sent')
    expect(m.wa_message_id).toMatch(/^wamid\.OUT/)
  })

  it('shows the real Meta error when sending fails', async () => {
    mockGraph(() => ({ status: 400, json: { error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030, error_data: { details: 'Add the number to the test recipients' } } } }))
    const c = await q1<any>(`SELECT id FROM crm.customers WHERE phone = '919812300001'`)
    const r = await sendText(c.id, 'Test', null)
    expect(r.ok).toBe(false)
    const m = await q1<any>(`SELECT status, error_code, error_message FROM crm.messages WHERE id = $1`, [r.messageId])
    expect(m).toMatchObject({ status: 'failed', error_code: '131030' })
    expect(m.error_message).toContain('Recipient phone number not in allowed list')
  })

  it('reports a network failure as failed, not sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND') }))
    const c = await q1<any>(`SELECT id FROM crm.customers WHERE phone = '919812300001'`)
    const r = await sendText(c.id, 'Test', null)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Could not reach WhatsApp/)
  })

  it('blocks free text outside the 24-hour window but allows an approved template', async () => {
    okGraph()
    const c = await q1<any>(`SELECT id FROM crm.customers WHERE phone = '919812300002'`)
    await q(`UPDATE crm.messages SET created_at = now() - interval '25 hours' WHERE customer_id = $1`, [c.id])
    expect((await windowOpen(c.id)).open).toBe(false)
    await expect(sendText(c.id, 'Hello again', null)).rejects.toThrow(/24 hours/)
    const t = await q1<any>(`INSERT INTO crm.wa_templates (name, language, uses_name_param, description) VALUES ('booking_followup', 'en', true, 'Follow-up') RETURNING id`)
    const r = await sendTemplate(c.id, t.id, null)
    expect(r.ok).toBe(true)
    expect(sent[0].body).toMatchObject({ type: 'template', template: { name: 'booking_followup', language: { code: 'en' } } })
    expect(sent[0].body.template.components[0].parameters[0].text).toBe('Existing Guest')
  })

  it('updates delivery status from Meta, never backwards, and records failure reasons', async () => {
    okGraph()
    const c = await q1<any>(`SELECT id FROM crm.customers WHERE phone = '919812300003'`)
    const r = await sendText(c.id, 'Hello', null)
    const wa = (await q1<any>(`SELECT wa_message_id FROM crm.messages WHERE id = $1`, [r.messageId])).wa_message_id
    await processWebhook(payload([], [], [{ id: wa, status: 'delivered' }, { id: wa, status: 'read' }, { id: wa, status: 'sent' }]))
    expect((await q1<any>(`SELECT status FROM crm.messages WHERE id = $1`, [r.messageId])).status).toBe('read')
    const r2 = await sendText(c.id, 'Hello 2', null)
    const wa2 = (await q1<any>(`SELECT wa_message_id FROM crm.messages WHERE id = $1`, [r2.messageId])).wa_message_id
    await handleStatus({ id: wa2, status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message', message: 'More than 24 hours have passed' }] })
    expect(await q1<any>(`SELECT status, error_code, error_message FROM crm.messages WHERE id = $1`, [r2.messageId])).toMatchObject({ status: 'failed', error_code: '131047', error_message: 'Re-engagement message — More than 24 hours have passed' })
  })

  it('refuses to send when WhatsApp is not configured', async () => {
    const tok = process.env.WHATSAPP_ACCESS_TOKEN
    delete process.env.WHATSAPP_ACCESS_TOKEN
    const c = await q1<any>(`SELECT id FROM crm.customers WHERE phone = '919812300001'`)
    await expect(sendText(c.id, 'x', null)).rejects.toThrow(/not connected/)
    process.env.WHATSAPP_ACCESS_TOKEN = tok
  })
})
