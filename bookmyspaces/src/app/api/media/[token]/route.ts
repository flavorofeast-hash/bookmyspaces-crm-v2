import { q1, isDbConfigured } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Serves marketing images by unguessable token (Instagram downloads post images from here).
export async function GET(_req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params
  if (!isDbConfigured() || !/^[A-Za-z0-9_-]{20,40}$/.test(params.token)) return new Response('Not found', { status: 404 })
  const m = await q1<{ mime: string; bytes: Buffer }>(`SELECT mime, bytes FROM crm.media WHERE public_token = $1`, [params.token])
  if (!m) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(m.bytes), { headers: { 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=86400' } })
}
