import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resetDb, closePool, seedSpaces } from './helpers'
import { q, q1 } from '@/lib/db'
import { addMedia, updateMedia, createPromotion, generateWeek, markPromotionPosted, setPromotionStatus, availableTypes, saveOpportunity, buildCaptions, removeMedia, approvedInfoReply } from '@/lib/promo'
import { processWebhook } from '@/lib/whatsapp'

let S: Awaited<ReturnType<typeof seedSpaces>>, owner: string, staff: string
const img = (n: number) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), Buffer.from([n, n + 1, n + 2])])

beforeAll(async () => {
  await resetDb()
  S = await seedSpaces()
  owner = (await q1<{ id: string }>(`INSERT INTO crm.app_users (email, name, role, password_hash) VALUES ('o@t','Owner','owner','x') RETURNING id`))!.id
  staff = (await q1<{ id: string }>(`INSERT INTO crm.app_users (email, name, role, password_hash) VALUES ('s@t','Staff','staff','x') RETURNING id`))!.id
  await q(`UPDATE crm.properties SET promo_phones = '9051459463 / 7003853624', promo_whatsapp = '8017035546', promo_location = 'Mukundapur, EM Bypass, Kolkata', promo_highlights = 'Rooftop café · AC rooms' WHERE id = $1`, [S.p2])
})
afterAll(closePool)

describe('photo gallery', () => {
  it('keeps one copy of identical photos and only the owner can approve', async () => {
    const a = await addMedia(img(1), { filename: 'a.webp', mime: 'image/webp', propertyId: S.p2, category: 'rooftop', title: 'Rooftop' }, staff)
    const again = await addMedia(img(1), { filename: 'copy.webp', mime: 'image/webp' }, staff)
    expect(again).toEqual({ id: a.id, duplicate: true })
    await expect(addMedia(img(2), { filename: 'x.gif', mime: 'image/gif' }, staff)).rejects.toThrow(/JPG, PNG or WebP/)
    await expect(updateMedia(a.id, { propertyId: S.p2, category: 'rooftop', title: 'Rooftop', description: null, approved: true }, { id: staff, role: 'staff' })).rejects.toThrow(/Only the owner/)
    await updateMedia(a.id, { propertyId: S.p2, category: 'rooftop', title: 'Rooftop', description: null, approved: true }, { id: owner, role: 'owner' })
    expect((await q1(`SELECT approved FROM crm.media WHERE id = $1`, [a.id]))!.approved).toBe(true)
  })

  it('records an AI mark on imported images so they are never passed off as untouched photos', async () => {
    const m = await addMedia(img(40), { filename: 'gallery-4.webp', mime: 'image/webp', aiMark: true }, owner)
    expect((await q1(`SELECT ai_mark, approved FROM crm.media WHERE id = $1`, [m.id]))).toEqual({ ai_mark: true, approved: false })
  })
})

