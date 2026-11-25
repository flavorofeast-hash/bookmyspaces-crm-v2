import { metaEnv } from './env'
import { createHmac, timingSafeEqual } from 'crypto'
import { q, q1, tx, type Db } from './db'
import { normalizePhone, formatPhone } from './phone'
import { logActivity } from './activity'
import { aiConfigured, buildAIReply, handOver } from './wa-ai'
import { leadFromMessage } from './leads'

export function graphBase(): string {
  return (process.env.META_GRAPH_BASE || 'https://graph.facebook.com/v25.0').replace(/\/$/, '')
}

export function waStatus() {
  return {
    canSend: Boolean(metaEnv('WHATSAPP_ACCESS_TOKEN') && metaEnv('WHATSAPP_PHONE_NUMBER_ID')),
    canReceive: Boolean(metaEnv('WHATSAPP_APP_SECRET') && metaEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN')),
  }
}

/** Meta signs every webhook POST with the app secret (X-Hub-Signature-256: sha256=<hex>). */
export function verifySignature(rawBody: string, header: string | null, secret = metaEnv('WHATSAPP_APP_SECRET')): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const given = header.slice(7)
  if (given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'))
}

type WAMessage = {
  id: string; from: string; timestamp?: string; type: string
  text?: { body: string }; image?: { id: string; caption?: string; mime_type?: string }; video?: { id: string; caption?: string; mime_type?: string }
  audio?: { id: string; mime_type?: string }; voice?: { id: string; mime_type?: string }; document?: { id: string; filename?: string; caption?: string; mime_type?: string }
  sticker?: { id: string; mime_type?: string }; location?: { latitude: number; longitude: number; name?: string; address?: string }
  button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }
  referral?: { source_url?: string; source_type?: string; headline?: string; source_id?: string }
  contacts?: unknown[]
}

function describe(m: WAMessage): { type: string; body: string | null; mediaId: string | null; mime?: string | null; filename?: string | null } {
  const media = (m as any)[m.type]
  const base = describeBody(m)
  return { ...base, mime: media?.mime_type ?? null, filename: m.type === 'document' ? m.document?.filename ?? null : null }
}

function describeBody(m: WAMessage): { type: string; body: string | null; mediaId: string | null } {
  switch (m.type) {
    case 'text': return { type: 'text', body: m.text?.body ?? '', mediaId: null }
    case 'image': return { type: 'image', body: m.image?.caption ?? null, mediaId: m.image?.id ?? null }
    case 'video': return { type: 'video', body: m.video?.caption ?? null, mediaId: m.video?.id ?? null }
    case 'audio': return { type: 'audio', body: null, mediaId: m.audio?.id ?? null }
    case 'voice': return { type: 'audio', body: null, mediaId: m.voice?.id ?? null }
    case 'document': return { type: 'document', body: m.document?.caption ?? m.document?.filename ?? null, mediaId: m.document?.id ?? null }
    case 'sticker': return { type: 'sticker', body: null, mediaId: m.sticker?.id ?? null }
    case 'location': {
      const l = m.location!
      return { type: 'location', body: [l.name, l.address, `${l.latitude},${l.longitude}`].filter(Boolean).join(' — '), mediaId: null }
    }
    case 'button': return { type: 'text', body: m.button?.text ?? '', mediaId: null }
    case 'interactive': return { type: 'text', body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '', mediaId: null }
    case 'contacts': return { type: 'contacts', body: 'Shared a contact card', mediaId: null }
    default: return { type: m.type || 'other', body: null, mediaId: null }
  }
}

function sourceFromReferral(r?: WAMessage['referral']): string | null {
  if (!r) return null
  const s = `${r.source_url ?? ''} ${r.headline ?? ''}`.toLowerCase()
  if (s.includes('instagram') || s.includes('instagr.am')) return 'instagram'
  if (s.includes('facebook') || s.includes('fb.com') || s.includes('fb.me')) return 'facebook'
  return r.source_type === 'ad' ? 'facebook' : null
}

