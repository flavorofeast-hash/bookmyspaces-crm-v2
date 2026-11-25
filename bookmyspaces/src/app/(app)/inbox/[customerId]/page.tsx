import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { thread, markRead, waStatus, windowOpen } from '@/lib/whatsapp'
import { sendReplyAction, sendTemplateAction, sendMediaAction, setAiAction } from '../actions'
import { WaBanner } from '@/components/wa-banner'
import { PageHeader, Card, Flash, Badge, Hidden, Empty } from '@/components/ui'
import { SubmitButton, QuickReplyBox } from '@/components/client'
import { approvedInfoReply } from '@/lib/promo'
import { replyChannel, socialWindow, socialStatus } from '@/lib/social'
import { fmtDateTime } from '@/lib/format'
import { formatPhone, waLink } from '@/lib/phone'

const TYPE_LABEL: Record<string, string> = { image: '📷 Photo', audio: '🎤 Voice note', video: '🎬 Video', document: '📄 Document', location: '📍 Location', sticker: 'Sticker', contacts: '👤 Contact' }

export default async function ThreadPage(props: { params: Promise<{ customerId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser() // every page checks the session itself; the layout check alone can be skipped by client navigations
  const params = await props.params
  const searchParams = await props.searchParams
  const c = await q1<any>(`SELECT c.id, c.name, c.phone, c.whatsapp, c.fb_psid, c.ig_sid, c.ig_username, c.property_id, c.ai_paused, c.wa_handover_reason, p.name AS property_name, cp.code AS campaign_code FROM crm.customers c LEFT JOIN crm.properties p ON p.id = c.property_id LEFT JOIN crm.campaigns cp ON cp.id = c.campaign_id WHERE c.id = $1`, [params.customerId]).catch(() => null)
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
  const channel = await replyChannel(c.id)
  const social = channel === 'facebook' || channel === 'instagram'
  const sWin = social ? await socialWindow(c.id, channel) : null
  const chName = channel === 'facebook' ? 'Messenger' : channel === 'instagram' ? 'Instagram' : 'WhatsApp'
  const number = c.whatsapp ?? c.phone
  return (
    <>
      <PageHeader title={c.name} subtitle={<>{social ? `${chName}${c.ig_username ? ` @${c.ig_username}` : ''}${number ? ' · ' + formatPhone(number) : ''}` : formatPhone(number) || 'No WhatsApp number'}{c.property_name ? ` · Enquiry about ${c.property_name}` : ''}{c.campaign_code ? ` · from promotion ${c.campaign_code}` : ''}</>}
        actions={<>
          <Link href={`/customers/${c.id}`} className="btn-secondary btn-sm">Customer record</Link>
          <Link href={`/bookings/new?customer=${c.id}`} className="btn-primary btn-sm">Convert to booking</Link>
          {booking && <Link href={`/bookings/${booking.id}`} className="btn-secondary btn-sm">{booking.ref}</Link>}
        </>} />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      <WaBanner />
      {c.ai_paused && <div className="mb-3 rounded-lg px-4 py-3 text-sm border bg-amber-50 border-amber-200 text-amber-900">Handed to staff{c.wa_handover_reason ? `: ${c.wa_handover_reason}` : ''}. The AI will not reply until you resume it.</div>}
      <Card>
        {msgs.length === 0 ? <Empty>No messages yet.</Empty> : (
          <ul className="space-y-3 max-h-[60vh] overflow-y-auto">{msgs.map((m) => (
            <li key={m.id} className={m.direction === 'in' ? 'flex' : 'flex justify-end'}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.direction === 'in' ? 'bg-slate-100' : m.status === 'failed' ? 'bg-red-50 border border-red-200' : 'bg-emerald-50'}`}>
                {m.msg_type !== 'text' && <div className="text-xs font-medium mb-0.5">{TYPE_LABEL[m.msg_type] ?? m.msg_type}{m.template_name ? ` ${m.template_name}` : ''}</div>}
                {m.media_id && m.msg_type === 'image' && <a href={`/api/whatsapp/media/${m.id}`} target="_blank" rel="noreferrer"><img src={`/api/whatsapp/media/${m.id}`} alt="WhatsApp photo" className="max-h-64 rounded mb-1" loading="lazy" /></a>}
                {m.media_id && m.msg_type === 'audio' && <audio controls preload="none" src={`/api/whatsapp/media/${m.id}`} className="mb-1 max-w-full" />}
                {m.media_id && ['document', 'video', 'sticker'].includes(m.msg_type) && <a href={`/api/whatsapp/media/${m.id}`} target="_blank" rel="noreferrer" className="link text-xs block mb-1">Open {m.media_filename ?? 'file'}</a>}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                <div className="text-[11px] muted mt-1 flex flex-wrap items-center gap-1.5">{m.channel && m.channel !== 'whatsapp' && <span className="rounded bg-sky-100 text-sky-800 px-1.5">{m.channel === 'facebook' ? 'Messenger' : 'Instagram'}</span>}{fmtDateTime(m.created_at)}{m.direction === 'out' && (m.ai_generated ? <span className="rounded bg-violet-100 text-violet-800 px-1.5">AI reply</span> : m.is_auto_reply ? ' · auto-reply' : m.sent_by_name ? ` · ${m.sent_by_name}` : '')}{m.direction === 'out' && <Badge value={m.status} />}</div>
                {m.status === 'failed' && <div className="text-xs text-red-700 mt-1">Not delivered: {m.error_message}{m.error_code ? ` (code ${m.error_code})` : ''}</div>}
              </div>
            </li>))}</ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <form action={setAiAction}><Hidden name="customer_id" value={c.id} /><Hidden name="pause" value={c.ai_paused ? '0' : '1'} /><SubmitButton className="btn-secondary btn-sm">{c.ai_paused ? 'Let the AI reply again' : 'Pause AI — I will handle this chat'}</SubmitButton></form>
          {!s.canSend && <span className="text-xs muted">Photos and files open once WhatsApp is connected to this CRM.</span>}
        </div>
      </Card>

      {social ? (
        <Card title={`Reply on ${chName}`} className="mt-4">
          {!socialStatus().canSend ? <p className="text-sm">Replies from the CRM open once the Facebook Page token is added in Vercel. Until then, reply from Meta Business Suite — those replies still appear here.</p>
            : sWin?.open ? (
            <form action={sendReplyAction} className="space-y-2">
              <Hidden name="customer_id" value={c.id} /><Hidden name="channel" value={channel} />
              <QuickReplyBox replies={replies} />
              <SubmitButton pendingText="Sending…">Send on {chName}</SubmitButton>
              <p className="text-xs muted">Replies are allowed until 24 hours after the customer’s last message. Promotional messages are never sent from here.</p>
            </form>
          ) : <p className="text-sm">More than 24 hours since the customer last wrote, so {chName} does not allow a reply from the CRM. {number ? 'Use WhatsApp or call the number on the lead.' : 'Wait for the customer to write again.'}</p>}
        </Card>
      ) : s.canSend && number ? (
        <Card title="Reply" className="mt-4">
          {win.open ? (<>
            <form action={sendReplyAction} className="space-y-2">
              <Hidden name="customer_id" value={c.id} />
              <QuickReplyBox replies={replies} />
              <SubmitButton pendingText="Sending…">Send on WhatsApp</SubmitButton>
              <p className="text-xs muted">Free-text replies are allowed until 24 hours after the customer’s last message.</p>
            </form>
            <form action={sendMediaAction} className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2 items-end">
              <Hidden name="customer_id" value={c.id} />
              <input type="file" name="file" accept="image/jpeg,image/png,application/pdf,audio/mpeg,audio/ogg,audio/mp4,video/mp4" required className="text-sm" />
              <input name="caption" className="input flex-1 min-w-[10rem]" placeholder="Caption (optional)" />
              <SubmitButton className="btn-secondary" pendingText="Sending…">Send file</SubmitButton>
            </form>
          </>) : templates.length > 0 ? (
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
