import { q, q1, type Db } from './db'
import { logActivity } from './activity'

export type LeadSource = 'whatsapp' | 'facebook' | 'instagram' | 'facebook_lead_ad' | 'instagram_lead_ad'
export const SOURCE_LABEL: Record<LeadSource, string> = {
  whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', facebook_lead_ad: 'Facebook Lead Ad', instagram_lead_ad: 'Instagram Lead Ad',
}
export const LEAD_STATUSES = ['new', 'contacted', 'follow_up', 'converted', 'lost'] as const
export const STATUS_TEXT: Record<string, string> = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', converted: 'Converted', lost: 'Lost' }
export const CATEGORIES = ['room', 'hall', 'rooftop', 'food', 'general'] as const

/** Details read only from what the customer wrote. Anything not stated stays blank. */
export function extractDetails(text: string | null | undefined) {
  const t = (text ?? '').trim()
  if (!t) return { category: null, guests: null, requestedDates: null, budget: null }
  const s = t.toLowerCase()
  const category = /roof\s?top|terrace/.test(s) ? 'rooftop'
    : /\bhall\b|wedding|marriage|reception|banquet|birthday|party|anniversary|\bevent\b|biye|bou\s?bhat/.test(s) ? 'hall'
    : /\brooms?\b|\bstay\b|night|check.?in|check.?out|\bac room|lodg/.test(s) ? 'room'
    : /food|menu|cater|caf[eé]|lunch|dinner|breakfast|biryani|thali/.test(s) ? 'food' : 'general'
  const g = t.match(/(\d{1,4})\s*(?:\+\s*)?(?:guests?|people|persons?|pax|members?|adults?|jon|jan|lok)\b/i)
  const months = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec'
  const dateRe = new RegExp(`\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s*(?:${months})[a-z]*\\b|\\b(?:${months})[a-z]*\\s*\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi')
  const dates = Array.from(new Set(t.match(dateRe) ?? []))
  const b = t.match(/(?:budget|₹|rs\.?|inr)\s*:?\s*([\d,]+(?:\.\d+)?\s*(?:k|thousand|lakh|lac)?)/i)
  return { category, guests: g ? Number(g[1]) : null, requestedDates: dates.length ? dates.join(', ') : null, budget: b ? b[1].trim() : null }
}

/** Property named in the text (only when exactly one property matches). */
export async function propertyFromText(text: string | null, db?: Db): Promise<string | null> {
  if (!text) return null
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM crm.properties WHERE active`, [], db)
  const t = text.toLowerCase()
  const hits = props.filter((p) => t.includes(p.name.toLowerCase()) || t.includes(p.name.toLowerCase().split(/\s+/)[0]))
  return hits.length === 1 ? hits[0].id : null
}

export const isTestName = (name: string | null | undefined) => /^ZZ TEST/i.test((name ?? '').trim())

/**
 * A new conversation message: adds it to the customer's open lead for that source, or opens a new lead.
 * Idempotent: one lead per (source, first message id), and only one open lead per customer and source.
 */
export async function leadFromMessage(a: { customerId: string; source: 'whatsapp' | 'facebook' | 'instagram'; messageId: string; socialId: string | null; name: string | null; phone?: string | null; text: string | null; propertyId?: string | null; adId?: string | null; isTest?: boolean; at?: Date }, db?: Db): Promise<{ leadId: string; created: boolean }> {
  const open = await q1<{ id: string }>(`SELECT id FROM crm.leads WHERE customer_id = $1 AND source = $2 AND status NOT IN ('converted','lost') ORDER BY created_at DESC LIMIT 1`, [a.customerId, a.source], db)
  if (open) {
    await q(`UPDATE crm.leads SET last_contact_at = GREATEST(COALESCE(last_contact_at, $2), $2), updated_at = now(),
               message = CASE WHEN message IS NULL OR message = '' THEN $3 ELSE message END,
               property_id = COALESCE(property_id, $4), ad_id = COALESCE(ad_id, $5) WHERE id = $1`, [open.id, a.at ?? new Date(), a.text, a.propertyId ?? null, a.adId ?? null], db)
    return { leadId: open.id, created: false }
  }
  const d = extractDetails(a.text)
  const propertyId = a.propertyId ?? await propertyFromText(a.text, db)
  const ins = await q1<{ id: string }>(
    `INSERT INTO crm.leads (customer_id, source, external_id, social_id, name, phone, message, property_id, category, requested_dates, guests, budget, last_contact_at, ad_id, is_test, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$13) ON CONFLICT (source, external_id) DO NOTHING RETURNING id`,
    [a.customerId, a.source, a.messageId, a.socialId, a.name, a.phone ?? null, a.text, propertyId, d.category, d.requestedDates, d.guests, d.budget, a.at ?? new Date(), a.adId ?? null, Boolean(a.isTest || isTestName(a.name))], db)
  if (!ins) {
    const ex = await q1<{ id: string }>(`SELECT id FROM crm.leads WHERE source = $1 AND external_id = $2`, [a.source, a.messageId], db)
    return { leadId: ex!.id, created: false }
  }
  await logActivity({ customerId: a.customerId, action: 'lead_created', detail: `New ${SOURCE_LABEL[a.source]} enquiry` }, db)
  return { leadId: ins.id, created: true }
}