async function findCampaignCode(text: string | null, db: Db): Promise<{ id: string; code: string } | null> {
  if (!text) return null
  const tokens = Array.from(new Set((text.toUpperCase().match(/[A-Z0-9]{3,20}/g) ?? [])))
  if (!tokens.length) return null
  return q1<{ id: string; code: string }>(`SELECT id, code FROM crm.campaigns WHERE code = ANY($1::text[]) ORDER BY created_at DESC LIMIT 1`, [tokens], db)
}

/** The property an enquiry is about: the promotion behind its code, otherwise a property named in the message. */
async function detectProperty(text: string | null, campaignId: string | null, db: Db): Promise<string | null> {
  if (campaignId) {
    const p = await q1<{ property_id: string }>(`SELECT property_id FROM crm.promotions WHERE campaign_id = $1 LIMIT 1`, [campaignId], db)
    if (p) return p.property_id
  }
  if (!text) return null
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM crm.properties WHERE active`, [], db)
  const t = text.toLowerCase()
  const hits = props.filter((p) => t.includes(p.name.toLowerCase().split(/\s+/)[0]))
  return hits.length === 1 ? hits[0].id : null
}

function istMinutes(d: Date): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).split(':').map(Number)
  return h * 60 + m
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

export type InboundResult = { messageId: string | null; customerId: string; createdCustomer: boolean; duplicate: boolean; campaign: string | null; autoReplied: boolean }

/** Saves one inbound message, finds or creates its customer. Idempotent on Meta's message id. */
export async function handleInbound(m: WAMessage, profileName: string | null, now = new Date(), opts: { test?: boolean; allowAi?: boolean } = {}): Promise<InboundResult> {
  const phone = normalizePhone(m.from.startsWith('+') ? m.from : '+' + m.from)
  if (!phone) throw new Error(`Unusable sender number: ${m.from}`)
  const d = describe(m)
  const result = await tx(async (db) => {
    const dup = await q1<{ id: string; customer_id: string }>(`SELECT id, customer_id FROM crm.messages WHERE wa_message_id = $1`, [m.id], db)
    if (dup) return { messageId: dup.id, customerId: dup.customer_id, createdCustomer: false, duplicate: true, campaign: null, isFirst: false }
    let c = await q1<{ id: string; campaign_id: string | null }>(`SELECT id, campaign_id FROM crm.customers WHERE whatsapp = $1 OR phone = $1 ORDER BY (whatsapp = $1) DESC LIMIT 1 FOR UPDATE`, [phone], db)
    const campaign = await findCampaignCode(d.body, db)
    let created = false
    if (!c) {
      const src = sourceFromReferral(m.referral) ?? (campaign ? 'campaign' : 'whatsapp')
      c = await q1<{ id: string; campaign_id: string | null }>(
        `INSERT INTO crm.customers (name, phone, whatsapp, source, campaign_id, requirements)
         VALUES ($1,$2,$2,$3,$4,$5) ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET updated_at = now() RETURNING id, campaign_id`,
        [profileName?.trim() || `WhatsApp ${formatPhone(phone)}`, phone, src, campaign?.id ?? null,
          m.referral?.headline ? `Came from ad: ${m.referral.headline}` : null], db)
      created = true
      await logActivity({ customerId: c!.id, action: 'customer_created', detail: `From WhatsApp${campaign ? ` (campaign ${campaign.code})` : ''}` }, db)
    } else if (campaign && !c.campaign_id) {
      await q(`UPDATE crm.customers SET campaign_id = $2, updated_at = now() WHERE id = $1`, [c.id, campaign.id], db)
    }
    const propertyId = await detectProperty(d.body, campaign?.id ?? null, db)
    if (propertyId) await q(`UPDATE crm.customers SET property_id = $2 WHERE id = $1 AND property_id IS NULL`, [c!.id, propertyId], db)
    const prior = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.messages WHERE customer_id = $1 AND direction = 'in'`, [c!.id], db)
    const ins = await q1<{ id: string }>(
      `INSERT INTO crm.messages (customer_id, direction, msg_type, body, media_id, wa_message_id, status, created_at, media_mime, media_filename)
       VALUES ($1,'in',$2,$3,$4,$5,'received',$6,$7,$8) ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
      [c!.id, d.type, d.body, d.mediaId, m.id, m.timestamp ? new Date(Number(m.timestamp) * 1000) : now, d.mime ?? null, d.filename ?? null], db)
    await q(`UPDATE crm.customers SET updated_at = now() WHERE id = $1`, [c!.id], db)
    if (ins) await logActivity({ customerId: c!.id, action: 'whatsapp_in', detail: (d.body ?? `[${d.type}]`).slice(0, 140) }, db)
    if (ins) await leadFromMessage({ customerId: c!.id, source: 'whatsapp', messageId: m.id, socialId: phone, name: profileName?.trim() || null, phone, text: d.body, propertyId, adId: m.referral?.source_id ?? null, isTest: opts.test, at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : now }, db)
    return { messageId: ins?.id ?? null, customerId: c!.id, createdCustomer: created, duplicate: !ins, campaign: campaign?.code ?? null, isFirst: (prior?.n ?? 0) === 0 }
  })

  let autoReplied = false
  // V3 behaviour: an AI reply to every new message (owner switch, off by default), with staff handover.
  const aiOn = !result.duplicate && (!opts.test || opts.allowAi === true) && await aiRepliesOn()
  if (aiOn) autoReplied = await aiRespond(result.customerId, result.messageId!, d.type, d.body ?? '', now)
  if (!aiOn && !result.duplicate && !opts.test) {
    const s = await q1<{ auto_reply_enabled: boolean; auto_reply_text: string; business_hours_start: string; business_hours_end: string }>(
      `SELECT auto_reply_enabled, auto_reply_text, business_hours_start::text, business_hours_end::text FROM crm.business_settings WHERE id = 1`)
    if (s?.auto_reply_enabled && waStatus().canSend) {
      const mins = istMinutes(now)
      const outside = mins < toMin(s.business_hours_start) || mins >= toMin(s.business_hours_end)
      const recentAuto = await q1<{ n: number }>(
        `SELECT count(*)::int AS n FROM crm.messages WHERE customer_id = $1 AND is_auto_reply AND created_at > $2::timestamptz - interval '12 hours'`, [result.customerId, now])
      if ((result.isFirst || outside) && !recentAuto?.n) {
        const r = await sendText(result.customerId, s.auto_reply_text, null, { auto: true, now })
        autoReplied = r.ok
      }
    }
  }
  const { isFirst: _f, ...rest } = result as any
  return { ...rest, autoReplied }
}

async function aiRepliesOn(): Promise<boolean> {
  const s = await q1<{ ai_reply_enabled: boolean }>(`SELECT ai_reply_enabled FROM crm.business_settings WHERE id = 1`)
  return Boolean(s?.ai_reply_enabled && aiConfigured() && waStatus().canSend)
}

/** Replies once per new message; stays quiet while staff are handling the customer. Returns true if a reply was sent. */
async function aiRespond(customerId: string, messageId: string, type: string, text: string, now: Date): Promise<boolean> {
  const c = await q1<{ ai_paused: boolean }>(`SELECT ai_paused FROM crm.customers WHERE id = $1`, [customerId])
  if (c?.ai_paused) return false
  const staffActive = await q1(`SELECT 1 FROM crm.messages WHERE customer_id = $1 AND direction = 'out' AND NOT is_auto_reply AND created_at > $2::timestamptz - interval '12 hours' LIMIT 1`, [customerId, now])
  if (staffActive) return false // a person is handling this chat
  if (type !== 'text' || !text.trim()) { await handOver(customerId, `Customer sent a ${type} — please check it`); return false }
  const started = new Date()
  const r = await buildAIReply(customerId, text)
  // Never answer twice: skip if a newer customer message arrived, or anyone replied, while the AI was thinking.
  const newer = await q1(`SELECT 1 FROM crm.messages m, crm.messages me WHERE me.id = $2 AND m.customer_id = $1 AND m.id <> me.id
    AND ((m.direction = 'in' AND m.created_at > me.created_at) OR (m.direction = 'out' AND m.created_at >= $3)) LIMIT 1`, [customerId, messageId, started])
  if (newer) return false
  let sent = false
  if (r.text) sent = (await sendText(customerId, r.text, null, { auto: true, ai: true, now })).ok
  if (r.handover) await handOver(customerId, r.handover)
  else if (!sent) await handOver(customerId, 'AI reply could not be sent')
  return sent
}

/** Staff take over or give the conversation back to the AI. */
export async function setAiPaused(customerId: string, paused: boolean, userId: string) {
  await q(`UPDATE crm.customers SET ai_paused = $2, wa_handover_at = CASE WHEN $2 THEN COALESCE(wa_handover_at, now()) ELSE NULL END, wa_handover_reason = CASE WHEN $2 THEN COALESCE(wa_handover_reason, 'Paused by staff') ELSE NULL END WHERE id = $1`, [customerId, paused])
  await logActivity({ userId, customerId, action: paused ? 'whatsapp_ai_paused' : 'whatsapp_ai_resumed' })
}

export async function handleStatus(st: { id: string; status: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] }) {
  const map: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }
  const status = map[st.status]
  if (!status) return
  const err = st.errors?.[0]
  // Never move a status backwards (e.g. a late "sent" after "read").
  await q(
    `UPDATE crm.messages SET status = $2, status_updated_at = now(),
       error_code = COALESCE($3, error_code), error_message = COALESCE($4, error_message)
     WHERE wa_message_id = $1 AND direction = 'out'
       AND (array_position(ARRAY['sending','sent','delivered','read'], status) IS NULL
            OR $2 = 'failed'
            OR array_position(ARRAY['sending','sent','delivered','read'], $2) > array_position(ARRAY['sending','sent','delivered','read'], status))`,
    [st.id, status, err?.code ? String(err.code) : null, err ? [err.title, err.message, err.error_data?.details].filter(Boolean).join(' — ') : null])
}

export async function processWebhook(payload: any): Promise<{ inbound: InboundResult[]; statuses: number; errors: string[] }> {
  const inbound: InboundResult[] = []
  const errors: string[] = []
  let statuses = 0
  if (payload?.object === 'page' || payload?.object === 'instagram') {
    const { processSocialWebhook } = await import('./social')
    return { inbound, statuses, errors: (await processSocialWebhook(payload)).errors }
  }
  if (payload?.object !== 'whatsapp_business_account') return { inbound, statuses, errors }
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const v = change.value ?? {}
      for (const m of v.messages ?? []) {
        try {
          const contact = (v.contacts ?? []).find((c: any) => c.wa_id === m.from)
          inbound.push(await handleInbound(m, contact?.profile?.name ?? null))
        } catch (e) { errors.push((e as Error).message) }
      }
      for (const st of v.statuses ?? []) {
        try { await handleStatus(st); statuses++ } catch (e) { errors.push((e as Error).message) }
      }
    }
  }
  return { inbound, statuses, errors }
}

export async function windowOpen(customerId: string, now = new Date()): Promise<{ open: boolean; lastInbound: string | null }> {
  const r = await q1<{ last: string | null }>(`SELECT max(created_at) AS last FROM crm.messages WHERE customer_id = $1 AND direction = 'in' AND channel = 'whatsapp'`, [customerId])
  const last = r?.last ? new Date(r.last) : null
  return { open: Boolean(last && now.getTime() - last.getTime() < 24 * 3_600_000), lastInbound: r?.last ?? null }
}

type SendResult = { ok: boolean; messageId: string; error?: string }

async function callGraph(body: unknown): Promise<{ ok: true; waId: string } | { ok: false; code: string; message: string }> {
  try {
    const res = await fetch(`${graphBase()}/${metaEnv('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${metaEnv('WHATSAPP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const json: any = await res.json().catch(() => ({}))
    if (res.ok && json?.messages?.[0]?.id) return { ok: true, waId: json.messages[0].id }
    const e = json?.error ?? {}
    return { ok: false, code: String(e.code ?? res.status), message: [e.message, e.error_data?.details].filter(Boolean).join(' — ') || `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, code: 'network', message: `Could not reach WhatsApp: ${(e as Error).message}` }
  }
}

async function recordOutgoing(customerId: string, fields: { type: string; body: string; template?: string | null; auto?: boolean; ai?: boolean; userId?: string | null; now?: Date; mediaMime?: string | null; mediaFilename?: string | null }) {
  return (await q1<{ id: string }>(
    `INSERT INTO crm.messages (customer_id, direction, msg_type, body, status, template_name, is_auto_reply, sent_by, created_at, ai_generated, media_mime, media_filename)
     VALUES ($1,'out',$2,$3,'sending',$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [customerId, fields.type, fields.body, fields.template ?? null, fields.auto ?? false, fields.userId ?? null, fields.now ?? new Date(), fields.ai ?? false, fields.mediaMime ?? null, fields.mediaFilename ?? null]))!.id
}

async function finishOutgoing(id: string, r: Awaited<ReturnType<typeof callGraph>>): Promise<SendResult> {
  if (r.ok) {
    await q(`UPDATE crm.messages SET status = 'sent', wa_message_id = $2, status_updated_at = now() WHERE id = $1`, [id, r.waId])
    return { ok: true, messageId: id }
  }
  await q(`UPDATE crm.messages SET status = 'failed', error_code = $2, error_message = $3, status_updated_at = now() WHERE id = $1`, [id, r.code, r.message])
  return { ok: false, messageId: id, error: r.message }
}

async function recipient(customerId: string): Promise<string> {
  const c = await q1<{ whatsapp: string | null; phone: string | null }>(`SELECT whatsapp, phone FROM crm.customers WHERE id = $1`, [customerId])
  const to = c?.whatsapp ?? c?.phone
  if (!to) throw new Error('This customer has no WhatsApp number.')
  return to
}

/** Free-text reply. Meta only allows this within 24 hours of the customer's last message. */
export async function sendText(customerId: string, body: string, userId: string | null, opts: { auto?: boolean; ai?: boolean; now?: Date } = {}): Promise<SendResult> {
  const text = body.trim()
  if (!text) throw new Error('Type a message first.')
  if (!waStatus().canSend) throw new Error('WhatsApp sending is not connected (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing).')
  const w = await windowOpen(customerId, opts.now)
  if (!w.open) throw new Error('More than 24 hours since the customer last wrote. WhatsApp only allows an approved template now.')
  const to = await recipient(customerId)
  const id = await recordOutgoing(customerId, { type: 'text', body: text, auto: opts.auto, ai: opts.ai, userId, now: opts.now })
  const r = await finishOutgoing(id, await callGraph({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text, preview_url: false } }))
  if (!opts.auto) await logActivity({ userId, customerId, action: r.ok ? 'whatsapp_out' : 'whatsapp_failed', detail: r.ok ? text.slice(0, 140) : r.error })
  return r
}

/** Approved template message: allowed at any time. */
export async function sendTemplate(customerId: string, templateId: string, userId: string | null): Promise<SendResult> {
  if (!waStatus().canSend) throw new Error('WhatsApp sending is not connected.')
  const t = await q1<{ name: string; language: string; uses_name_param: boolean; description: string | null }>(`SELECT name, language, uses_name_param, description FROM crm.wa_templates WHERE id = $1`, [templateId])
  if (!t) throw new Error('Template not found.')
  const to = await recipient(customerId)
  const c = await q1<{ name: string }>(`SELECT name FROM crm.customers WHERE id = $1`, [customerId])
  const components = t.uses_name_param ? [{ type: 'body', parameters: [{ type: 'text', text: c?.name ?? 'there' }] }] : undefined
  const id = await recordOutgoing(customerId, { type: 'template', body: `[Template: ${t.name}] ${t.description ?? ''}`.trim(), template: t.name, userId })
  const r = await finishOutgoing(id, await callGraph({ messaging_product: 'whatsapp', to, type: 'template', template: { name: t.name, language: { code: t.language }, ...(components ? { components } : {}) } }))
  await logActivity({ userId, customerId, action: r.ok ? 'whatsapp_out' : 'whatsapp_failed', detail: r.ok ? `Template ${t.name}` : r.error })
  return r
}

export async function conversations(limit = 100, search = '') {
  const s = search.trim()
  const digits = s.replace(/\D/g, '')
  return q<any>(
    `SELECT c.id, c.name, c.whatsapp, c.phone, c.ai_paused, c.wa_handover_reason, p.name AS property_name, cp.code AS campaign_code,
       (SELECT b.ref FROM crm.bookings b WHERE b.customer_id = c.id ORDER BY b.created_at DESC LIMIT 1) AS booking_ref,
       m.body AS last_body, m.msg_type AS last_type, m.direction AS last_direction, m.created_at AS last_at, m.status AS last_status, m.ai_generated AS last_ai, m.channel AS last_channel,
       (SELECT count(*)::int FROM crm.messages u WHERE u.customer_id = c.id AND u.direction = 'in' AND NOT u.read_by_staff) AS unread
     FROM crm.customers c
     JOIN LATERAL (SELECT * FROM crm.messages mm WHERE mm.customer_id = c.id ORDER BY mm.created_at DESC LIMIT 1) m ON true
     LEFT JOIN crm.properties p ON p.id = c.property_id LEFT JOIN crm.campaigns cp ON cp.id = c.campaign_id
     WHERE $2 = '' OR c.name ILIKE '%' || $2 || '%' OR ($3 <> '' AND (c.phone LIKE '%' || $3 || '%' OR c.whatsapp LIKE '%' || $3 || '%'))
        OR cp.code ILIKE $2 OR EXISTS (SELECT 1 FROM crm.messages x WHERE x.customer_id = c.id AND x.body ILIKE '%' || $2 || '%')
     ORDER BY m.created_at DESC LIMIT $1`, [limit, s, digits.length >= 4 ? digits : ''])
}

export async function thread(customerId: string) {
  return q<any>(`SELECT m.*, u.name AS sent_by_name FROM crm.messages m LEFT JOIN crm.app_users u ON u.id = m.sent_by WHERE m.customer_id = $1 ORDER BY m.created_at, m.id`, [customerId])
}

// ── Media (photos, documents, voice notes) ─────────────────────────────────────

const OUT_MEDIA: Record<string, 'image' | 'document' | 'audio' | 'video'> = {
  'image/jpeg': 'image', 'image/png': 'image', 'application/pdf': 'document', 'audio/mpeg': 'audio', 'audio/ogg': 'audio', 'audio/aac': 'audio', 'audio/mp4': 'audio', 'video/mp4': 'video',
}

/** Downloads a customer's photo/document from Meta (needs the access token; links expire, so fetched on demand). */
export async function fetchMedia(mediaId: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const token = metaEnv('WHATSAPP_ACCESS_TOKEN')
  if (!token) throw new Error('WhatsApp is not connected.')
  const meta = await fetch(`${graphBase()}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) })
  const j: any = await meta.json().catch(() => ({}))
  if (!meta.ok || !j?.url) throw new Error(j?.error?.message ?? `Media not available (HTTP ${meta.status})`)
  const file = await fetch(j.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  if (!file.ok) throw new Error(`Media download failed (HTTP ${file.status})`)
  return { bytes: await file.arrayBuffer(), mime: j.mime_type ?? file.headers.get('content-type') ?? 'application/octet-stream' }
}

/** Sends a photo, PDF, audio or video file to the customer (inside the 24-hour window). */
export async function sendMedia(customerId: string, file: File, caption: string, userId: string): Promise<SendResult> {
  if (!waStatus().canSend) throw new Error('WhatsApp sending is not connected.')
  const kind = OUT_MEDIA[file.type]
  if (!kind) throw new Error('Send a JPG/PNG photo, PDF, MP3/OGG audio or MP4 video.')
  if (file.size > 4 * 1024 * 1024) throw new Error('Files up to 4 MB can be sent from the CRM.')
  const w = await windowOpen(customerId)
  if (!w.open) throw new Error('More than 24 hours since the customer last wrote. WhatsApp only allows an approved template now.')
  const to = await recipient(customerId)
  const id = await recordOutgoing(customerId, { type: kind, body: caption.trim() || file.name, userId, mediaMime: file.type, mediaFilename: file.name })
  let upload: { ok: true; mediaId: string } | { ok: false; code: string; message: string }
  try {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', file.type)
    form.append('file', file, file.name)
    const res = await fetch(`${graphBase()}/${metaEnv('WHATSAPP_PHONE_NUMBER_ID')}/media`, { method: 'POST', headers: { Authorization: `Bearer ${metaEnv('WHATSAPP_ACCESS_TOKEN')}` }, body: form, signal: AbortSignal.timeout(30_000) })
    const j: any = await res.json().catch(() => ({}))
    upload = res.ok && j?.id ? { ok: true, mediaId: String(j.id) } : { ok: false, code: String(j?.error?.code ?? res.status), message: j?.error?.message ?? `Upload failed (HTTP ${res.status})` }
  } catch (e) { upload = { ok: false, code: 'network', message: `Could not reach WhatsApp: ${(e as Error).message}` } }
  if (!upload.ok) return finishOutgoing(id, upload)
  await q(`UPDATE crm.messages SET media_id = $2 WHERE id = $1`, [id, upload.mediaId])
  const payload: any = { id: upload.mediaId }
  if (caption.trim() && kind !== 'audio') payload.caption = caption.trim()
  if (kind === 'document') payload.filename = file.name
  const r = await finishOutgoing(id, await callGraph({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: kind, [kind]: payload }))
  await logActivity({ userId, customerId, action: r.ok ? 'whatsapp_out' : 'whatsapp_failed', detail: r.ok ? `${kind}: ${file.name}` : r.error })
  return r
}

// ── Webhook error log (so nothing is lost when processing fails) ───────────────

export async function logWebhookError(payload: unknown, error: string) {
  try { await q(`INSERT INTO crm.wa_webhook_errors (payload, error) VALUES ($1, $2)`, [JSON.stringify(payload ?? null), error.slice(0, 2000)]) }
  catch (e) { console.error('[whatsapp webhook] could not log error', (e as Error).message) }
}

/** Runs a failed delivery again. Safe to repeat: messages are de-duplicated by WhatsApp message id. */
export async function reprocessWebhookError(id: number, userId: string): Promise<string[]> {
  const row = await q1<{ payload: any }>(`SELECT payload FROM crm.wa_webhook_errors WHERE id = $1 AND resolved_at IS NULL`, [id])
  if (!row) throw new Error('Already handled.')
  const r = await processWebhook(row.payload)
  if (!r.errors.length) await q(`UPDATE crm.wa_webhook_errors SET resolved_at = now(), resolved_by = $2 WHERE id = $1`, [id, userId])
  await logActivity({ userId, action: 'whatsapp_webhook_retry', detail: r.errors.length ? r.errors.join('; ').slice(0, 200) : 'Processed' })
  return r.errors
}

export async function markRead(customerId: string) {
  await q(`UPDATE crm.messages SET read_by_staff = true WHERE customer_id = $1 AND direction = 'in' AND NOT read_by_staff`, [customerId])
}

/**
 * Owner-only end-to-end check before WhatsApp moves to this CRM: runs a typed message through the same code path
 * as a real incoming message. Nothing is sent to anyone, and only customers named "ZZ TEST…" can be used.
 */
export async function simulateInbound(phone: string, name: string, text: string, userId: string, opts: { allowAi?: boolean } = {}): Promise<InboundResult> {
  if (!/^ZZ TEST/i.test(name.trim())) throw new Error('Test messages are only allowed for customers named “ZZ TEST …”, so real records are never touched.')
  const p = normalizePhone(phone)
  if (!p) throw new Error('Enter a valid 10-digit mobile number.')
  if (!text.trim()) throw new Error('Type the message.')
  const r = await handleInbound({ id: `test.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`, from: p, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text.trim() } } as WAMessage, name.trim(), new Date(), { test: true, allowAi: opts.allowAi })
  await logActivity({ userId, customerId: r.customerId, action: 'whatsapp_test_in', detail: `Test message (not from WhatsApp)${r.campaign ? `, promotion ${r.campaign}` : ''}${r.autoReplied ? ', real AI reply sent' : ''}` })
  return r
}
