import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { conversations } from '@/lib/whatsapp'
import { WaBanner } from '@/components/wa-banner'
import { PageHeader, Card, Flash, Empty } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'
import { formatPhone } from '@/lib/phone'

export default async function InboxPage(props: { searchParams: Promise<{ ok?: string; err?: string; q?: string }> }) {
  await requireUser() // every page checks the session itself; the layout check alone can be skipped by client navigations
  const searchParams = await props.searchParams
  const rows = await conversations(100, searchParams.q ?? '')
  return (
    <>
      <PageHeader title="Inbox" subtitle="WhatsApp, Facebook Messenger and Instagram conversations. New senders become customers and leads automatically." />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      <WaBanner />
      <form className="flex gap-2 mb-3"><input name="q" defaultValue={searchParams.q ?? ''} className="input" placeholder="Search name, phone, message text or promotion code" /><button className="btn-secondary">Search</button></form>
      <Card pad={false}>
        {rows.length === 0 ? <div className="card-pad"><Empty>{searchParams.q ? 'No conversations match your search.' : 'No WhatsApp conversations yet.'}</Empty></div> : (
          <ul className="divide-y divide-slate-100">{rows.map((c) => (
            <li key={c.id}>
              <Link href={`/inbox/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className={`font-medium ${c.unread ? 'text-slate-900' : ''}`}>{c.name}</span><span className="text-xs muted">{formatPhone(c.whatsapp ?? c.phone)}</span>{c.last_channel && c.last_channel !== 'whatsapp' && <span className="rounded-full bg-sky-100 text-sky-800 px-2 text-[11px]">{c.last_channel === 'facebook' ? 'Messenger' : 'Instagram'}</span>}</div>
                  <div className="flex flex-wrap gap-1 my-0.5 text-[11px]">
                    {c.ai_paused && <span className="rounded-full bg-amber-100 text-amber-800 px-2">Needs staff{c.wa_handover_reason ? `: ${c.wa_handover_reason}` : ''}</span>}
                    {c.property_name && <span className="rounded-full bg-slate-100 px-2">{c.property_name}</span>}
                    {c.campaign_code && <span className="rounded-full bg-violet-100 text-violet-800 px-2 font-mono">{c.campaign_code}</span>}
                    {c.booking_ref && <span className="rounded-full bg-sky-100 text-sky-800 px-2">{c.booking_ref}</span>}
                  </div>
                  <div className="text-sm muted truncate">{c.last_direction === 'out' ? (c.last_ai ? 'AI: ' : 'You: ') : ''}{c.last_body ?? `[${c.last_type}]`}{c.last_direction === 'out' && c.last_status === 'failed' ? ' — failed' : ''}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs muted">{fmtDateTime(c.last_at)}</div>
                  {c.unread > 0 && <span className="inline-block mt-1 rounded-full bg-emerald-500 text-white text-xs px-2">{c.unread}</span>}
                </div>
              </Link>
            </li>))}</ul>
        )}
      </Card>
    </>
  )
}
