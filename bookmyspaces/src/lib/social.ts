import { metaEnv } from './env'
import { q, q1, tx, type Db } from './db'
import { logActivity } from './activity'
import { normalizePhone } from './phone'
import { graphBase } from './whatsapp'
import { leadFromMessage, extractDetails, propertyFromText, isTestName, SOURCE_LABEL, type LeadSource } from './leads'

type Channel = 'facebook' | 'instagram'

/** Facebook Page / Instagram settings (Vercel env). The app secret and verify token are shared with WhatsApp (same Meta app). */
export function socialStatus() {
  const token = Boolean(metaEnv('META_PAGE_ACCESS_TOKEN'))
  const igLogin = Boolean(metaEnv('META_IG_ACCESS_TOKEN'))
  const page = token && Boolean(metaEnv('META_PAGE_ID'))
  return { pageId: metaEnv('META_PAGE_ID') ?? null, igId: metaEnv('META_IG_ID') ?? metaEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID') ?? null, igLogin, canFetch: token, canSend: page || igLogin, canSendFacebook: page, canSendInstagram: igLogin || page }
}

/** Instagram API with Instagram login (graph.instagram.com, Instagram user token). */
async function igGraph(path: string, init: RequestInit = {}): Promise<any> {
  const token = metaEnv('META_IG_ACCESS_TOKEN')
  if (!token) throw new Error('Instagram is not connected (META_IG_ACCESS_TOKEN missing).')
  const base = (metaEnv('META_IG_GRAPH_BASE') ?? 'https://graph.instagram.com/v25.0').replace(/\/$/, '')
  const res = await fetch(`${base}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(15_000) })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || j?.error) { const e = j?.error ?? {}; const err: any = new Error(e.message || `Instagram returned HTTP ${res.status}`); err.code = String(e.code ?? res.status); throw err }
  return j
}

async function graph(path: string, init: RequestInit = {}): Promise<any> {
  const token = metaEnv('META_PAGE_ACCESS_TOKEN')
  if (!token) throw new Error('Facebook Page is not connected (META_PAGE_ACCESS_TOKEN missing).')
  const res = await fetch(`${graphBase()}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(15_000) })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || j?.error) { const e = j?.error ?? {}; const err: any = new Error(e.message || `Meta returned HTTP ${res.status}`); err.code = String(e.code ?? res.status); throw err }
  return j
}

/** Customer's public name, if Meta allows it. Never guessed. */
async function profile(channel: Channel, sid: string): Promise<{ name: string | null; username: string | null }> {
  try {
    const j = channel === 'instagram' && metaEnv('META_IG_ACCESS_TOKEN') ? await igGraph(`${encodeURIComponent(sid)}?fields=name,username`)
      : await graph(`${encodeURIComponent(sid)}?fields=${channel === 'instagram' ? 'name,username' : 'first_name,last_name,name'}`)
    return { name: (j.name || [j.first_name, j.last_name].filter(Boolean).join(' ') || null), username: j.username ?? null }
  } catch { return { name: null, username: null } }
}

function eventText(ev: any): { type: string; body: string | null; mediaUrl: string | null } {
  const msg = ev.message
  if (ev.postback) return { type: 'text', body: ev.postback.title ?? ev.postback.payload ?? null, mediaUrl: null }
  if (msg?.text) return { type: 'text', body: msg.text, mediaUrl: null }
  const a = msg?.attachments?.[0]
  if (a) {
    const t = a.type === 'image' ? 'image' : a.type === 'video' ? 'video' : a.type === 'audio' ? 'audio' : a.type === 'file' ? 'document' : a.type || 'other'
    return { type: t, body: a.payload?.title ?? null, mediaUrl: a.payload?.url ?? null }
  }
  return { type: 'other', body: null, mediaUrl: null }
}

