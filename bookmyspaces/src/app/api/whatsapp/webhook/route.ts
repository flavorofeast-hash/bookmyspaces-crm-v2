import { metaEnv } from '@/lib/env'
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { verifySignature, processWebhook, logWebhookError } from '@/lib/whatsapp'
import { isDbConfigured } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30 // AI replies are generated inside the webhook, as on V3

// Meta's one-time verification handshake.
export async function GET(req: Request) {
  const u = new URL(req.url)
  const given = u.searchParams.get('hub.verify_token') ?? ''
  // WhatsApp's token, or the separate one used for Page/Instagram webhooks (META_VERIFY_TOKEN), if set.
  const ok = [metaEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN'), metaEnv('META_VERIFY_TOKEN')].some((token) =>
    !!token && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token)))
  if (u.searchParams.get('hub.mode') === 'subscribe' && ok) return new NextResponse(u.searchParams.get('hub.challenge') ?? '', { status: 200 })
  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: Request) {
  const raw = await req.text()
  // Security: every POST must carry Meta's signature made with our app secret.
  if (!metaEnv('WHATSAPP_APP_SECRET')) return new NextResponse('Webhook not configured', { status: 503 })
  const sig = req.headers.get('x-hub-signature-256')
  const appSigned = verifySignature(raw, sig)
  // "Instagram API with Instagram login" signs with the Instagram app's own secret; accepted for Instagram events only.
  const igSigned = !appSigned && verifySignature(raw, sig, metaEnv('META_IG_LOGIN_APP_SECRET'))
  if (!appSigned && !igSigned) return new NextResponse('Invalid signature', { status: 401 })
  if (!isDbConfigured()) return new NextResponse('Database not configured', { status: 503 })
  let payload: unknown
  try { payload = JSON.parse(raw) } catch { return new NextResponse('Bad request', { status: 400 }) }
  if (igSigned && (payload as any)?.object !== 'instagram') return new NextResponse('Invalid signature', { status: 401 })
  try {
    const r = await processWebhook(payload)
    if (r.errors.length) { console.error('[whatsapp webhook] errors:', r.errors); await logWebhookError(payload, r.errors.join('; ')) }
  } catch (e) {
    // Log and still acknowledge, so Meta does not keep retrying a broken payload forever.
    // The payload is kept in crm.wa_webhook_errors and can be re-run from Settings → Connections.
    console.error('[whatsapp webhook] failed:', e)
    await logWebhookError(payload, (e as Error).message ?? String(e))
  }
  return NextResponse.json({ ok: true })
}
