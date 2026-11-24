import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { q } from '@/lib/db'
import { PROMO_TYPES, availableTypes, offerChoices, listPromotions, type PromoType } from '@/lib/promo'
import { createPromotionAction, generateWeekAction } from '../studio-actions'
import { PageHeader, Card, Flash, Empty, Field, Badge } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { fmtDate } from '@/lib/format'

// Fixed-date occasions only. Festivals whose dates change every year (Durga Puja, Diwali, Poila Baisakh…)
// are added as planned promotions by the owner once the date is known.
const OCCASIONS: [string, string][] = [['01-01', 'New Year'], ['02-14', "Valentine's Day"], ['12-25', 'Christmas'], ['12-31', "New Year's Eve"]]

function nextMonday(): string {
  const d = new Date(Date.now() + 5.5 * 3600e3); const add = (8 - d.getUTCDay()) % 7 || 7
  d.setUTCDate(d.getUTCDate() + add); return d.toISOString().slice(0, 10)
}

export default async function StudioPage(props: { searchParams: Promise<{ ok?: string; err?: string; property?: string }> }) {
  await requireUser()
  const sp = await props.searchParams
  const properties = await q<any>(`SELECT p.id, p.name, p.promo_contacts_confirmed, (SELECT count(*)::int FROM crm.media m WHERE m.approved AND m.archived_at IS NULL AND (m.property_id = p.id OR m.property_id IS NULL)) AS photos
    FROM crm.properties p WHERE p.active ORDER BY p.sort_order, p.name`)
  const prop = properties.find((p) => p.id === sp.property) ?? null
  const [types, offers, photos, promos] = await Promise.all([
    prop ? availableTypes(prop.id) : Promise.resolve([] as PromoType[]),
    prop ? offerChoices(prop.id) : Promise.resolve([]),
    prop ? q<any>(`SELECT id, public_token, title, category FROM crm.media WHERE approved AND archived_at IS NULL AND (property_id = $1 OR property_id IS NULL) ORDER BY category, title`, [prop.id]) : Promise.resolve([]),
    listPromotions(),
  ])
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
  const year = today.slice(0, 4)
  const upcoming = OCCASIONS.flatMap(([md, n]) => [`${year}-${md}`, `${Number(year) + 1}-${md}`].map((d) => [d, n] as [string, string])).filter(([d]) => d >= today).sort().slice(0, 3)
  const queue = { draft: promos.filter((p) => p.status === 'draft'), approved: promos.filter((p) => p.status === 'approved'), posted: promos.filter((p) => p.status === 'posted') }
  return (
    <>
      <PageHeader title="Promotion Studio" subtitle={<><Link href="/marketing" className="link">← Marketing</Link> · 1 Choose property → 2 Choose type → 3 Generate → 4 Download / copy → 5 Post → 6 Mark as posted</>}
        actions={<><Link href="/marketing/gallery" className="btn-secondary">Photo gallery</Link><Link href="/marketing/opportunities" className="btn-secondary">Free places to post</Link></>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="1. Choose the property">
            <div className="flex flex-wrap gap-2">{properties.map((p) => (
              <Link key={p.id} href={`/marketing/studio?property=${p.id}`} className={p.id === prop?.id ? 'btn-primary' : 'btn-secondary'}>{p.name} <span className="text-xs opacity-80">({p.photos} photos)</span></Link>))}</div>
          </Card>
          {prop && <Card title={`2. ${prop.name}: what are we promoting?`}>
            {!prop.promo_contacts_confirmed && <p className="text-sm text-amber-700 mb-3">The owner has not yet confirmed this property&apos;s phone numbers for promotions (Settings → Properties). Check them on the preview before posting.</p>}
            {prop.photos === 0 ? <Empty>No approved photos for {prop.name}. The owner approves photos in the <Link href="/marketing/gallery" className="link">gallery</Link>.</Empty> : (
              <form action={createPromotionAction} className="space-y-3">
                <input type="hidden" name="property_id" value={prop.id} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Promotion type"><select name="promo_type" className="input" required>{types.map((t) => <option key={t} value={t}>{PROMO_TYPES[t].label}</option>)}</select></Field>
                  <Field label="Language"><select name="language" className="input" defaultValue="both"><option value="both">English + Bengali</option><option value="en">English</option><option value="bn">Bengali</option></select></Field>
                  <Field label="Offer / price to show" hint={offers.length ? 'Only owner-approved catalogue items and set room rates are listed.' : 'Nothing is approved in the catalogue yet, so the post will say “ask us for current rates”.'}>
                    <select name="offer" className="input"><option value="">No price — “ask us for current rates”</option>{offers.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>
                  <Field label="Occasion (for seasonal/festival only)"><input name="occasion" className="input" placeholder="e.g. Christmas" /></Field>
                  <Field label="Plan for (optional)"><input type="date" name="planned_for" className="input" /></Field>
                </div>
                <details><summary className="text-sm link cursor-pointer">Choose photos yourself (otherwise the best matching, least-used photos are picked)</summary>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2">{photos.map((m) => (
                    <label key={m.id} className="text-[11px] text-center"><img src={`/api/media/${m.public_token}`} alt="" className="w-full h-16 object-cover rounded" /><input type="checkbox" name="media_ids" value={m.id} /> {m.category}</label>))}</div>
                </details>
                <SubmitButton pendingText="Generating…">Generate promotion</SubmitButton>
              </form>)}
            <p className="text-xs muted mt-3">Types shown are only those {prop.name} really has (based on its rooms and spaces). Captions never add prices or facilities that are not in the CRM.</p>
          </Card>}
          <Card title="Publishing queue" pad={false}>
            {promos.length === 0 ? <div className="card-pad"><Empty>No promotions yet.</Empty></div> : (
              (['draft', 'approved', 'posted'] as const).map((k) => queue[k].length > 0 && (
                <div key={k}>
                  <div className="px-4 py-2 text-xs font-semibold muted bg-slate-50 border-y border-slate-100">{k === 'draft' ? 'Waiting for owner approval' : k === 'approved' ? 'Approved — ready to post' : 'Posted'} ({queue[k].length})</div>
                  <ul className="divide-y divide-slate-100">{queue[k].map((p) => (
                    <li key={p.id}><Link href={`/marketing/promotions/${p.id}`} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
                      {p.thumb ? <img src={`/api/media/${p.thumb}`} alt="" className="w-14 h-14 rounded object-cover" /> : <div className="w-14 h-14 rounded bg-slate-100" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.headline}</div>
                        <div className="text-xs muted">{p.property_name} · {PROMO_TYPES[p.promo_type as PromoType]?.label ?? p.promo_type} · {p.language === 'both' ? 'EN + বাংলা' : p.language === 'bn' ? 'বাংলা' : 'EN'} · <span className="font-mono">{p.code}</span></div>
                      </div>
                      <div className="text-right text-xs muted whitespace-nowrap">{p.planned_for ? fmtDate(p.planned_for) : ''}<div><Badge value={p.status === 'approved' ? 'confirmed' : p.status === 'posted' ? 'published' : 'draft'} label={p.status === 'posted' ? `posted ×${p.posts}` : p.status} /></div></div>
                    </Link></li>))}</ul>
                </div>)))}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Plan a whole week">
            <form action={generateWeekAction} className="space-y-2">
              <Field label="Week starting"><input type="date" name="start_on" defaultValue={nextMonday()} className="input" required /></Field>
              <p className="text-xs muted">Creates 7 draft promotions (one per day), rotating properties and types and using the least-used photos so posts don&apos;t repeat. Nothing is posted automatically — the owner approves each one.</p>
              <SubmitButton className="btn-secondary" pendingText="Generating 7 promotions…">Generate week</SubmitButton>
            </form>
          </Card>
          <Card title="Marketing calendar">
            <ul className="text-sm space-y-1.5">
              {promos.filter((p) => p.planned_for && p.planned_for.slice(0, 10) >= today).slice(0, 10).map((p) => (
                <li key={p.id}><span className="muted">{fmtDate(p.planned_for)}</span> — <Link className="link" href={`/marketing/promotions/${p.id}`}>{p.property_name}: {PROMO_TYPES[p.promo_type as PromoType]?.label}</Link></li>))}
              {upcoming.map(([d, n]) => <li key={d} className="text-amber-800">{fmtDate(d)} — {n} (plan a seasonal promotion)</li>)}
            </ul>
            <p className="text-xs muted mt-2">Durga Puja, Diwali, Poila Baisakh and other festivals change date each year: create a Seasonal promotion with a planned date once the date is confirmed.</p>
            <div className="text-xs muted mt-2">Suggested weekly rhythm: Mon rooms · Tue café/food · Wed hall · Thu private dining · Fri rooftop · Sat celebrations · Sun rooms (repeat customers).</div>
          </Card>
        </div>
      </div>
    </>
  )
}
