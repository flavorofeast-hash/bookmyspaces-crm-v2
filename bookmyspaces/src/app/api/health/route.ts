import { NextResponse } from 'next/server'
import { setupState } from '@/lib/db'
import { waStatus } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET() {
  let db: string
  try { db = await setupState() } catch (e) { db = 'error: ' + (e as Error).message.slice(0, 80) }
  const wa = waStatus()
  return NextResponse.json({
    status: db === 'ready' ? 'ok' : 'setup-needed', database: db,
    whatsapp: { receive: wa.canReceive, send: wa.canSend },
    facebook: Boolean(process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN),
    instagram: Boolean(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID && process.env.META_PAGE_ACCESS_TOKEN && process.env.APP_PUBLIC_URL),
    time: new Date().toISOString(),
  })
}
