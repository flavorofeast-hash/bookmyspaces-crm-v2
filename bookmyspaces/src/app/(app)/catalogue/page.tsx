import { requireUser } from '@/lib/auth'
import { q } from '@/lib/db'
import { REVIEW_LABEL } from '@/lib/catalogue'
import { savePackageAction, saveAddonAction } from './actions'
import { PageHeader, Card, Flash, Field, Hidden, Reveal, Empty } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { inr, fmtDate } from '@/lib/format'

const KIND: Record<string, string> = { event: 'Event package', food: 'Food & catering', dining: 'Dining' }
const CAT: Record<string, string> = { decoration: 'Decoration', music: 'Music / DJ', photography: 'Photography', food: 'Food add-on', guests: 'Extra guests', other: 'Other' }
const tone = (r: string) => (r === 'approved' ? 'text-emerald-700' : r === 'owner_review' ? 'text-amber-700' : 'text-slate-500')
const price = (p: any) => (p.price === null ? <span className="text-amber-700">price NOT CONFIGURED</span> : <>{inr(p.price)} {p.price_basis === 'per_person' ? 'per guest' : 'flat'}</>)
const range = (a: any) => (a.price_min === null ? <span className="text-amber-700">price NOT CONFIGURED</span> : <>{inr(a.price_min)}{Number(a.price_max) !== Number(a.price_min) ? ` – ${inr(a.price_max)}` : ''} {a.unit === 'per_person' ? 'per guest' : ''}</>)

