import { getCurrentUser } from '@/lib/auth'
import { q1 } from '@/lib/db'
import { fetchMedia } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Shows a customer's WhatsApp photo/document to signed-in staff. Files are fetched from Meta on demand (never public).
export async function GET(_req: Request, props: { params: Promise<{ messageId: string }> }) {
  if (!(await getCurrentUser())) return new Response('Sign in first', { status: 401 })
  const { messageId } = await props.params
  if (!/^[0-9a-f-]{36}$/.test(messageId)) return new Response('Not found', { status: 404 })
  const m = await q1<{ media_id: string | null; media_filename: string | null }>(`SELECT media_id, media_filename FROM crm.messages WHERE id = $1`, [messageId])
  if (!m?.media_id) return new Response('Not found', { status: 404 })
  try {
    const f = await fetchMedia(m.media_id)
    const name = (m.media_filename ?? 'whatsapp-file').replace(/[^\w.\- ]/g, '_')
    return new Response(f.bytes, { headers: { 'Content-Type': f.mime, 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, max-age=600' } })
  } catch (e) {
    return new Response(`Could not load the file from WhatsApp: ${(e as Error).message}`, { status: 502 })
  }
}
