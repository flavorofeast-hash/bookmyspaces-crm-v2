import { metaEnv, appPublicUrl } from './env'
import { randomBytes } from 'crypto'
import { q, q1 } from './db'
import { graphBase } from './whatsapp'
import { logActivity } from './activity'

export async function createCampaign(c: { name: string; code: string; channel?: string; startsOn?: string; endsOn?: string; notes?: string }) {
  const code = c.code.trim().toUpperCase()
  if (!c.name.trim()) throw new Error('Give the campaign a name.')
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new Error('Campaign code must be 3–20 letters or numbers, no spaces (e.g. DIWALI26).')
  const exists = await q1(`SELECT 1 FROM crm.campaigns WHERE code = $1`, [code])
  if (exists) throw new Error(`The code ${code} is already used by another campaign.`)
  return q1<{ id: string }>(
    `INSERT INTO crm.campaigns (name, code, channel, starts_on, ends_on, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [c.name.trim(), code, c.channel || null, c.startsOn || null, c.endsOn || null, c.notes || null])
}

export async function campaignStats() {
  return q<any>(
    `SELECT cp.*,
       (SELECT count(*)::int FROM crm.customers c WHERE c.campaign_id = cp.id) AS enquiries,
       (SELECT count(*)::int FROM crm.bookings b WHERE b.campaign_id = cp.id AND b.status IN ('confirmed','completed')) AS bookings,
       (SELECT COALESCE(sum(b.total),0) FROM crm.bookings b WHERE b.campaign_id = cp.id AND b.status IN ('confirmed','completed')) AS booking_value,
       (SELECT count(*)::int FROM crm.posts p WHERE p.campaign_id = cp.id) AS posts
     FROM crm.campaigns cp ORDER BY cp.created_at DESC`)
}

export function trackingLink(whatsappNumber: string | null, code: string, businessName = 'BookMySpaces'): string | null {
  if (!whatsappNumber) return null
  const text = `Hi ${businessName}! I saw your offer (${code}). Please share details.`
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`
}

export async function saveMedia(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Upload a JPG or PNG image.')
  if (file.size > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller.')
  const bytes = Buffer.from(await file.arrayBuffer())
  const r = await q1<{ id: string }>(`INSERT INTO crm.media (filename, mime, bytes, size, public_token) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [file.name.slice(0, 200), file.type, bytes, bytes.length, randomBytes(18).toString('base64url')])
  return r!.id
}

export type PostInput = { title: string; caption: string; platforms: string[]; plannedFor?: string | null; campaignId?: string | null; notes?: string | null; mediaId?: string | null }

export async function savePost(id: string | null, p: PostInput, userId?: string | null): Promise<string> {
  if (!p.title.trim()) throw new Error('Give the post a title.')
  const platforms = p.platforms.filter((x) => ['facebook', 'instagram', 'google'].includes(x))
  if (id) {
    await q(`UPDATE crm.posts SET title=$2, caption=$3, platforms=$4, planned_for=$5, campaign_id=$6, notes=$7, media_id=COALESCE($8, media_id), updated_at=now() WHERE id=$1`,
      [id, p.title.trim(), p.caption, platforms, p.plannedFor || null, p.campaignId || null, p.notes || null, p.mediaId || null])
    return id
  }
  const r = await q1<{ id: string }>(
    `INSERT INTO crm.posts (title, caption, platforms, planned_for, campaign_id, notes, media_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [p.title.trim(), p.caption, platforms, p.plannedFor || null, p.campaignId || null, p.notes || null, p.mediaId || null, userId ?? null])
  await logActivity({ userId, action: 'post_created', detail: p.title.trim() })
  return r!.id
}

export async function getPost(id: string) {
  const post = await q1<any>(
    `SELECT p.*, cp.name AS campaign_name, cp.code AS campaign_code, m.public_token AS media_token, m.mime AS media_mime
     FROM crm.posts p LEFT JOIN crm.campaigns cp ON cp.id = p.campaign_id LEFT JOIN crm.media m ON m.id = p.media_id WHERE p.id = $1`, [id])
  if (!post) return null
  const pubs = await q<any>(`SELECT * FROM crm.post_publications WHERE post_id = $1 ORDER BY attempted_at DESC`, [id])
  return { ...post, publications: pubs }
}

export async function listPosts() {
  return q<any>(
    `SELECT p.*, cp.code AS campaign_code, m.public_token AS media_token,
       (SELECT json_agg(json_build_object('platform', x.platform, 'status', x.status, 'permalink', x.permalink))
        FROM (SELECT DISTINCT ON (platform) platform, status, permalink FROM crm.post_publications pp WHERE pp.post_id = p.id ORDER BY platform, attempted_at DESC) x) AS latest
     FROM crm.posts p LEFT JOIN crm.campaigns cp ON cp.id = p.campaign_id LEFT JOIN crm.media m ON m.id = p.media_id
     ORDER BY p.planned_for NULLS LAST, p.created_at DESC`)
}

// ── Meta publishing ────────────────────────────────────────────────────────────

export type ConnState = { configured: boolean; ok: boolean; detail: string }

async function graphGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${graphBase()}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok || json.error) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
  return json
}

export async function facebookConnection(): Promise<ConnState> {
  const id = metaEnv('META_PAGE_ID'), token = metaEnv('META_PAGE_ACCESS_TOKEN')
  if (!id || !token) return { configured: false, ok: false, detail: 'Not connected: META_PAGE_ID and META_PAGE_ACCESS_TOKEN are not set.' }
  try {
    const j = await graphGet(`${id}?fields=id,name`, token)
    return { configured: true, ok: true, detail: `Connected to Page “${j.name}”` }
  } catch (e) {
    return { configured: true, ok: false, detail: `Connection check failed: ${(e as Error).message}` }
  }
}

export async function instagramConnection(): Promise<ConnState> {
  const id = metaEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID'), token = metaEnv('META_PAGE_ACCESS_TOKEN')
  if (!id || !token) return { configured: false, ok: false, detail: 'Not connected: INSTAGRAM_BUSINESS_ACCOUNT_ID and META_PAGE_ACCESS_TOKEN are not set.' }
  if (!appPublicUrl()) return { configured: true, ok: false, detail: 'APP_PUBLIC_URL is not set — Instagram must be able to download the image from this site.' }
  try {
    const j = await graphGet(`${id}?fields=id,username`, token)
    return { configured: true, ok: true, detail: `Connected to Instagram @${j.username}` }
  } catch (e) {
    return { configured: true, ok: false, detail: `Connection check failed: ${(e as Error).message}` }
  }
}

async function record(postId: string, platform: string, r: { ok: true; id: string; permalink: string | null } | { ok: false; error: string }, userId?: string | null) {
  await q(`INSERT INTO crm.post_publications (post_id, platform, status, external_id, permalink, error, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [postId, platform, r.ok ? 'published' : 'failed', r.ok ? r.id : null, r.ok ? r.permalink : null, r.ok ? null : r.error, userId ?? null])
  await logActivity({ userId, action: r.ok ? `post_published_${platform}` : `post_failed_${platform}`, detail: r.ok ? r.id : r.error })
}

/** Publishes to the Facebook Page. Returns success only when Meta returns a post id. */
export async function publishFacebook(postId: string, userId?: string | null) {
  const post = await q1<any>(`SELECT p.caption, m.bytes, m.mime, m.filename FROM crm.posts p LEFT JOIN crm.media m ON m.id = p.media_id WHERE p.id = $1`, [postId])
  if (!post) throw new Error('Post not found.')
  const pageId = metaEnv('META_PAGE_ID'), token = metaEnv('META_PAGE_ACCESS_TOKEN')
  if (!pageId || !token) throw new Error('Facebook is not connected.')
  let result: { ok: true; id: string; permalink: string | null } | { ok: false; error: string }
  try {
    let res: Response
    if (post.bytes) {
      const form = new FormData()
      form.append('caption', post.caption ?? '')
      form.append('access_token', token)
      form.append('source', new Blob([post.bytes], { type: post.mime }), post.filename)
      res = await fetch(`${graphBase()}/${pageId}/photos`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
    } else {
      if (!post.caption?.trim()) throw new Error('A text-only post needs a caption.')
      res = await fetch(`${graphBase()}/${pageId}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: post.caption, access_token: token }), signal: AbortSignal.timeout(30_000) })
    }
    const json: any = await res.json().catch(() => ({}))
    const id = json.post_id ?? json.id
    if (!res.ok || json.error || !id) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
    let permalink: string | null = null
    try { permalink = (await graphGet(`${id}?fields=permalink_url`, token)).permalink_url ?? null } catch { /* id is the confirmation; link is optional */ }
    result = { ok: true, id: String(id), permalink }
  } catch (e) {
    result = { ok: false, error: (e as Error).message }
  }
  await record(postId, 'facebook', result, userId)
  return result
}

