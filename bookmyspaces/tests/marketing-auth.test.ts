import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { resetDb, closePool, seedSpaces, ist } from './helpers'
import { q, q1 } from '@/lib/db'
import { createCampaign, campaignStats, trackingLink, savePost, publishFacebook, publishInstagram, facebookConnection, instagramConnection, markPostedManually, getPost } from '@/lib/marketing'
import { processWebhook } from '@/lib/whatsapp'
import { createBooking } from '@/lib/bookings'
import { hashPassword, verifyPassword, makeSessionToken, readSessionToken } from '@/lib/auth'

beforeAll(async () => {
  await resetDb()
  process.env.META_GRAPH_BASE = 'https://graph.test/v21.0'
})
afterAll(closePool)
afterEach(() => vi.unstubAllGlobals())

describe('campaigns and enquiry tracking', () => {
  it('validates campaign codes', async () => {
    await expect(createCampaign({ name: 'X', code: 'no spaces' })).rejects.toThrow(/3–20 letters/)
    await createCampaign({ name: 'Winter rooftop', code: 'winter26', channel: 'instagram' })
    await expect(createCampaign({ name: 'Dup', code: 'WINTER26' })).rejects.toThrow(/already used/)
  })
  it('builds a campaign WhatsApp link containing the code', () => {
    const l = trackingLink('919051459463', 'WINTER26')!
    expect(l.startsWith('https://wa.me/919051459463?text=')).toBe(true)
    expect(decodeURIComponent(l)).toContain('(WINTER26)')
    expect(trackingLink(null, 'WINTER26')).toBeNull()
  })
  it('counts enquiries and confirmed bookings per campaign end to end', async () => {
    process.env.WHATSAPP_APP_SECRET = 'x'; delete process.env.WHATSAPP_ACCESS_TOKEN
    await processWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [
      { id: 'w1', from: '919700000001', type: 'text', text: { body: 'Hi BookMySpaces! I saw your offer (WINTER26).' } },
      { id: 'w2', from: '919700000002', type: 'text', text: { body: 'winter26 rooftop price?' } },
      { id: 'w3', from: '919700000003', type: 'text', text: { body: 'hello' } },
    ] } }] }] })
    const S = await seedSpaces()
    const c = await q1<any>(`SELECT id FROM crm.customers WHERE phone = '919700000001'`)
    const e = { spaceIds: [S.rooftop], start: ist('2027-01-15', '16:00'), end: ist('2027-01-15', '23:00'), hours: 0 }
    await createBooking({ customerId: c.id, bookingType: 'event', event: e, start: e.start, end: e.end, confirm: true })
    const st = (await campaignStats()).find((x) => x.code === 'WINTER26')
    expect(st.enquiries).toBe(2)
    expect(st.bookings).toBe(1)
    expect(Number(st.booking_value)).toBe(12000)
  })
})

