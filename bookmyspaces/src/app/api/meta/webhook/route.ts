// Same handler as /api/whatsapp/webhook: routes WhatsApp, Facebook Page and Instagram events by Meta's "object".
export { GET, POST } from '../../whatsapp/webhook/route'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
