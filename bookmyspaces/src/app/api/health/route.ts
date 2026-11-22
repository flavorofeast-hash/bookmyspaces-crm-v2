import { metaEnv, appPublicUrl } from '@/lib/env'
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
    facebook: Boolean(metaEnv('META_PAGE_ID') && metaEnv('META_PAGE_ACCESS_TOKEN')),
    instagram: Boolean(metaEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID') && metaEnv('META_PAGE_ACCESS_TOKEN') && appPublicUrl()),
    time: new Date().toISOString(),
  })
}
