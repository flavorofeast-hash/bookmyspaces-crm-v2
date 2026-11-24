import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { listOpportunities, OPP_STATUS } from '@/lib/promo'
import { saveOpportunityAction } from '../studio-actions'
import { PageHeader, Card, Flash, Empty, Field, Hidden, Badge, Reveal } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { fmtDate } from '@/lib/format'

const YNU: Record<string, string> = { yes: 'Yes', no: 'No', unknown: 'UNKNOWN — check' }
const STATUS_BADGE: Record<string, string> = { new: 'draft', reviewed: 'quoted', approved: 'confirmed', posted: 'published', rejected: 'cancelled', paid: 'void' }
// Search shortcuts open in the user's own browser; the CRM does not scrape any site.
const SEARCHES: [string, string][] = [
  ['Facebook groups: Kolkata rooms / PG / homestay', 'https://www.facebook.com/search/groups/?q=kolkata%20rooms%20homestay'],
  ['Facebook groups: Kolkata birthday & party venues', 'https://www.facebook.com/search/groups/?q=kolkata%20birthday%20party%20venue'],
  ['Facebook groups: Kolkata weddings & events', 'https://www.facebook.com/search/groups/?q=kolkata%20wedding%20events'],
  ['Facebook groups: Mukundapur / Santoshpur / Garia', 'https://www.facebook.com/search/groups/?q=mukundapur%20santoshpur%20garia'],
  ['Facebook groups: Jadavpur / EM Bypass', 'https://www.facebook.com/search/groups/?q=jadavpur%20EM%20bypass'],
  ['Google: free business listing Kolkata', 'https://www.google.com/search?q=free+business+listing+kolkata+homestay'],
  ['Google: free classified ads Kolkata party hall', 'https://www.google.com/search?q=free+classified+ads+kolkata+party+hall'],
]

function OppForm({ o }: { o?: any }) {
  return (
    <form action={saveOpportunityAction} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {o && <Hidden name="id" value={o.id} />}
      <Field label="Platform"><input name="platform" defaultValue={o?.platform ?? ''} required className="input" placeholder="Facebook group / Directory / Classified" /></Field>
      <Field label="Group or website name"><input name="name" defaultValue={o?.name ?? ''} required className="input" /></Field>
      <Field label="Web address" className="sm:col-span-2"><input name="url" type="url" defaultValue={o?.url ?? ''} required className="input" placeholder="https://" /></Field>
      <Field label="Location / audience"><input name="audience" defaultValue={o?.audience ?? ''} className="input" /></Field>
      <Field label="Category"><input name="category" defaultValue={o?.category ?? ''} className="input" placeholder="rooms, events, directory…" /></Field>
      <Field label="Free posting allowed?"><select name="free_posting" defaultValue={o?.free_posting ?? 'unknown'} className="input"><option value="unknown">Unknown — must check</option><option value="yes">Yes (rules checked)</option><option value="no">No</option></select></Field>
      <Field label="Membership / admin approval needed?"><select name="membership_required" defaultValue={o?.membership_required ?? 'unknown'} className="input"><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
      <Field label="Posting rules (as published by the site/group)" className="sm:col-span-2"><textarea name="rules" defaultValue={o?.rules ?? ''} rows={3} className="input" /></Field>
      <Field label="Last checked"><input name="last_checked" type="date" defaultValue={o?.last_checked ? new Date(o.last_checked).toISOString().slice(0, 10) : ''} className="input" /></Field>
      <Field label="Status"><select name="status" defaultValue={o?.status ?? 'new'} className="input">{OPP_STATUS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></Field>
      <Field label="Notes" className="sm:col-span-2"><input name="notes" defaultValue={o?.notes ?? ''} className="input" /></Field>
      <div><SubmitButton className="btn-secondary">{o ? 'Save' : 'Add'}</SubmitButton></div>
    </form>
  )
}

export default async function OpportunitiesPage(props: { searchParams: Promise<{ ok?: string; err?: string; status?: string }> }) {
  await requireUser()
  const sp = await props.searchParams
  const list = await listOpportunities(sp.status && (OPP_STATUS as readonly string[]).includes(sp.status) ? sp.status : undefined)
  return (
    <>
      <PageHeader title="Free places to post" subtitle={<><Link href="/marketing" className="link">← Marketing</Link> · Legitimate free groups, directories and listing sites. Post by hand and follow each place&apos;s rules.</>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap gap-2 text-sm"><Link href="/marketing/opportunities" className={!sp.status ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>All</Link>{OPP_STATUS.map((s) => <Link key={s} href={`/marketing/opportunities?status=${s}`} className={sp.status === s ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{s}</Link>)}</div>
          {list.length === 0 ? <Card><Empty>Nothing here yet.</Empty></Card> : list.map((o) => (
            <Card key={o.id} title={<span>{o.name} <span className="text-xs muted font-normal">· {o.platform}</span></span>} actions={<Badge value={STATUS_BADGE[o.status]} label={o.status} />}>
              <div className="text-sm space-y-1">
                <div><a href={o.url} target="_blank" rel="noopener noreferrer" className="link break-all">{o.url}</a></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-xs">
                  <div><span className="muted">Audience:</span> {o.audience || '—'}</div><div><span className="muted">Category:</span> {o.category || '—'}</div>
                  <div><span className="muted">Free posting:</span> <b className={o.free_posting === 'unknown' ? 'text-amber-700' : ''}>{YNU[o.free_posting]}</b></div>
                  <div><span className="muted">Membership/approval needed:</span> {YNU[o.membership_required]}</div>
                  <div><span className="muted">Last checked:</span> {o.last_checked ? fmtDate(o.last_checked) : 'never'}</div>
                </div>
                {o.rules && <p className="text-xs whitespace-pre-wrap bg-slate-50 rounded p-2 mt-1">{o.rules}</p>}
                {o.notes && <p className="text-xs muted">{o.notes}</p>}
              </div>
              <div className="mt-2"><Reveal label="Edit / change status"><OppForm o={o} /></Reveal></div>
            </Card>))}
        </div>
        <div className="space-y-4">
          <Card title="Add a place"><OppForm /></Card>
          <Card title="Find more (opens in your browser)">
            <ul className="space-y-1.5 text-sm">{SEARCHES.map(([l, h]) => <li key={h}><a href={h} target="_blank" rel="noopener noreferrer" className="link">{l}</a></li>)}</ul>
            <p className="text-xs muted mt-2">Join groups with your own account, read the group rules, and add the group here. Mark free posting as UNKNOWN until you have read the rules. Never post where promotion is not allowed, and never send bulk messages.</p>
          </Card>
        </div>
      </div>
    </>
  )
}
