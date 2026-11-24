import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { thread, markRead, waStatus, windowOpen } from '@/lib/whatsapp'
import { sendReplyAction, sendTemplateAction } from '../actions'
import { WaBanner } from '@/components/wa-banner'
import { PageHeader, Card, Flash, Badge, Hidden, Empty } from '@/components/ui'
import { SubmitButton, QuickReplyBox } from '@/components/client'
import { approvedInfoReply } from '@/lib/promo'
import { fmtDateTime } from '@/lib/format'
import { formatPhone, waLink } from '@/lib/phone'

const TYPE_LABEL: Record<string, string> = { image: '📷 Photo', audio: '🎤 Voice note', video: '🎬 Video', document: '📄 Document', location: '📍 Location', sticker: 'Sticker', contacts: '👤 Contact' }

export default async function ThreadPage(props: { params: Promise<{ customerId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser() // every page checks the session itself; the layout check alone can be skipped by client navigations
  const params = await props.params
  const searchParams = await props.searchParams
  const c = await q1<any>(`SELECT c.id, c.name, c.phone, c.whatsapp, c.property_id, p.name AS property_name, cp.code AS campaign_code FROM crm.customers c LEFT JOIN crm.properties p ON p.id = c.property_id LEFT JOIN crm.campaigns cp ON cp.id = c.campaign_id WHERE c.id = $1`, [params.customerId]).catch(() => null)
  if (!c) notFound()
  const [msgs, savedReplies, templates, win, booking, propIds] = await Promise.all([
    thread(c.id), q<any>(`SELECT * FROM crm.quick_replies ORDER BY sort_order`), q<any>(`SELECT * FROM crm.wa_templates ORDER BY name`), windowOpen(c.id),
    q1<any>(`SELECT id, ref, status FROM crm.bookings WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, [c.id]),
    c.property_id ? Promise.resolve([{ id: c.property_id }]) : q<{ id: string }>(`SELECT id FROM crm.properties WHERE active ORDER BY sort_order, name`),
  ])
  // Replies built from approved catalogue items and set rates (staff choose and send; nothing is sent automatically).
  const replies = [...(await Promise.all(propIds.map((p) => approvedInfoReply(p.id)))).filter((r): r is NonNullable<typeof r> => !!r), ...savedReplies]
  await markRead(c.id)
  const s = waStatus()
  const number = c.whatsapp ?? c.phone
  return (
    <>
      <PageHeader title={c.name} subtitle={<>{formatPhone(number) || 'No WhatsApp number'}{c.property_name ? ` · Enquiry about ${c.property_name}` : ''}{c.campaign_code ? ` · from promotion ${c.campaign_code}` : ''}</>}
        actions={<>
          <Link href={`/customers/${c.id}`} className="btn-secondary btn-sm">Customer record</Link>
          <Link href={`/bookings/new?customer=${c.id}`} className="btn-primary btn-sm">Convert to booking</Link>
          {booking && <Link href={`/bookings/${booking.id}`} className="btn-secondary btn-sm">{booking.ref}</Link>}
        </>} />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      <WaBanner />
      <Card>
        {msgs.length === 0 ? <Empty>No messages yet.</Empty> : (
          <ul className="space-y-3 max-h-[60vh] overflow-y-auto">{msgs.map((m) => (
            <li key={m.id} className={m.direction === 'in' ? 'flex' : 'flex justify-end'}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.direction === 'in' ? 'bg-slate-100' : m.status === 'failed' ? 'bg-red-50 border border-red-200' : 'bg-emerald-50'}`}>
                {m.msg_type !== 'text' && <div className="text-xs font-medium mb-0.5">{TYPE_LABEL[m.msg_type] ?? m.msg_type}{m.template_name ? ` ${m.template_name}` : ''}</div>}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                <div className="text-[11px] muted mt-1 flex items-center gap-1.5">{fmtDateTime(m.created_at)}{m.is_auto_reply && ' · auto-reply'}{m.direction === 'out' && <Badge value={m.status} />}</div>
                {m.status === 'failed' && <div className="text-xs text-red-700 mt-1">Not delivered: {m.error_message}{m.error_code ? ` (code ${m.error_code})` : ''}</div>}
              </div>
            </li>))}</ul>
        )}
        {msgs.some((m) => ['image', 'audio', 'video', 'document'].includes(m.msg_type)) && <p className="text-xs muted mt-3">Photos, voice notes and documents are listed here; open WhatsApp on your phone to view the file itself.</p>}
      </Card>

      {s.canSend && number ? (
        <Card title="Reply" className="mt-4">
          {win.open ? (
            <form action={sendReplyAction} className="space-y-2">
              <Hidden name="customer_id" value={c.id} />
              <QuickReplyBox replies={replies} />
              <SubmitButton pendingText="Sending…">Send on WhatsApp</SubmitButton>
              <p className="text-xs muted">Free-text replies are allowed until 24 hours after the customer’s last message.</p>
            </form>
          ) : templates.length > 0 ? (
            <form action={sendTemplateAction} className="space-y-2">
              <Hidden name="customer_id" value={c.id} />
              <p className="text-sm">More than 24 hours since the customer last wrote, so WhatsApp only allows an approved template.</p>
              <select name="template_id" className="input">{templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>)}</select>
              <SubmitButton pendingText="Sending…">Send template</SubmitButton>
            </form>
          ) : (
            <p className="text-sm">More than 24 hours since the customer last wrote. WhatsApp requires an approved template now — add your approved template names in <Link href="/settings#templates" className="link">Settings</Link>{waLink(number) && <>, or <a href={waLink(number)!} target="_blank" rel="noreferrer" className="link">message them from your phone</a></>}.</p>
          )}
        </Card>
      ) : number && waLink(number) ? (
        <p className="text-sm mt-4"><a href={waLink(number)!} target="_blank" rel="noreferrer" className="btn-green">Open WhatsApp on this device</a></p>
      ) : null}
    </>
  )
}
