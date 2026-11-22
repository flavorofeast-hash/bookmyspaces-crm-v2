import { metaEnv } from '@/lib/env'
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { verifySignature, processWebhook } from '@/lib/whatsapp'
import { isDbConfigured } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Meta's one-time verification handshake.
export async function GET(req: Request) {
  const u = new URL(req.url)
  const token = metaEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN') ?? ''
  const given = u.searchParams.get('hub.verify_token') ?? ''
  const ok = token.length > 0 && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token))
  if (u.searchParams.get('hub.mode') === 'subscribe' && ok) return new NextResponse(u.searchParams.get('hub.challenge') ?? '', { status: 200 })
  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: Request) {
  const raw = await req.text()
  // Security: every POST must carry Meta's signature made with our app secret.
  if (!metaEnv('WHATSAPP_APP_SECRET')) return new NextResponse('Webhook not configured', { status: 503 })
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) return new NextResponse('Invalid signature', { status: 401 })
  if (!isDbConfigured()) return new NextResponse('Database not configured', { status: 503 })
  let payload: unknown
  try { payload = JSON.parse(raw) } catch { return new NextResponse('Bad request', { status: 400 }) }
  try {
    const r = await processWebhook(payload)
    if (r.errors.length) console.error('[whatsapp webhook] errors:', r.errors)
  } catch (e) {
    // Log and still acknowledge, so Meta does not keep retrying a broken payload forever.
    console.error('[whatsapp webhook] failed:', e)
  }
  return NextResponse.json({ ok: true })
}
