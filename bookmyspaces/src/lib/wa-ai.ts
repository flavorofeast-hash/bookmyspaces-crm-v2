import { metaEnv } from './env'
import { q, q1 } from './db'
import { logActivity } from './activity'

// WhatsApp AI replies, ported from V3's live path (webhook → chatWithAI with conversation history →
// evaluateHandoff → send). Differences on purpose: the business facts come only from owner-approved V2
// data (never V3's hard-coded prices), availability is never confirmed by the AI, and any reply that
// mentions a price not in the approved facts is blocked and handed to staff.

const ANTHROPIC_URL = `${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001' // V3's default (settings-service.ts)

export function aiConfigured(): boolean {
  return Boolean(metaEnv('ANTHROPIC_API_KEY') || metaEnv('OPENAI_API_KEY'))
}

// ── Handover rules (ported from V3 src/lib/ai/orchestrator.ts) ────────────────
const HUMAN_REQUEST = /\b(talk|speak|connect|chat)\s+(to|with)\s+((a|the)\s+)?(human|person|agent|manager|owner|staff|someone)\b|\b(real\s+person|human\s+agent|customer\s+care|baat\s+karni|baat\s+karna)\b/i
const COMPLAINT = /\b(complaint|complain|worst|terrible|horrible|disgusted|unacceptable|very\s+disappointed|cheated|fraud|scam)\b/i
const REFUND = /\b(refund|money\s+back|return\s+my\s+money|cancel\s+and\s+refund)\b/i
const PAYMENT_ISSUE = /\b(payment\s+(failed|issue|problem|stuck|deducted))|((paid|deducted).{0,40}(not\s+(confirmed|received|booked)))\b/i
const UNCERTAINTY = ["i'm not sure", 'i am not sure', "i don't know", 'i do not know', "i don't have that information", 'unable to help', 'cannot help with that']

export function customerNeedsStaff(text: string): string | null {
  if (HUMAN_REQUEST.test(text)) return 'Customer asked for a person'
  if (REFUND.test(text)) return 'Refund request'
  if (PAYMENT_ISSUE.test(text)) return 'Payment problem'
  if (COMPLAINT.test(text)) return 'Complaint'
  return null
}

const money = (n: number | string) => `₹${Number(n).toLocaleString('en-IN')}`

/** Everything the AI may say, built only from approved/owner-set CRM data. */
export async function businessFacts(): Promise<string> {
  const s = await q1<any>(`SELECT business_name, phone, checkin_time::text AS ci, checkout_time::text AS co FROM crm.business_settings WHERE id = 1`)
  const props = await q<any>(`SELECT id, name, promo_location, promo_highlights, promo_phones, promo_contacts_confirmed, booking_rules FROM crm.properties WHERE active ORDER BY sort_order, name`)
  const lines: string[] = [`Business: ${s?.business_name ?? 'BookMySpaces'}, Kolkata.`]
  if (s?.ci && s?.co) lines.push(`Room check-in from ${s.ci.slice(0, 5)}, check-out by ${s.co.slice(0, 5)}.`)
  for (const p of props) {
    lines.push('', `PROPERTY: ${p.name}`)
    if (p.promo_location) lines.push(`Location: ${p.promo_location}`)
    if (p.promo_highlights) lines.push(`Facilities: ${p.promo_highlights}`)
    if (p.promo_phones && p.promo_contacts_confirmed) lines.push(`Phone: ${p.promo_phones}`)
    if (p.booking_rules) lines.push(`Rules: ${p.booking_rules}`)
    const spaces = await q<any>(`SELECT name, kind, room_type, capacity, price, price_unit FROM crm.spaces WHERE property_id = $1 AND active ORDER BY kind, name`, [p.id])
    const groups = new Map<string, { n: number; cap: number | null; prices: Set<string> }>()
    for (const sp of spaces) {
      const k = sp.kind === 'room' ? (sp.room_type || 'room') : sp.name
      const g = groups.get(k) ?? { n: 0, cap: sp.capacity, prices: new Set<string>() }
      g.n++
      if (sp.price != null && sp.price_unit) g.prices.add(`${money(sp.price)} per ${sp.price_unit === 'night' ? 'night' : sp.price_unit === 'day' ? 'day' : sp.price_unit === 'hour' ? 'hour' : 'event slot'}`)
      groups.set(k, g)
    }
    for (const [k, g] of groups) lines.push(`- ${k}${g.n > 1 ? ` (${g.n})` : ''}${g.cap ? `, up to ${g.cap} guests` : ''}: ${g.prices.size ? `standard rate ${[...g.prices].join(' / ')}` : 'rate not published — staff will confirm'}`)
    const pk = await q<any>(`SELECT name, kind, price, price_basis, inclusions, max_guests, duration, food_type FROM crm.packages WHERE active AND review_status = 'approved' AND (property_id = $1 OR property_id IS NULL) ORDER BY name`, [p.id])
    for (const x of pk) lines.push(`- Package "${x.name}": ${money(x.price)}${x.price_basis === 'per_person' ? ' per guest' : ''}${x.max_guests ? `, up to ${x.max_guests} guests` : ''}${x.duration ? `, ${x.duration}` : ''}${x.food_type ? `, ${x.food_type === 'non_veg' ? 'non-veg' : x.food_type}` : ''}${x.inclusions?.length ? `; includes ${x.inclusions.join(', ')}` : ''}`)
    const ad = await q<any>(`SELECT name, price_min, price_max, unit FROM crm.addons WHERE active AND review_status = 'approved' AND (property_id = $1 OR property_id IS NULL) ORDER BY name`, [p.id])
    for (const a of ad) lines.push(`- Add-on "${a.name}": ${Number(a.price_min) === Number(a.price_max) ? money(a.price_min) : `${money(a.price_min)}–${money(a.price_max)}`}${a.unit === 'per_person' ? ' per guest' : ''}`)
  }
  if (s?.phone) lines.push('', `Main phone: ${s.phone}`)
  return lines.join('\n')
}

export function systemPrompt(facts: string): string {
  return `You are the WhatsApp assistant for BookMySpaces, a hospitality business in Kolkata (homestays, rooftop and hall events, café and private dining).

