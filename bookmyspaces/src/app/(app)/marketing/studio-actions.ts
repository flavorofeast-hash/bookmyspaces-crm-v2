'use server'

import { requireUser, requireOwner } from '@/lib/auth'
import { run, str } from '@/lib/action'
import { simulateInbound } from '@/lib/whatsapp'
import { addMedia, updateMedia, removeMedia, importWebsitePhotos, createPromotion, generateWeek, setPromotionStatus, updateCaptions, recordPromoEvent, markPromotionPosted, saveOpportunity, type PromoType } from '@/lib/promo'

const back = (f: FormData, d: string) => { const b = str(f, 'back'); return b.startsWith('/marketing') ? b : d }

export async function uploadMediaAction(f: FormData) {
  const u = await requireUser()
  await run(back(f, '/marketing/gallery'), 'Photos added. The owner must approve them before they are used in promotions.', async () => {
    const files = f.getAll('images').filter((x): x is File => x instanceof File && x.size > 0)
    if (!files.length) throw new Error('Choose one or more photos.')
    let dup = 0
    for (const file of files) {
      const r = await addMedia(Buffer.from(await file.arrayBuffer()), { filename: file.name, mime: file.type, propertyId: str(f, 'property_id') || null, category: str(f, 'category') || null, title: str(f, 'title') || file.name.replace(/\.[a-z]+$/i, ''), description: str(f, 'description') || null }, u.id)
      if (r.duplicate) dup++
    }
    if (dup === files.length) throw new Error(dup === 1 ? 'That photo is already in the gallery.' : 'Those photos are already in the gallery.')
  })
}

export async function updateMediaAction(f: FormData) {
  const u = await requireUser()
  await run(back(f, '/marketing/gallery'), 'Photo saved.', async () => {
    await updateMedia(str(f, 'id'), { propertyId: str(f, 'property_id') || null, category: str(f, 'category') || null, title: str(f, 'title') || null, description: str(f, 'description') || null,
      approved: f.has('approved_field') ? f.get('approved') === 'on' : undefined }, u)
  })
}

export async function removeMediaAction(f: FormData) {
  const u = await requireOwner()
  await run(back(f, '/marketing/gallery'), 'Photo removed.', async () => {
    const r = await removeMedia(str(f, 'id'), u.id)
    if (r === 'archived') return '/marketing/gallery?archived=1'
  })
}

export async function importWebsiteAction() {
  const u = await requireOwner()
  await run('/marketing/gallery', 'Website photos imported.', async () => {
    const r = await importWebsitePhotos(u.id)
    if (!r.added && !r.duplicates) throw new Error(`No photos could be downloaded from the website. ${r.failed.join(', ')}`)
    return `/marketing/gallery?note=${encodeURIComponent(`Website photos: ${r.added} added, ${r.duplicates} already in the gallery${r.failed.length ? `, could not download: ${r.failed.join(', ')}` : ''}. Review each one and approve the ones to use.`)}`
  })
}

export async function createPromotionAction(f: FormData) {
  const u = await requireUser()
  await run('/marketing/studio', 'Promotion ready. Review it below.', async () => {
    const id = await createPromotion({ propertyId: str(f, 'property_id'), type: str(f, 'promo_type') as PromoType, language: (str(f, 'language') || 'both') as any,
      offerKey: str(f, 'offer') || null, occasion: str(f, 'occasion') || null, plannedFor: str(f, 'planned_for') || null,
      mediaIds: f.getAll('media_ids').map(String).filter(Boolean) }, u.id)
    return `/marketing/promotions/${id}`
  })
}

export async function generateWeekAction(f: FormData) {
  const u = await requireUser()
  await run('/marketing/studio', '7 draft promotions created for the week. The owner approves each before it is posted.', async () => { await generateWeek(str(f, 'start_on'), u.id) })
}

export async function promotionStatusAction(f: FormData) {
  const id = str(f, 'id'), to = str(f, 'to') as 'approved' | 'archived' | 'draft'
  const u = to === 'approved' ? await requireOwner() : await requireUser()
  await run(`/marketing/promotions/${id}`, to === 'approved' ? 'Approved — staff can now post it.' : to === 'archived' ? 'Promotion archived.' : 'Moved back to draft.', async () => {
    if (!['approved', 'archived', 'draft'].includes(to)) throw new Error('Unknown status.')
    await setPromotionStatus(id, to, u.id)
    if (to === 'archived') return '/marketing/studio'
  })
}

export async function updateCaptionsAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'id')
  await run(`/marketing/promotions/${id}`, 'Captions saved.', async () => {
    await updateCaptions(id, { social: String(f.get('social') ?? ''), whatsapp: String(f.get('whatsapp') ?? ''), group: String(f.get('group') ?? ''), classified: String(f.get('classified') ?? '') }, u.id)
  })
}

export async function markPostedAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'id')
  await run(`/marketing/promotions/${id}`, 'Recorded as posted.', async () => {
    await markPromotionPosted(id, { opportunityId: str(f, 'opportunity_id') || null, destination: str(f, 'destination') || null, url: str(f, 'url') || null, postedOn: str(f, 'posted_on') || null }, u.id)
  })
}

/** Called from the browser when a file is downloaded or text copied (tracking only). */
export async function logPromoEvent(id: string, kind: string, detail?: string) {
  const u = await requireUser()
  await recordPromoEvent(id, kind, detail ?? null, u.id)
}

export async function saveOpportunityAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'id') || null
  await run('/marketing/opportunities', id ? 'Saved.' : 'Added to the list.', async () => {
    await saveOpportunity(id, { platform: str(f, 'platform'), name: str(f, 'name'), url: str(f, 'url'), audience: str(f, 'audience'), category: str(f, 'category'),
      freePosting: str(f, 'free_posting') || 'unknown', membership: str(f, 'membership_required') || 'unknown', rules: str(f, 'rules'), lastChecked: str(f, 'last_checked'), status: str(f, 'status') || 'new', notes: str(f, 'notes') }, u.id)
  })
}

export async function simulateInboundAction(f: FormData) {
  const u = await requireOwner()
  await run('/settings#connections', 'Test message processed.', async () => {
    const r = await simulateInbound(str(f, 'phone'), str(f, 'name'), str(f, 'text'), u.id, { allowAi: f.get('allow_ai') === 'on' })
    return `/inbox/${r.customerId}`
  })
}