describe('content and publishing', () => {
  let postId: string, mediaId: string
  beforeAll(async () => {
    mediaId = (await q1<any>(`INSERT INTO crm.media (filename, mime, bytes, size, public_token) VALUES ('a.png','image/png','\\x89504e47',4,'tok123') RETURNING id`)).id
    postId = await savePost(null, { title: 'Rooftop Christmas', caption: 'Book the rooftop this Christmas! WINTER26', platforms: ['facebook', 'instagram', 'google'], plannedFor: '2026-12-01', mediaId })
  })

  it('saves content with platforms and image', async () => {
    const p = await getPost(postId)
    expect(p.platforms).toEqual(['facebook', 'instagram', 'google'])
    expect(p.media_token).toBe('tok123')
  })

  it('shows Not connected when Meta credentials are missing (no publish button)', async () => {
    delete process.env.META_PAGE_ID; delete process.env.META_PAGE_ACCESS_TOKEN; delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
    expect((await facebookConnection()).configured).toBe(false)
    expect((await instagramConnection()).configured).toBe(false)
    await expect(publishFacebook(postId)).rejects.toThrow(/not connected/)
  })

  it('Facebook: marks Published only when Meta returns a post id', async () => {
    process.env.META_PAGE_ID = 'PAGE1'; process.env.META_PAGE_ACCESS_TOKEN = 'page-token'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/PAGE1/photos')) return Response.json({ id: 'PHOTO9', post_id: 'PAGE1_POST9' })
      if (url.includes('PAGE1_POST9?fields=permalink_url')) return Response.json({ permalink_url: 'https://facebook.com/PAGE1/posts/9' })
      if (url.includes('PAGE1?fields=id,name')) return Response.json({ id: 'PAGE1', name: 'BookMySpaces' })
      return Response.json({ error: { message: 'unexpected ' + url } }, { status: 400 })
    }))
    expect(await facebookConnection()).toMatchObject({ ok: true, detail: 'Connected to Page “BookMySpaces”' })
    const r = await publishFacebook(postId)
    expect(r).toMatchObject({ ok: true, id: 'PAGE1_POST9', permalink: 'https://facebook.com/PAGE1/posts/9' })
    const pub = await q1<any>(`SELECT status, external_id FROM crm.post_publications WHERE platform = 'facebook' ORDER BY attempted_at DESC LIMIT 1`)
    expect(pub).toMatchObject({ status: 'published', external_id: 'PAGE1_POST9' })
  })

  it('Facebook: a Meta error is recorded as Failed with the real message, never Published', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: '(#200) The user hasn’t authorized the application to perform this action' } }, { status: 403 })))
    const r = await publishFacebook(postId)
    expect(r.ok).toBe(false)
    const pub = await q1<any>(`SELECT status, external_id, error FROM crm.post_publications WHERE platform = 'facebook' ORDER BY attempted_at DESC LIMIT 1`)
    expect(pub.status).toBe('failed')
    expect(pub.external_id).toBeNull()
    expect(pub.error).toContain('#200')
    await expect(q(`INSERT INTO crm.post_publications (post_id, platform, status) VALUES ($1,'facebook','published')`, [postId])).rejects.toMatchObject({ code: '23514' })
  })

  it('Instagram: container then publish, using the public image URL', async () => {
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = 'IG1'; process.env.APP_PUBLIC_URL = 'https://crm.example.com'
    const calls: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
      if (url.endsWith('/IG1/media')) return Response.json({ id: 'CONTAINER1' })
      if (url.endsWith('/IG1/media_publish')) return Response.json({ id: 'IGMEDIA1' })
      if (url.includes('IGMEDIA1?fields=permalink')) return Response.json({ permalink: 'https://instagram.com/p/xyz' })
      return Response.json({ error: { message: 'unexpected' } }, { status: 400 })
    }))
    const r = await publishInstagram(postId)
    expect(r).toMatchObject({ ok: true, id: 'IGMEDIA1' })
    expect(calls[0].body.image_url).toBe('https://crm.example.com/api/media/tok123')
    expect(calls[1].body.creation_id).toBe('CONTAINER1')
  })

  it('Google Business: manual posting is recorded as posted manually', async () => {
    await markPostedManually(postId, 'google', 'https://g.page/r/abc')
    const p = await getPost(postId)
    expect(p.publications.find((x: any) => x.platform === 'google').status).toBe('posted_manually')
  })
})

describe('login security', () => {
  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('correct horse battery')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('correct horse battery', h)).toBe(true)
    expect(await verifyPassword('wrong', h)).toBe(false)
  })
  it('session tokens: valid, tampered, expired', () => {
    const t = makeSessionToken('user-1', 3)
    expect(readSessionToken(t)).toEqual({ u: 'user-1', v: 3 })
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ u: 'owner-2', v: 3, e: Date.now() + 1e9 })).toString('base64url') + '.' + sig
    expect(readSessionToken(forged)).toBeNull()
    expect(readSessionToken(body + '.x' + sig.slice(2))).toBeNull()
    expect(readSessionToken(makeSessionToken('u', 1, Date.now() - 31 * 864e5))).toBeNull()
  })
})
