import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { resetDb, closePool, seedSpaces } from './helpers'
import { q, q1 } from '@/lib/db'
import { processWebhook, sendMedia, conversations, reprocessWebhookError, logWebhookError, setAiPaused, sendText } from '@/lib/whatsapp'
import { businessFacts, unapprovedPrice } from '@/lib/wa-ai'

let S: Awaited<ReturnType<typeof seedSpaces>>, staff: string
let aiReply = 'Hello! 😊 Our rooftop is lovely for birthdays. How many guests are you expecting?'
let calls: { url: string; body: any }[] = []
let seq = 0

function mockApis() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init?.body ? JSON.parse(init.body) : null
    calls.push({ url, body })
    const json = (j: any, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('api.anthropic.com')) return aiReply === 'FAIL' ? json({ error: { type: 'overloaded' } }, 529) : json({ content: [{ type: 'text', text: aiReply }] })
    if (url.endsWith('/media')) return json({ id: 'MEDIA123' })
    if (url.endsWith('/messages')) return json({ messages: [{ id: `wamid.OUT${++seq}` }] })
    return json({}, 404)
  }))
}
const ts = () => String(Math.floor(Date.now() / 1000))
const hook = (m: any, name = 'Riya') => ({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '111' }, contacts: [{ wa_id: m.from, profile: { name } }], messages: [m] } }] }] })
const text = (id: string, from: string, body: string) => hook({ id, from, timestamp: ts(), type: 'text', text: { body } })
const out = (phone: string) => q<any>(`SELECT m.body, m.ai_generated, m.status FROM crm.messages m JOIN crm.customers c ON c.id = m.customer_id WHERE c.phone = $1 AND m.direction = 'out' ORDER BY m.created_at`, [phone])
const cust = (phone: string) => q1<any>(`SELECT * FROM crm.customers WHERE phone = $1`, [phone])

beforeAll(async () => {
  await resetDb()
  S = await seedSpaces()
  staff = (await q1<{ id: string }>(`INSERT INTO crm.app_users (email, name, role, password_hash) VALUES ('s@t','Staff Sima','staff','x') RETURNING id`))!.id
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'; process.env.WHATSAPP_PHONE_NUMBER_ID = '111'
  process.env.META_GRAPH_BASE = 'https://graph.test/v21.0'; process.env.ANTHROPIC_API_KEY = 'test-key'
  await q(`UPDATE crm.business_settings SET ai_reply_enabled = true, auto_reply_enabled = false`)
  await q(`UPDATE crm.properties SET promo_location = 'Mukundapur, Kolkata', promo_highlights = 'Rooftop café' WHERE id = $1`, [S.p2])
  await q(`INSERT INTO crm.packages (name, price, price_basis, kind, review_status, property_id) VALUES ('Rooftop Party', 12000, 'flat', 'event', 'approved', $1), ('Secret Draft', 99999, 'flat', 'event', 'owner_review', $1)`, [S.p2])
})
afterAll(closePool)
afterEach(() => vi.unstubAllGlobals())

describe('AI facts', () => {
  it('include approved packages and set rates only', async () => {
    const f = await businessFacts()
    expect(f).toContain('Rooftop Party": ₹12,000')
    expect(f).toContain('₹3,500 per night') // Family Room standard rate
    expect(f).not.toContain('Secret Draft')
    expect(f).not.toContain('99,999')
  })
  it('detects prices that are not approved', async () => {
    const f = await businessFacts()
    expect(unapprovedPrice('The party package is ₹12,000.', f)).toBeNull()
    expect(unapprovedPrice('Rooms from Rs 999 only!', f)).toBe('₹999')
  })
})