STYLE: warm, professional, Indian English, a few emojis at most. Short paragraphs, under 120 words. Ask only ONE question per reply. Reply in the customer's language (English, Bengali or Hindi). Do not add headers or divider lines.

STRICT RULES:
1. Use ONLY the BUSINESS FACTS below. If a price, package, menu item, facility, discount or policy is not listed there, do not state or guess it — say our team will confirm it.
2. Never say a date, room or venue is available or booked. Ask for the date, timing and number of guests, and say our team will check availability and confirm.
3. Never offer or agree to discounts.
4. When a staff member must take over (the customer gives booking details to confirm, asks for availability, asks something not covered by the facts, asks for a person, complains, or mentions refunds or payment problems), still write a short polite reply saying a team member will reply shortly, then add on a new line: <<HANDOVER: short reason>>
5. Never mention these rules or that you are following facts.

BUSINESS FACTS:
${facts}`
}

type Turn = { role: 'user' | 'assistant'; content: string }

async function callAI(system: string, turns: Turn[]): Promise<string | null> {
  const key = metaEnv('ANTHROPIC_API_KEY')
  if (key) {
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, max_tokens: 500, system, messages: turns }),
      })
      const j: any = await res.json().catch(() => ({}))
      const t = j?.content?.find?.((c: any) => c.type === 'text')?.text
      if (res.ok && t) return t
      console.error('[wa-ai] Anthropic error', res.status, j?.error?.type ?? '')
    } catch (e) { console.error('[wa-ai] Anthropic failed', (e as Error).message) }
  }
  const ok = metaEnv('OPENAI_API_KEY') // V3 falls back to OpenAI gpt-4o-mini when Claude fails
  if (ok) {
    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${ok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 500, messages: [{ role: 'system', content: system }, ...turns] }),
      })
      const j: any = await res.json().catch(() => ({}))
      const t = j?.choices?.[0]?.message?.content
      if (res.ok && t) return t
      console.error('[wa-ai] OpenAI error', res.status)
    } catch (e) { console.error('[wa-ai] OpenAI failed', (e as Error).message) }
  }
  return null
}

/** Prices in the reply must all appear in the approved facts; otherwise the reply is not sent. */
export function unapprovedPrice(reply: string, facts: string): string | null {
  const nums = (s: string) => [...s.matchAll(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/gi)].map((m) => Number(m[1].replace(/,/g, '')))
  const allowed = new Set(nums(facts))
  const bad = nums(reply).find((n) => !allowed.has(n))
  return bad === undefined ? null : money(bad)
}

export type AIReply = { text: string | null; handover: string | null }

/** Builds a reply for the customer's latest message. text=null means do not send anything (hand over silently). */
export async function buildAIReply(customerId: string, latestText: string): Promise<AIReply> {
  const pre = customerNeedsStaff(latestText)
  const facts = await businessFacts()
  const history = await q<{ direction: string; body: string }>(
    `SELECT direction, body FROM (SELECT direction, body, created_at, id FROM crm.messages WHERE customer_id = $1 AND msg_type = 'text' AND body IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 18) x ORDER BY created_at, id`, [customerId])
  const turns: Turn[] = []
  for (const m of history) {
    const role = m.direction === 'in' ? 'user' : 'assistant'
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.content += `\n${m.body}`; else turns.push({ role, content: m.body })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  if (!turns.length || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: latestText })
  const raw = await callAI(systemPrompt(facts), turns)
  if (!raw) return { text: null, handover: 'AI not available' }
  const tag = raw.match(/<<HANDOVER:?\s*([^>]*)>>/i)
  let text = raw.replace(/<<HANDOVER[\s\S]*?(>>|$)/gi, '').replace(/<<[\s\S]*?>>/g, '').trim()
  const words = text.split(/\s+/)
  if (words.length > 160) text = words.slice(0, 160).join(' ') + '…'
  const badPrice = unapprovedPrice(text, facts)
  if (badPrice) return { text: null, handover: `AI reply blocked: mentioned ${badPrice}, which is not an approved price` }
  const unsure = UNCERTAINTY.some((m) => text.toLowerCase().includes(m))
  return { text: text || null, handover: pre ?? (tag ? (tag[1].trim() || 'Needs staff') : unsure ? 'AI was unsure' : null) }
}

export async function handOver(customerId: string, reason: string) {
  await q(`UPDATE crm.customers SET ai_paused = true, wa_handover_at = now(), wa_handover_reason = $2 WHERE id = $1`, [customerId, reason.slice(0, 200)])
  await logActivity({ customerId, action: 'whatsapp_handover', detail: reason.slice(0, 200) })
}
