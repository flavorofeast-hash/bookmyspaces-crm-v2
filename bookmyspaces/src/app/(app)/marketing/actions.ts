'use server'

import { requireUser } from '@/lib/auth'
import { createCampaign, savePost, saveMedia, publishFacebook, publishInstagram, markPostedManually } from '@/lib/marketing'
import { run, str } from '@/lib/action'

export async function createCampaignAction(f: FormData) {
  await requireUser()
  await run('/marketing', 'Campaign created. Use its WhatsApp link in your posts.', async () => {
    await createCampaign({ name: str(f, 'name'), code: str(f, 'code'), channel: str(f, 'channel'), startsOn: str(f, 'starts_on'), endsOn: str(f, 'ends_on'), notes: str(f, 'notes') })
  })
}

export async function savePostAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'id') || null
  await run(id ? `/marketing/posts/${id}` : '/marketing/posts/new', 'Post saved.', async () => {
    const file = f.get('image')
    const mediaId = file instanceof File && file.size > 0 ? await saveMedia(file) : null
    const pid = await savePost(id, { title: str(f, 'title'), caption: String(f.get('caption') ?? ''), platforms: f.getAll('platforms').map(String), plannedFor: str(f, 'planned_for'), campaignId: str(f, 'campaign_id') || null, notes: str(f, 'notes'), mediaId }, u.id)
    return `/marketing/posts/${pid}`
  })
}

export async function publishAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'id'), platform = str(f, 'platform')
  await run(`/marketing/posts/${id}`, platform === 'facebook' ? 'Published on Facebook — confirmed by Meta.' : 'Published on Instagram — confirmed by Meta.', async () => {
    const r = platform === 'facebook' ? await publishFacebook(id, u.id) : await publishInstagram(id, u.id)
    if (!r.ok) throw new Error(`Not published. ${platform === 'facebook' ? 'Facebook' : 'Instagram'} said: ${r.error}`)
  })
}

export async function markManualAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'id')
  await run(`/marketing/posts/${id}`, 'Marked as posted.', async () => { await markPostedManually(id, str(f, 'platform') as any, str(f, 'link') || null, u.id) })
}