describe('AI replies (like V3)', () => {
  it('answers a new message once, marked as AI, using approved facts', async () => {
    mockApis()
    const p = text('wamid.A1', '919811100001', 'Hi, is your rooftop good for a birthday?')
    await processWebhook(p); await processWebhook(p) // Meta redelivery
    const sent = await out('919811100001')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ ai_generated: true, status: 'sent' })
    const ai = calls.filter((c) => c.url.includes('anthropic'))
    expect(ai).toHaveLength(1)
    expect(ai[0].body.system).toContain('Rooftop Party')
    expect(ai[0].body.system).toContain('Never say a date, room or venue is available')
    expect(ai[0].body.messages.at(-1)).toEqual({ role: 'user', content: 'Hi, is your rooftop good for a birthday?' })
    expect((await cust('919811100001')).ai_paused).toBe(false)
  })

  it('keeps conversation history and hands over when the AI asks for staff', async () => {
    mockApis()
    aiReply = 'Thank you! Our team will check 14 Feb for 40 guests and reply shortly.\n<<HANDOVER: booking request 14 Feb, 40 guests>>'
    await processWebhook(text('wamid.A2', '919811100001', '14 Feb, 40 guests'))
    const ai = calls.find((c) => c.url.includes('anthropic'))!
    expect(ai.body.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user'])
    const sent = await out('919811100001')
    expect(sent.at(-1).body).not.toContain('HANDOVER')
    const c = await cust('919811100001')
    expect(c).toMatchObject({ ai_paused: true, wa_handover_reason: 'booking request 14 Feb, 40 guests' })
    mockApis(); aiReply = 'ok'
    await processWebhook(text('wamid.A3', '919811100001', 'Any update?'))
    expect(calls.filter((x) => x.url.includes('anthropic'))).toHaveLength(0) // staff are handling it now
  })

  it('blocks a reply that mentions an unapproved price', async () => {
    mockApis(); aiReply = 'Rooms start at Rs 999 per night!'
    await processWebhook(text('wamid.B1', '919811100002', 'room price?'))
    expect(await out('919811100002')).toHaveLength(0)
    expect((await cust('919811100002')).wa_handover_reason).toContain('₹999')
  })

  it('hands over complaints and requests for a person, after a polite reply', async () => {
    mockApis(); aiReply = 'I am sorry to hear that. A team member will reply shortly.'
    await processWebhook(text('wamid.C1', '919811100003', 'I want to speak to the manager, this is a complaint'))
    expect(await out('919811100003')).toHaveLength(1)
    expect((await cust('919811100003')).wa_handover_reason).toBe('Customer asked for a person')
  })

  it('stays quiet while staff are replying, and resumes when staff hand back', async () => {
    mockApis(); aiReply = 'Welcome!'
    await processWebhook(text('wamid.D1', '919811100004', 'hello'))
    const c = await cust('919811100004')
    await sendText(c.id, 'Hi, Sima here from the team.', staff)
    mockApis()
    await processWebhook(text('wamid.D2', '919811100004', 'thanks'))
    expect(calls.filter((x) => x.url.includes('anthropic'))).toHaveLength(0)
    const m = await q1<any>(`SELECT u.name FROM crm.messages m JOIN crm.app_users u ON u.id = m.sent_by WHERE m.customer_id = $1`, [c.id])
    expect(m.name).toBe('Staff Sima')
    await setAiPaused(c.id, true, staff)
    expect((await cust('919811100004')).ai_paused).toBe(true)
    await setAiPaused(c.id, false, staff)
    expect((await cust('919811100004')).ai_paused).toBe(false)
  })

  it('hands photos/voice notes to staff and stores the file details', async () => {
    mockApis()
    await processWebhook(hook({ id: 'wamid.E1', from: '919811100005', timestamp: ts(), type: 'image', image: { id: 'IMG1', mime_type: 'image/jpeg', caption: 'this hall?' } }))
    const m = await q1<any>(`SELECT msg_type, media_id, media_mime, body FROM crm.messages WHERE wa_message_id = 'wamid.E1'`)
    expect(m).toEqual({ msg_type: 'image', media_id: 'IMG1', media_mime: 'image/jpeg', body: 'this hall?' })
    expect(calls.filter((x) => x.url.includes('anthropic'))).toHaveLength(0)
    expect((await cust('919811100005')).wa_handover_reason).toContain('image')
  })

  it('hands over without replying when the AI service is down', async () => {
    mockApis(); aiReply = 'FAIL'
    await processWebhook(text('wamid.F1', '919811100006', 'hi'))
    expect(await out('919811100006')).toHaveLength(0)
    expect((await cust('919811100006')).wa_handover_reason).toBe('AI not available')
    aiReply = 'ok'
  })
})

describe('staff attachments', () => {
  it('uploads the file to WhatsApp and sends it', async () => {
    mockApis()
    const c = await cust('919811100001')
    const r = await sendMedia(c.id, new File([new Uint8Array([1, 2, 3])], 'menu.pdf', { type: 'application/pdf' }), 'Our menu', staff)
    expect(r.ok).toBe(true)
    const send = calls.find((x) => x.url.endsWith('/messages') && x.body.type === 'document')!
    expect(send.body.document).toEqual({ id: 'MEDIA123', caption: 'Our menu', filename: 'menu.pdf' })
    await expect(sendMedia(c.id, new File(['x'], 'a.exe', { type: 'application/x-msdownload' }), '', staff)).rejects.toThrow(/JPG\/PNG/)
  })
})

describe('inbox search and recovery', () => {
  it('finds conversations by name, phone digits and message text', async () => {
    expect((await conversations(50, '1100003')).map((c) => c.phone)).toEqual(['919811100003'])
    expect((await conversations(50, 'complaint')).map((c) => c.phone)).toEqual(['919811100003'])
  })
  it('keeps failed deliveries and can process them again', async () => {
    const p = text('wamid.G1', '919811100007', 'late message')
    await logWebhookError(p, 'database timeout')
    const row = await q1<{ id: number }>(`SELECT id FROM crm.wa_webhook_errors WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 1`)
    mockApis()
    expect(await reprocessWebhookError(row!.id, staff)).toEqual([])
    expect((await q1(`SELECT count(*)::int AS n FROM crm.messages WHERE wa_message_id = 'wamid.G1'`))!.n).toBe(1)
    await expect(reprocessWebhookError(row!.id, staff)).rejects.toThrow(/Already handled/)
  })
})