/** One Messenger / Instagram DM. Idempotent on Meta's message id (mid). */
export async function handleSocialMessage(channel: Channel, ev: any, opts: { test?: boolean; testName?: string } = {}): Promise<{ customerId: string; duplicate: boolean; leadCreated: boolean } | null> {
  const echo = Boolean(ev.message?.is_echo)
  const mid: string | undefined = ev.message?.mid ?? (ev.postback ? `pb.${ev.sender?.id}.${ev.timestamp}` : undefined)
  if (!mid) return null
  const sid: string | undefined = echo ? ev.recipient?.id : ev.sender?.id
  if (!sid) return null
  const col = channel === 'facebook' ? 'fb_psid' : 'ig_sid'
  const at = ev.timestamp ? new Date(Number(ev.timestamp)) : new Date()
  const d = eventText(ev)
  const known = await q1<{ id: string }>(`SELECT id FROM crm.customers WHERE ${col} = $1`, [sid])
  const prof = known || echo ? { name: opts.testName ?? null, username: null } : opts.test ? { name: opts.testName ?? null, username: null } : await profile(channel, sid)
  const adId: string | null = ev.referral?.ad_id ?? ev.postback?.referral?.ad_id ?? ev.message?.referral?.ad_id ?? null
  return tx(async (db) => {
    const dup = await q1<{ customer_id: string }>(`SELECT customer_id FROM crm.messages WHERE wa_message_id = $1`, [mid], db)
    if (dup) return { customerId: dup.customer_id, duplicate: true, leadCreated: false }
    let c = await q1<{ id: string; name?: string }>(`SELECT id, name FROM crm.customers WHERE ${col} = $1 FOR UPDATE`, [sid], db)
    if (!c) {
      const label = channel === 'facebook' ? 'Facebook' : 'Instagram'
      c = await q1<{ id: string }>(
        `INSERT INTO crm.customers (name, source, ${col}, ig_username) VALUES ($1,$2,$3,$4)
         ON CONFLICT (${col}) WHERE ${col} IS NOT NULL DO UPDATE SET updated_at = now() RETURNING id`,
        [prof.name?.trim() || (prof.username ? `@${prof.username}` : `${label} user …${sid.slice(-4)}`), channel, sid, prof.username], db)
      await logActivity({ customerId: c!.id, action: 'customer_created', detail: `From ${label}` }, db)
    }
    const ins = await q1<{ id: string }>(
      `INSERT INTO crm.messages (customer_id, direction, channel, msg_type, body, wa_message_id, status, created_at, sent_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL) ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
      [c!.id, echo ? 'out' : 'in', channel, d.type, d.body ?? (d.mediaUrl ? `[${d.type}] ${d.mediaUrl}` : null), mid, echo ? 'sent' : 'received', at], db)
    if (!ins) return { customerId: c!.id, duplicate: true, leadCreated: false }
    await q(`UPDATE crm.customers SET updated_at = now() WHERE id = $1`, [c!.id], db)
    if (echo) return { customerId: c!.id, duplicate: false, leadCreated: false } // a reply sent from Meta's own inbox
    await logActivity({ customerId: c!.id, action: `${channel}_in`, detail: (d.body ?? `[${d.type}]`).slice(0, 140) }, db)
    const known = c!.name && !/^(Facebook|Instagram) user …|^@/.test(c!.name) ? c!.name : null
    const leadName = prof.name ?? known
    const lead = await leadFromMessage({ customerId: c!.id, source: channel, messageId: mid, socialId: sid, name: leadName, text: d.body, adId, isTest: opts.test || isTestName(opts.testName) || isTestName(leadName), at }, db)
    return { customerId: c!.id, duplicate: false, leadCreated: lead.created }
  })
}

async function handleDelivery(ev: any) {
  if (ev.delivery?.mids?.length) await q(`UPDATE crm.messages SET status = 'delivered', status_updated_at = now() WHERE wa_message_id = ANY($1::text[]) AND direction = 'out' AND status IN ('sending','sent')`, [ev.delivery.mids])
  if (ev.read?.watermark && ev.sender?.id) {
    await q(`UPDATE crm.messages m SET status = 'read', status_updated_at = now() FROM crm.customers c
             WHERE c.id = m.customer_id AND c.fb_psid = $1 AND m.direction = 'out' AND m.channel = 'facebook' AND m.status IN ('sent','delivered') AND m.created_at <= to_timestamp($2::bigint / 1000.0)`, [ev.sender.id, ev.read.watermark])
  }
  if (ev.read?.mid) await q(`UPDATE crm.messages SET status = 'read', status_updated_at = now() WHERE wa_message_id = $1 AND direction = 'out'`, [ev.read.mid])
}

// ── Lead Ads ───────────────────────────────────────────────────────────────────

const FIELD = (fd: { name: string; values: string[] }[], ...names: string[]) => {
  for (const n of names) { const f = fd.find((x) => x.name.toLowerCase() === n); if (f?.values?.[0]) return f.values[0].trim() }
  return null
}
const STANDARD = new Set(['full_name', 'first_name', 'last_name', 'phone_number', 'phone', 'email', 'work_email'])

/** Builds a lead from the full Lead Ads record (the webhook only carries the id). */
export async function saveLeadAd(lead: any, form: { name?: string } | null, db?: Db): Promise<{ leadId: string; created: boolean; customerId: string }> {
  const fd: { name: string; values: string[] }[] = lead.field_data ?? []
  const name = FIELD(fd, 'full_name') ?? ([FIELD(fd, 'first_name'), FIELD(fd, 'last_name')].filter(Boolean).join(' ') || null)
  const rawPhone = FIELD(fd, 'phone_number', 'phone')
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  const email = FIELD(fd, 'email', 'work_email')?.toLowerCase() ?? null
  const answers = fd.filter((f) => !STANDARD.has(f.name.toLowerCase())).map((f) => `${f.name.replace(/_/g, ' ')}: ${f.values.join(', ')}`).join('\n') || null
  const source: LeadSource = lead.platform === 'ig' ? 'instagram_lead_ad' : 'facebook_lead_ad'
  const isTest = isTestName(name) || /test lead|dummy data/i.test(JSON.stringify(fd))
  const run = async (db: Db) => {
    const ex = await q1<{ id: string; customer_id: string }>(`SELECT id, customer_id FROM crm.leads WHERE source = $1 AND external_id = $2`, [source, String(lead.id)], db)
    if (ex) return { leadId: ex.id, created: false, customerId: ex.customer_id }
    let c = phone ? await q1<{ id: string }>(`SELECT id FROM crm.customers WHERE phone = $1 OR whatsapp = $1 ORDER BY (phone = $1) DESC LIMIT 1`, [phone], db) : null
    if (!c && email) c = await q1<{ id: string }>(`SELECT id FROM crm.customers WHERE lower(email) = $1 ORDER BY created_at LIMIT 1`, [email], db)
    if (c) {
      await q(`UPDATE crm.customers SET email = COALESCE(email, $2), updated_at = now() WHERE id = $1`, [c.id, email], db)
    } else {
      c = await q1<{ id: string }>(
        `INSERT INTO crm.customers (name, phone, whatsapp, email, source) VALUES ($1,$2,$2,$3,$4)
         ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET updated_at = now() RETURNING id`,
        [name || (email ?? 'Lead form enquiry'), phone, email, source], db)
      await logActivity({ customerId: c!.id, action: 'customer_created', detail: `From ${SOURCE_LABEL[source]}` }, db)
    }
    const d = extractDetails(answers)
    const propertyId = await propertyFromText(`${answers ?? ''} ${form?.name ?? ''} ${lead.campaign_name ?? ''} ${lead.ad_name ?? ''}`, db)
    const ins = await q1<{ id: string }>(
      `INSERT INTO crm.leads (customer_id, source, external_id, name, phone, email, message, property_id, category, requested_dates, guests, budget,
         campaign_ref, campaign_name, ad_id, ad_name, form_id, form_name, is_test, raw, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT (source, external_id) DO NOTHING RETURNING id`,
      [c!.id, source, String(lead.id), name, phone, email, answers, propertyId, answers ? d.category : null, d.requestedDates, d.guests, d.budget,
        lead.campaign_id ?? null, lead.campaign_name ?? null, lead.ad_id ?? null, lead.ad_name ?? null, lead.form_id ?? null, form?.name ?? null, isTest,
        JSON.stringify(lead), lead.created_time ? new Date(lead.created_time) : new Date()], db)
    if (ins) await logActivity({ customerId: c!.id, action: 'lead_created', detail: `New ${SOURCE_LABEL[source]}${form?.name ? ` (${form.name})` : ''}` }, db)
    return { leadId: ins?.id ?? '', created: Boolean(ins), customerId: c!.id }
  }
  return db ? run(db) : tx(run)
}

async function handleLeadgen(v: any) {
  const lead = await graph(`${encodeURIComponent(v.leadgen_id)}?fields=id,created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic`)
  let form: { name?: string } | null = null
  if (lead.form_id || v.form_id) { try { form = await graph(`${encodeURIComponent(lead.form_id ?? v.form_id)}?fields=name`) } catch { form = null } }
  return saveLeadAd({ ...lead, form_id: lead.form_id ?? v.form_id, ad_id: lead.ad_id ?? v.ad_id }, form)
}

/** Facebook Page and Instagram webhooks (object "page" / "instagram"). Comments, likes and mentions are ignored on purpose. */
export async function processSocialWebhook(payload: any): Promise<{ messages: number; leads: number; errors: string[] }> {
  const errors: string[] = []
  let messages = 0, leads = 0
  const channel: Channel = payload?.object === 'instagram' ? 'instagram' : 'facebook'
  const pageId = metaEnv('META_PAGE_ID')
  for (const entry of payload?.entry ?? []) {
    // Only the configured Facebook Page (other Pages on the app, and Meta's dashboard samples, are ignored).
    if (channel === 'facebook' && pageId && String(entry.id) !== pageId) continue
    for (const ev of entry.messaging ?? []) {
      try {
        if (ev.message || ev.postback) { const r = await handleSocialMessage(channel, ev); if (r && !r.duplicate) messages++ }
        else if (ev.delivery || ev.read) await handleDelivery(ev)
      } catch (e) { errors.push(`${channel} message: ${(e as Error).message}`) }
    }
    for (const ch of entry.changes ?? []) {
      try {
        if (ch.field === 'leadgen' && ch.value?.leadgen_id) { const r = await handleLeadgen(ch.value); if (r.created) leads++ }
        else if (ch.field === 'messages' && channel === 'instagram' && ch.value) { const r = await handleSocialMessage('instagram', ch.value); if (r && !r.duplicate) messages++ }
      } catch (e) { errors.push(`${ch.field}: ${(e as Error).message}`) }
    }
  }
  return { messages, leads, errors }
}

// ── Replies ────────────────────────────────────────────────────────────────────

export async function socialWindow(customerId: string, channel: Channel, now = new Date()) {
  const r = await q1<{ last: string | null }>(`SELECT max(created_at) AS last FROM crm.messages WHERE customer_id = $1 AND direction = 'in' AND channel = $2`, [customerId, channel])
  const last = r?.last ? new Date(r.last) : null
  return { open: Boolean(last && now.getTime() - last.getTime() < 24 * 3_600_000), lastInbound: r?.last ?? null }
}

/** The channel staff replies go out on: where the customer last wrote. */
export async function replyChannel(customerId: string): Promise<'whatsapp' | Channel> {
  const r = await q1<{ channel: 'whatsapp' | Channel }>(`SELECT channel FROM crm.messages WHERE customer_id = $1 AND direction = 'in' ORDER BY created_at DESC LIMIT 1`, [customerId])
  return r?.channel ?? 'whatsapp'
}

/** Staff reply on Messenger / Instagram, only inside Meta's 24-hour window. Never used for promotions. */
export async function sendSocialText(customerId: string, channel: Channel, body: string, userId: string) {
  const text = body.trim()
  if (!text) throw new Error('Type a message first.')
  const st = socialStatus()
  if (!(channel === 'facebook' ? st.canSendFacebook : st.canSendInstagram)) throw new Error(channel === 'facebook' ? 'Messenger replies are not connected yet (META_PAGE_ID / META_PAGE_ACCESS_TOKEN missing).' : 'Instagram replies are not connected yet (META_IG_ACCESS_TOKEN missing).')
  const w = await socialWindow(customerId, channel)
  if (!w.open) throw new Error(`More than 24 hours since the customer last wrote. ${channel === 'facebook' ? 'Messenger' : 'Instagram'} does not allow a reply from here now.`)
  const c = await q1<{ fb_psid: string | null; ig_sid: string | null }>(`SELECT fb_psid, ig_sid FROM crm.customers WHERE id = $1`, [customerId])
  const to = channel === 'facebook' ? c?.fb_psid : c?.ig_sid
  if (!to) throw new Error('No conversation id for this customer.')
  const id = (await q1<{ id: string }>(`INSERT INTO crm.messages (customer_id, direction, channel, msg_type, body, status, sent_by) VALUES ($1,'out',$2,'text',$3,'sending',$4) RETURNING id`, [customerId, channel, text, userId]))!.id
  try {
    const body = JSON.stringify({ recipient: { id: to }, messaging_type: 'RESPONSE', message: { text } })
    const j = channel === 'instagram' && st.igLogin ? await igGraph(`${encodeURIComponent(metaEnv('META_IG_ID') ?? 'me')}/messages`, { method: 'POST', body })
      : await graph(`${encodeURIComponent(metaEnv('META_PAGE_ID')!)}/messages`, { method: 'POST', body })
    await q(`UPDATE crm.messages SET status = 'sent', wa_message_id = $2, status_updated_at = now() WHERE id = $1`, [id, j.message_id ?? null])
    await q(`UPDATE crm.leads SET last_contact_at = now(), status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, updated_at = now() WHERE customer_id = $1 AND source = $2 AND status NOT IN ('converted','lost')`, [customerId, channel])
    await logActivity({ userId, customerId, action: `${channel}_out`, detail: text.slice(0, 140) })
    return { ok: true as const, messageId: id }
  } catch (e) {
    const err = e as any
    await q(`UPDATE crm.messages SET status = 'failed', error_code = $2, error_message = $3, status_updated_at = now() WHERE id = $1`, [id, err.code ?? 'error', err.message])
    await logActivity({ userId, customerId, action: `${channel}_failed`, detail: err.message })
    return { ok: false as const, messageId: id, error: err.message as string }
  }
}

/** Read-only owner check: the Page token can read the configured Page, and which fields this app receives for it. */
export async function checkPage(): Promise<string> {
  const s = socialStatus()
  if (!s.pageId || !s.canFetch) throw new Error('META_PAGE_ID / META_PAGE_ACCESS_TOKEN are not set in Vercel.')
  let p: any
  try { p = await graph('me?fields=id') } catch (e) {
    // #100 = Meta accepted the token but reading Page details needs pages_read_engagement (not needed for messaging). #190 = invalid token.
    if ((e as any).code === '100') return 'Token accepted by Meta. Page details cannot be read without pages_read_engagement; this is not needed to receive or send messages.'
    throw e
  }
  if (String(p.id) !== s.pageId) throw new Error('The Page token belongs to a different Page.')
  p.name = (await graph(`${encodeURIComponent(s.pageId)}?fields=name`).catch(() => null))?.name ?? 'Page'
  const subs = await graph(`${encodeURIComponent(s.pageId)}/subscribed_apps`).catch(() => null)
  const fields = (subs?.data ?? []).flatMap((a: any) => a.subscribed_fields ?? [])
  return `${p.name} (${p.id}) — token OK${fields.length ? `; receiving: ${fields.join(', ')}` : ''}`
}

/** Owner setup check: subscribes the Page to this app for messages and lead forms (uses the Page token in Vercel). */
export async function subscribePage(): Promise<string> {
  const s = socialStatus()
  if (!s.pageId || !s.canFetch) throw new Error('Add META_PAGE_ID and META_PAGE_ACCESS_TOKEN in Vercel first.')
  await graph(`${encodeURIComponent(s.pageId)}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_deliveries,message_reads,message_echoes,messaging_referrals,leadgen`, { method: 'POST' })
  const j = await graph(`${encodeURIComponent(s.pageId)}/subscribed_apps`)
  return (j.data ?? []).map((a: any) => `${a.name ?? a.id}: ${(a.subscribed_fields ?? []).join(', ')}`).join('; ') || 'Subscribed'
}

/** Owner-only test: runs a typed Messenger/Instagram message through the real code path. Nothing is sent. "ZZ TEST" names only. */
export async function simulateSocial(channel: Channel, name: string, text: string, userId: string) {
  if (!isTestName(name)) throw new Error('Test messages are only allowed for customers named “ZZ TEST …”.')
  if (!text.trim()) throw new Error('Type the message.')
  const sid = `test.${channel}.${name.trim().toLowerCase().replace(/\W+/g, '')}`
  const r = await handleSocialMessage(channel, { sender: { id: sid }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: `test.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`, text: text.trim() } }, { test: true, testName: name.trim() })
  if (r) await logActivity({ userId, customerId: r.customerId, action: `${channel}_test_in`, detail: 'Test message (not from Meta)' })
  return r
}
