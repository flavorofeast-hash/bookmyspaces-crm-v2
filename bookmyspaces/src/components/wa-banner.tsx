import { waStatus } from '@/lib/whatsapp'

export function WaBanner() {
  const s = waStatus()
  if (s.canSend && s.canReceive) return null
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      WhatsApp is not fully connected on this site: {!s.canReceive && 'receiving messages needs WHATSAPP_APP_SECRET and WHATSAPP_WEBHOOK_VERIFY_TOKEN. '}{!s.canSend && 'sending replies needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID. '}
      Until then, conversations already received are shown but replies cannot be sent from here.
    </div>
  )
}