export type LeadFilter = { status?: string; source?: string; q?: string; view?: 'open' | 'overdue' | 'all'; includeTests?: boolean }

export async function listLeads(f: LeadFilter = {}, today: string) {
  const s = (f.q ?? '').trim()
  return q<any>(
    `SELECT l.*, l.next_follow_up::text AS next_follow_up, c.name AS customer_name, COALESCE(l.phone, c.phone, c.whatsapp) AS any_phone, COALESCE(l.email, c.email) AS any_email,
            p.name AS property_name, u.name AS assigned_name, b.ref AS booking_ref,
            GREATEST(l.last_contact_at, (SELECT max(m.created_at) FROM crm.messages m WHERE m.customer_id = l.customer_id)) AS last_contact
     FROM crm.leads l JOIN crm.customers c ON c.id = l.customer_id
     LEFT JOIN crm.properties p ON p.id = l.property_id LEFT JOIN crm.app_users u ON u.id = l.assigned_to LEFT JOIN crm.bookings b ON b.id = l.booking_id
     WHERE ($1 = '' OR l.status = $1) AND ($2 = '' OR l.source = $2) AND ($5 OR NOT l.is_test)
       AND ($3 = '' OR c.name ILIKE '%' || $3 || '%' OR l.name ILIKE '%' || $3 || '%' OR l.message ILIKE '%' || $3 || '%' OR COALESCE(l.phone, c.phone, '') LIKE '%' || $3 || '%' OR COALESCE(l.email, c.email, '') ILIKE '%' || $3 || '%')
       AND ($4 = 'all' OR ($4 = 'open' AND l.status NOT IN ('converted','lost')) OR ($4 = 'overdue' AND l.status NOT IN ('converted','lost') AND l.next_follow_up < $6::date))
     ORDER BY (l.status = 'new') DESC, l.next_follow_up NULLS LAST, l.created_at DESC LIMIT 300`,
    [f.status ?? '', f.source ?? '', s, f.view ?? 'open', Boolean(f.includeTests), today])
}

export async function getLead(id: string) {
  return q1<any>(
    `SELECT l.*, l.next_follow_up::text AS next_follow_up, c.name AS customer_name, c.phone AS customer_phone, c.whatsapp AS customer_whatsapp, c.email AS customer_email, c.ig_username,
            p.name AS property_name, u.name AS assigned_name, b.ref AS booking_ref
     FROM crm.leads l JOIN crm.customers c ON c.id = l.customer_id LEFT JOIN crm.properties p ON p.id = l.property_id
     LEFT JOIN crm.app_users u ON u.id = l.assigned_to LEFT JOIN crm.bookings b ON b.id = l.booking_id WHERE l.id = $1`, [id])
}

export async function leadCounts(today: string) {
  return q1<{ fresh: number; due: number; overdue: number }>(
    `SELECT count(*) FILTER (WHERE status = 'new')::int AS fresh,
            count(*) FILTER (WHERE status NOT IN ('converted','lost') AND next_follow_up = $1::date)::int AS due,
            count(*) FILTER (WHERE status NOT IN ('converted','lost') AND next_follow_up < $1::date)::int AS overdue
     FROM crm.leads WHERE NOT is_test`, [today])
}

export async function updateLead(id: string, f: { status?: string; assignedTo?: string | null; nextFollowUp?: string | null; propertyId?: string | null; category?: string | null; requestedDates?: string | null; guests?: number | null; budget?: string | null; note?: string | null }, userId: string) {
  if (f.status && !(LEAD_STATUSES as readonly string[]).includes(f.status)) throw new Error('Unknown status.')
  if (f.category && !(CATEGORIES as readonly string[]).includes(f.category)) throw new Error('Unknown category.')
  if (f.guests != null && (!Number.isInteger(f.guests) || f.guests < 0)) throw new Error('Guests must be a whole number.')
  const l = await q1<{ customer_id: string }>(
    `UPDATE crm.leads SET status = COALESCE($2, status), assigned_to = $3, next_follow_up = $4::date, property_id = $5, category = $6,
       requested_dates = $7, guests = $8, budget = $9,
       notes = CASE WHEN $10::text IS NULL OR $10 = '' THEN notes ELSE concat_ws(E'\n', notes, to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') || ' — ' || $10) END,
       last_contact_at = CASE WHEN $2 = 'contacted' THEN now() ELSE last_contact_at END, updated_at = now()
     WHERE id = $1 RETURNING customer_id`,
    [id, f.status || null, f.assignedTo || null, f.nextFollowUp || null, f.propertyId || null, f.category || null, f.requestedDates || null, f.guests ?? null, f.budget || null, f.note ?? null])
  if (!l) throw new Error('Lead not found.')
  await logActivity({ userId, customerId: l.customer_id, action: 'lead_updated', detail: [f.status && `status ${f.status}`, f.note && 'note added', f.nextFollowUp && `follow-up ${f.nextFollowUp}`].filter(Boolean).join(', ') || 'details' })
}

/** Called when a booking is created: the customer's open lead becomes converted (source is kept on the lead and the booking). */
export async function convertOpenLeads(customerId: string, bookingId: string, db?: Db) {
  await q(`UPDATE crm.leads SET status = 'converted', booking_id = $2, updated_at = now() WHERE customer_id = $1 AND status NOT IN ('converted','lost')`, [customerId, bookingId], db)
}