/** Publishes to Instagram (container → publish). Instagram fetches the image from APP_PUBLIC_URL. */
export async function publishInstagram(postId: string, userId?: string | null) {
  const post = await q1<any>(`SELECT p.caption, m.public_token FROM crm.posts p LEFT JOIN crm.media m ON m.id = p.media_id WHERE p.id = $1`, [postId])
  if (!post) throw new Error('Post not found.')
  if (!post.public_token) throw new Error('Instagram posts need an image.')
  const ig = metaEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID'), token = metaEnv('META_PAGE_ACCESS_TOKEN'), base = appPublicUrl()
  if (!ig || !token || !base) throw new Error('Instagram is not connected.')
  if ((post.caption ?? '').length > 2200) throw new Error('Instagram captions can be at most 2,200 characters.')
  let result: { ok: true; id: string; permalink: string | null } | { ok: false; error: string }
  try {
    const post1 = async (path: string, body: Record<string, string>) => {
      const res = await fetch(`${graphBase()}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, access_token: token }), signal: AbortSignal.timeout(60_000) })
      const json: any = await res.json().catch(() => ({}))
      if (!res.ok || json.error || !json.id) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      return String(json.id)
    }
    const imageUrl = `${base.replace(/\/$/, '')}/api/media/${post.public_token}`
    const container = await post1(`${ig}/media`, { image_url: imageUrl, caption: post.caption ?? '' })
    const mediaId = await post1(`${ig}/media_publish`, { creation_id: container })
    let permalink: string | null = null
    try { permalink = (await graphGet(`${mediaId}?fields=permalink`, token)).permalink ?? null } catch { /* optional */ }
    result = { ok: true, id: mediaId, permalink }
  } catch (e) {
    result = { ok: false, error: (e as Error).message }
  }
  await record(postId, 'instagram', result, userId)
  return result
}

export async function markPostedManually(postId: string, platform: 'google' | 'facebook' | 'instagram', link: string | null, userId?: string | null) {
  await q(`INSERT INTO crm.post_publications (post_id, platform, status, permalink, created_by) VALUES ($1,$2,'posted_manually',$3,$4)`, [postId, platform, link || null, userId ?? null])
  await logActivity({ userId, action: `post_manual_${platform}` })
}
