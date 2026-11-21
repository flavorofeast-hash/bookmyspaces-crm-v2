import Link from 'next/link'
import { conversations } from '@/lib/whatsapp'
import { WaBanner } from '@/components/wa-banner'
import { PageHeader, Card, Flash, Empty } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'
import { formatPhone } from '@/lib/phone'

export default async function InboxPage({ searchParams }: { searchParams: { ok?: string; err?: string } }) {
  const rows = await conversations()
  return (
    <>
      <PageHeader title="Inbox" subtitle="WhatsApp conversations. New numbers become customers automatically." />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      <WaBanner />
      <Card pad={false}>
        {rows.length === 0 ? <div className="card-pad"><Empty>No WhatsApp conversations yet.</Empty></div> : (
          <ul className="divide-y divide-slate-100">{rows.map((c) => (
            <li key={c.id}>
              <Link href={`/inbox/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className={`font-medium ${c.unread ? 'text-slate-900' : ''}`}>{c.name}</span><span className="text-xs muted">{formatPhone(c.whatsapp ?? c.phone)}</span></div>
                  <div className="text-sm muted truncate">{c.last_direction === 'out' ? 'You: ' : ''}{c.last_body ?? `[${c.last_type}]`}{c.last_direction === 'out' && c.last_status === 'failed' ? ' — failed' : ''}</div>
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