function PackageForm({ p, properties }: { p?: any; properties: any[] }) {
  return (
    <form action={savePackageAction} className="grid sm:grid-cols-4 gap-2 items-end">
      {p && <Hidden name="id" value={p.id} />}
      <Field label="Name"><input name="name" defaultValue={p?.name ?? ''} required className="input" /></Field>
      <Field label="Type"><select name="kind" defaultValue={p?.kind ?? 'food'} className="input">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Property"><select name="property_id" defaultValue={p?.property_id ?? ''} className="input"><option value="">All properties</option>{properties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Food"><select name="food_type" defaultValue={p?.food_type ?? ''} className="input"><option value="">—</option><option value="veg">Vegetarian</option><option value="non_veg">Non-vegetarian</option><option value="both">Veg + non-veg</option></select></Field>
      <Field label="Price (₹)"><input type="number" name="price" min={0} defaultValue={p?.price ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Price is"><select name="price_basis" defaultValue={p?.price_basis ?? 'per_person'} className="input"><option value="per_person">per guest</option><option value="flat">flat (whole package)</option></select></Field>
      <Field label="Minimum guests"><input type="number" name="min_guests" min={0} defaultValue={p?.min_guests ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Maximum guests"><input type="number" name="max_guests" min={0} defaultValue={p?.max_guests ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Duration"><input name="duration" defaultValue={p?.duration ?? ''} placeholder="e.g. 4 hours" className="input" /></Field>
      <Field label="Status"><select name="review_status" defaultValue={p?.review_status ?? 'owner_review'} className="input">{Object.entries(REVIEW_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" name="active" defaultChecked={p?.active ?? false} /> Available for quotations</label>
      <div />
      <Field label="Included items (one per line)" className="sm:col-span-2"><textarea name="inclusions" rows={4} defaultValue={(p?.inclusions ?? []).join('\n')} className="input" /></Field>
      <Field label="Menu / description" className="sm:col-span-2"><textarea name="description" rows={4} defaultValue={p?.description ?? ''} placeholder="Dishes — NOT CONFIGURED" className="input" /></Field>
      <Field label="Optional add-on dishes" className="sm:col-span-2"><input name="add_ons" defaultValue={p?.add_ons ?? ''} className="input" /></Field>
      <Field label="Notes for kitchen" className="sm:col-span-2"><input name="kitchen_notes" defaultValue={p?.kitchen_notes ?? ''} className="input" /></Field>
      <div className="sm:col-span-4"><SubmitButton className="btn-secondary">Save</SubmitButton></div>
    </form>
  )
}

function AddonForm({ a, properties, packages }: { a?: any; properties: any[]; packages: any[] }) {
  return (
    <form action={saveAddonAction} className="grid sm:grid-cols-4 gap-2 items-end">
      {a && <Hidden name="id" value={a.id} />}
      <Field label="Name"><input name="name" defaultValue={a?.name ?? ''} required className="input" /></Field>
      <Field label="Category"><select name="category" defaultValue={a?.category ?? 'decoration'} className="input">{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Lowest price (₹)"><input type="number" name="price_min" min={0} defaultValue={a?.price_min ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Highest price (₹)" hint="Same as lowest for a fixed price"><input type="number" name="price_max" min={0} defaultValue={a?.price_max ?? ''} className="input" /></Field>
      <Field label="Charged"><select name="unit" defaultValue={a?.unit ?? 'fixed'} className="input"><option value="fixed">once</option><option value="per_person">per guest</option></select></Field>
      <Field label="Property"><select name="property_id" defaultValue={a?.property_id ?? ''} className="input"><option value="">All properties</option>{properties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Linked package"><select name="package_id" defaultValue={a?.package_id ?? ''} className="input"><option value="">—</option>{packages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Status"><select name="review_status" defaultValue={a?.review_status ?? 'owner_review'} className="input">{Object.entries(REVIEW_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Description" className="sm:col-span-3"><input name="description" defaultValue={a?.description ?? ''} className="input" /></Field>
      <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" name="active" defaultChecked={a?.active ?? false} /> Available for quotations</label>
      <div className="sm:col-span-4"><SubmitButton className="btn-secondary">Save</SubmitButton></div>
    </form>
  )
}

export default async function CataloguePage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser()
  const sp = await props.searchParams
  const isOwner = user.role === 'owner'
  const [packages, addons, properties, legacy] = await Promise.all([
    q<any>(`SELECT pk.*, p.name AS property, u.name AS updated_by_name FROM crm.packages pk LEFT JOIN crm.properties p ON p.id = pk.property_id LEFT JOIN crm.app_users u ON u.id = pk.updated_by ORDER BY pk.review_status = 'historical', pk.kind, pk.price NULLS LAST, pk.name`),
    q<any>(`SELECT a.*, p.name AS property, pk.name AS package, u.name AS updated_by_name FROM crm.addons a LEFT JOIN crm.properties p ON p.id = a.property_id LEFT JOIN crm.packages pk ON pk.id = a.package_id LEFT JOIN crm.app_users u ON u.id = a.updated_by ORDER BY a.review_status = 'historical', a.category, a.name`),
    q<any>(`SELECT id, name FROM crm.properties WHERE active ORDER BY sort_order, name`),
    q<any>(`SELECT * FROM crm.legacy_records WHERE record_type <> 'package' ORDER BY event_date DESC NULLS LAST, record_type, number`),
  ])
  const group = (k: string) => packages.filter((p) => p.kind === k && p.review_status !== 'historical')
  const pkgCard = (p: any) => (
    <div key={p.id} className="border-b border-slate-100 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b>{p.name}</b>{p.is_popular && <span className="text-xs muted">(historically “most popular”)</span>}
        <span>{price(p)}</span>
        <span className={`text-xs font-medium ${tone(p.review_status)}`}>{REVIEW_LABEL[p.review_status]}</span>
        <span className="text-xs">{p.active ? 'Available' : 'Not available for quotations'}</span>
        <span className="text-xs muted">{[p.property ?? 'All properties', p.min_guests ? `min ${p.min_guests} guests` : null, p.max_guests ? `up to ${p.max_guests} guests` : null, p.duration].filter(Boolean).join(' · ')}</span>
      </div>
      {p.inclusions?.length > 0 && <div className="text-xs mt-1">Includes: {p.inclusions.join(' · ')}</div>}
      <div className="text-xs mt-1">{p.description ?? <span className="text-amber-700">Menu / dishes NOT CONFIGURED</span>}</div>
      {p.source && <div className="text-xs muted mt-1">Source: {p.source}{p.updated_by_name ? ` · last changed by ${p.updated_by_name}` : ''}</div>}
      {isOwner && <div className="mt-2"><Reveal label="Edit"><PackageForm p={p} properties={properties} /></Reveal></div>}
    </div>
  )
  return (
    <>
      <PageHeader title="Packages & Food" subtitle="Event packages, food & catering, decoration and add-ons used in quotations. Only Approved + Available items can be added to a quotation." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4">
        <Card title="Event packages"><div id="packages">{group('event').length ? group('event').map(pkgCard) : <Empty>None yet.</Empty>}</div></Card>
        <Card title="Dining">{group('dining').length ? group('dining').map(pkgCard) : <Empty>None yet.</Empty>}</Card>
        <Card title="Food & catering menus">{group('food').length ? group('food').map(pkgCard) : <Empty>None yet.</Empty>}</Card>
        {isOwner && <Card title="Add a package or menu"><PackageForm properties={properties} /></Card>}

        <Card title="Decoration & add-ons">
          <div id="addons">
            {addons.filter((a) => a.review_status !== 'historical').map((a) => (
              <div key={a.id} className="border-b border-slate-100 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <b>{a.name}</b><span className="text-xs muted">{CAT[a.category]}</span><span>{range(a)}</span>
                  <span className={`text-xs font-medium ${tone(a.review_status)}`}>{REVIEW_LABEL[a.review_status]}</span>
                  <span className="text-xs">{a.active ? 'Available' : 'Not available for quotations'}</span>
                  {a.package && <span className="text-xs muted">linked to {a.package}</span>}
                </div>
                {a.description && <div className="text-xs mt-1">{a.description}</div>}
                {a.source && <div className="text-xs muted mt-1">Source: {a.source}{a.updated_by_name ? ` · last changed by ${a.updated_by_name}` : ''}</div>}
                {isOwner && <div className="mt-2"><Reveal label="Edit"><AddonForm a={a} properties={properties} packages={packages} /></Reveal></div>}
              </div>))}
            {isOwner && <div className="pt-3"><Reveal label="+ Add decoration / add-on"><AddonForm properties={properties} packages={packages} /></Reveal></div>}
          </div>
        </Card>

        <Card title="Historical catalogue (not offered)">
          <p className="text-xs muted mb-2">Found in the old CRM but not confirmed for today. Kept for reference; the owner can change the status to make one usable.</p>
          {[...packages.filter((p) => p.review_status === 'historical').map(pkgCard), ...addons.filter((a) => a.review_status === 'historical').map((a) => (
            <div key={a.id} className="border-b border-slate-100 py-2 text-sm"><b>{a.name}</b> <span className="text-xs muted">{CAT[a.category]}</span> {range(a)} <span className="text-xs muted">· Source: {a.source}</span>
              {isOwner && <div className="mt-1"><Reveal label="Edit"><AddonForm a={a} properties={properties} packages={packages} /></Reveal></div>}</div>))]}
        </Card>

        <Card title={`Old CRM records — archive (${legacy.length})`} pad={false}>
          <p className="card-pad text-xs muted">Proposals, invoices and payments from the old CRM, read-only. They are not bookings or payments in this CRM and are not counted in Billing. “Test?” marks records from known test contacts.</p>
          {legacy.length === 0 ? <div className="card-pad"><Empty>No archived records.</Empty></div> : (
            <div className="overflow-x-auto"><table className="table text-xs">
              <thead><tr><th>Type</th><th>Number</th><th>Customer</th><th>Event date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>{legacy.map((r) => (
                <tr key={r.id} className={r.likely_test ? 'text-slate-400' : ''}><td>{r.record_type}</td><td>{r.number ?? '—'}</td><td>{r.customer_name ?? '—'}{r.phone ? ` · ${r.phone}` : ''}</td><td>{r.event_date ? fmtDate(r.event_date) : '—'}</td><td>{r.amount === null ? '—' : inr(r.amount)}</td><td>{r.status ?? '—'}</td><td>{r.likely_test ? 'Test?' : ''}</td></tr>))}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    </>
  )
}