describe('promotions', () => {
  it('only offers promotion types the property really has', async () => {
    const t = await availableTypes(S.p2) // MonuRama test data: rooftop + room, no hall
    expect(t).toContain('rooftop'); expect(t).toContain('rooms'); expect(t).not.toContain('hall')
    await expect(createPromotion({ propertyId: S.p2, type: 'hall', language: 'en' }, staff)).rejects.toThrow(/has no hall bookings/)
  })

  it('uses only approved photos, never invents a price, and gives a trackable code', async () => {
    const unapproved = await addMedia(img(9), { filename: 'n.webp', mime: 'image/webp', propertyId: S.p2, category: 'rooftop' }, staff)
    await expect(createPromotion({ propertyId: S.p2, type: 'rooftop', language: 'both', mediaIds: [unapproved.id] }, staff)).rejects.toThrow(/approved for promotion/)
    const id = await createPromotion({ propertyId: S.p2, type: 'rooftop', language: 'both' }, staff)
    const p = await q1<any>(`SELECT pr.*, cp.code FROM crm.promotions pr JOIN crm.campaigns cp ON cp.id = pr.campaign_id WHERE pr.id = $1`, [id])
    expect(p.status).toBe('draft')
    expect(p.media_ids).toHaveLength(1)
    expect(p.captions.social).toContain('Ask us for current rates')
    expect(p.captions.social).not.toMatch(/₹/)
    expect(p.captions.social).toMatch(/[ঀ-৿]/) // Bengali included
    expect(p.captions.social).toContain('9051459463 / 7003853624')
    expect(p.captions.whatsapp).toContain(`wa.me/918017035546`)
    expect(p.captions.whatsapp).toContain(encodeURIComponent(p.code))
    await expect(createPromotion({ propertyId: S.p2, type: 'rooftop', language: 'en', offerKey: 'package:00000000-0000-0000-0000-000000000000' }, staff)).rejects.toThrow(/no longer approved/)
  })

  it('shows a price only from an approved catalogue item', async () => {
    const pk = (await q1<{ id: string }>(`INSERT INTO crm.packages (name, price, price_basis, kind, review_status, property_id, inclusions) VALUES ('Rooftop Party', 12000, 'flat', 'event', 'owner_review', $1, '{Decoration}') RETURNING id`, [S.p2]))!.id
    await expect(createPromotion({ propertyId: S.p2, type: 'rooftop', language: 'en', offerKey: `package:${pk}` }, staff)).rejects.toThrow(/no longer approved/)
    await q(`UPDATE crm.packages SET review_status = 'approved' WHERE id = $1`, [pk])
    const id = await createPromotion({ propertyId: S.p2, type: 'rooftop', language: 'en', offerKey: `package:${pk}` }, staff)
    const p = await q1<any>(`SELECT offer_line, captions FROM crm.promotions WHERE id = $1`, [id])
    expect(p.offer_line).toBe('Rooftop Party: ₹12,000 (includes Decoration)')
    expect(p.captions.social).toContain('₹12,000')
  })

  it('cannot be marked posted before the owner approves it', async () => {
    const id = await createPromotion({ propertyId: S.p2, type: 'rooms', language: 'bn' }, staff)
    await expect(markPromotionPosted(id, { destination: 'Facebook Page' }, staff)).rejects.toThrow(/owner must approve/)
    await setPromotionStatus(id, 'approved', owner)
    await expect(markPromotionPosted(id, { destination: 'Facebook', url: 'javascript:alert(1)' }, staff)).rejects.toThrow(/http/)
    await markPromotionPosted(id, { destination: 'Facebook Page', url: 'https://facebook.com/post/1' }, staff)
    expect((await q1(`SELECT status FROM crm.promotions WHERE id = $1`, [id]))!.status).toBe('posted')
    expect((await q1(`SELECT count(*)::int AS n FROM crm.promotion_events WHERE promotion_id = $1 AND kind = 'posted'`, [id]))!.n).toBe(1)
  })

  it('plans a week of drafts with varied wording', async () => {
    const ids = await generateWeek('2027-01-04', staff)
    expect(ids).toHaveLength(7)
    const rows = await q<any>(`SELECT promo_type, headline, planned_for::text AS d, status FROM crm.promotions WHERE id = ANY($1::uuid[]) ORDER BY planned_for`, [ids])
    expect(rows.map((r) => r.d)).toEqual(['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10'])
    expect(rows.every((r) => r.status === 'draft')).toBe(true)
    const sameType = await q<any>(`SELECT headline FROM crm.promotions WHERE property_id = $1 AND promo_type = 'rooftop' ORDER BY created_at`, [S.p2])
    expect(new Set(sameType.slice(0, 3).map((r) => r.headline)).size).toBe(3) // rotates through the wording
  })

  it('a photo used by a promotion is archived, not deleted', async () => {
    const m = await q1<{ id: string }>(`SELECT media_ids[1] AS id FROM crm.promotions LIMIT 1`)
    expect(await removeMedia(m!.id, owner)).toBe('archived')
    expect((await q1(`SELECT archived_at IS NOT NULL AS a, approved FROM crm.media WHERE id = $1`, [m!.id]))).toEqual({ a: true, approved: false })
  })

  it('captions are generic when no highlights are set', () => {
    const c = buildCaptions({ type: 'rooms', variant: 0, language: 'en', property: { id: 'x', name: 'Skyline Serenity', promo_phones: null, promo_whatsapp: null, promo_location: null, promo_highlights: null, promo_contacts_confirmed: false }, offerLine: null, code: 'SKRM1234', link: null })
    expect(c.social).not.toMatch(/rooftop|pool|wifi|breakfast/i)
    expect(c.waLink).toBeNull()
  })
})

describe('WhatsApp enquiries from promotions', () => {
  it('tags the customer with the promotion and its property, once', async () => {
    process.env.WHATSAPP_APP_SECRET = 'x'
    const code = (await q1<{ code: string }>(`SELECT cp.code FROM crm.promotions pr JOIN crm.campaigns cp ON cp.id = pr.campaign_id WHERE pr.property_id = $1 LIMIT 1`, [S.p2]))!.code
    const msg = { id: 'wamid.PROMO1', from: '919800011111', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: `Hi! I saw your post (${code}). Please share details.` } }
    const body = { object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1' }, contacts: [], messages: [msg], statuses: [] } }] }] }
    await processWebhook(body as any); await processWebhook(body as any)
    const c = await q<any>(`SELECT c.property_id, cp.code FROM crm.customers c JOIN crm.campaigns cp ON cp.id = c.campaign_id WHERE c.phone = '919800011111'`)
    expect(c).toEqual([{ property_id: S.p2, code }])
    expect((await q1(`SELECT count(*)::int AS n FROM crm.messages WHERE wa_message_id = 'wamid.PROMO1'`))!.n).toBe(1)
  })

  it('suggested reply uses only approved items', async () => {
    const r = await approvedInfoReply(S.p2)
    expect(r!.body).toContain('Rooftop Party: ₹12,000')
    expect(r!.body).not.toContain('owner_review')
  })
})

describe('free promotion directory', () => {
  it('cannot be approved until free posting is confirmed', async () => {
    await expect(saveOpportunity(null, { platform: 'Facebook group', name: 'Kolkata Rooms', url: 'https://facebook.com/groups/x', freePosting: 'unknown', membership: 'yes', status: 'approved' }, staff)).rejects.toThrow(/free posting is confirmed/)
    await saveOpportunity(null, { platform: 'Facebook group', name: 'Kolkata Rooms', url: 'https://facebook.com/groups/x', freePosting: 'unknown', membership: 'yes', status: 'new' }, staff)
    await expect(saveOpportunity(null, { platform: 'Facebook group', name: 'Dup', url: 'https://facebook.com/groups/x', freePosting: 'unknown', membership: 'yes', status: 'new' }, staff)).rejects.toThrow(/already in the list/)
  })
})
