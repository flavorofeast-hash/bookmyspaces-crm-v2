import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { listLeads, leadCounts, SOURCE_LABEL, LEAD_STATUSES, STATUS_TEXT, type LeadSource } from '@/lib/leads'
import { PageHeader, Card, Flash, Empty, Badge, Stat } from '@/components/ui'
import { fmtDate, fmtDateTime, istDate } from '@/lib/format'
import { formatPhone } from '@/lib/phone'

type SP = { ok?: string; err?: string; view?: string; status?: string; source?: string; q?: string; tests?: string }
const CAT: Record<string, string> = { room: 'Room', hall: 'Hall', rooftop: 'Rooftop', food: 'Food', general: 'General' }

export default async function LeadsPage(props: { searchParams: Promise<SP> }) {
  await requireUser()
  const sp = await props.searchParams
  const today = istDate()
  const view = sp.view === 'all' || sp.view === 'overdue' ? sp.view : 'open'
  const [rows, n] = await Promise.all([listLeads({ view, status: sp.status, source: sp.source, q: sp.q, includeTests: sp.tests === '1' }, today), leadCounts(today)])
  return (
    <>
      <PageHeader title="Leads" subtitle="Every enquiry from WhatsApp, Facebook, Instagram and Meta lead forms, in one list." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="New" value={n?.fresh ?? 0} href="/leads?status=new" tone={n?.fresh ? 'warn' : undefined} />
        <Stat label="Follow-up today" value={n?.due ?? 0} href="/leads" />
        <Stat label="Overdue" value={n?.overdue ?? 0} href="/leads?view=overdue" tone={n?.overdue ? 'warn' : undefined} />
      </div>
      <form className="flex flex-wrap gap-2 mb-3">
        <select name="view" defaultValue={view} className="input w-auto"><option value="open">Open</option><option value="overdue">Overdue follow-ups</option><option value="all">All</option></select>
        <select name="status" defaultValue={sp.status ?? ''} className="input w-auto"><option value="">Any status</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}</select>
        <select name="source" defaultValue={sp.source ?? ''} className="input w-auto"><option value="">Any source</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input name="q" defaultValue={sp.q ?? ''} className="input flex-1 min-w-[10rem]" placeholder="Name, phone, email or message" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="tests" value="1" defaultChecked={sp.tests === '1'} /> show tests</label>
        <button className="btn-secondary">Filter</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? <div className="card-pad"><Empty>No leads match.</Empty></div> : (
          <ul className="divide-y divide-slate-100">{rows.map((l) => (
            <li key={l.id}>
              <Link href={`/leads/${l.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.name || l.customer_name}</span>
                    <span className="rounded-full bg-sky-100 text-sky-800 px-2 text-[11px]">{SOURCE_LABEL[l.source as LeadSource]}</span>
                    <Badge value={l.status === 'converted' ? 'confirmed' : l.status === 'lost' ? 'cancelled' : l.status === 'new' ? 'tentative' : 'enquiry'} label={STATUS_TEXT[l.status]} />
                    {l.is_test && <span className="rounded-full bg-slate-200 px-2 text-[11px]">TEST</span>}
                    {l.property_name && <span className="rounded-full bg-slate-100 px-2 text-[11px]">{l.property_name}</span>}
                    {l.category && <span className="rounded-full bg-slate-100 px-2 text-[11px]">{CAT[l.category]}</span>}
                  </div>
                  <div className="text-xs muted">{[formatPhone(l.any_phone), l.any_email, l.assigned_name && `→ ${l.assigned_name}`, l.campaign_name, l.form_name].filter(Boolean).join(' · ')}</div>
                  {l.message && <div className="muted truncate">{l.message}</div>}
                </div>
                <div className="text-right shrink-0 text-xs">
                  <div className="muted">{fmtDateTime(l.created_at)}</div>
                  {l.next_follow_up && <div className={l.next_follow_up < today && !['converted', 'lost'].includes(l.status) ? 'text-red-600' : 'muted'}>Follow-up {fmtDate(l.next_follow_up)}</div>}
                  {l.booking_ref && <div className="text-sky-700">{l.booking_ref}</div>}
                </div>
              </Link>
            </li>))}</ul>
        )}
      </Card>
    </>
  )
}
