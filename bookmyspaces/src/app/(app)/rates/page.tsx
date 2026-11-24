import { requireUser } from '@/lib/auth'
import { q } from '@/lib/db'
import { priceHistory, WEEKDAY_NAMES } from '@/lib/rates'
import { saveWeekRatesAction, saveDateRateAction, removeDateRateAction } from './actions'
import { PageHeader, Card, Flash, Hidden, Empty } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { inr, fmtDate, fmtDateTime, istDate } from '@/lib/format'

const UNIT: Record<string, string> = { night: 'per night', slot: 'per slot / event', day: 'per day', hour: 'per hour', person: 'per guest', session: 'per session' }
const TYPE = (r: any) => r.rate_type === 'weekday' ? `${WEEKDAY_NAMES[r.weekday]} rate` : r.rate_type === 'date' ? `Rate for ${fmtDate(r.on_date)}` : r.rate_type === 'range' ? 'Allowed range' : r.rate_type === 'unit' ? 'Pricing unit' : 'Standard rate'
const val = (v: string | null) => (v === null ? '—' : /^\d+(\.\d+)?$/.test(v) ? inr(v) : v)

export default async function RatesPage(props: { searchParams: Promise<{ ok?: string; err?: string; space?: string }> }) {
  await requireUser()
  const sp = await props.searchParams
  const today = istDate()
  const [spaces, weekly, dated, history] = await Promise.all([
    q<any>(`SELECT s.id, s.name, s.kind, s.price, s.price_unit, s.min_price, s.max_price, p.id AS property_id, p.name AS property
      FROM crm.spaces s JOIN crm.properties p ON p.id = s.property_id WHERE s.active AND p.active ORDER BY p.sort_order, p.name, s.sort_order, s.name`),
    q<any>(`SELECT space_id, weekday, price FROM crm.space_rates WHERE weekday IS NOT NULL`),
    q<any>(`SELECT r.space_id, to_char(r.on_date, 'YYYY-MM-DD') AS on_date, r.price, s.name FROM crm.space_rates r JOIN crm.spaces s ON s.id = r.space_id WHERE r.on_date >= $1::date ORDER BY r.on_date, s.name`, [today]),
    priceHistory(sp.space && /^[0-9a-f-]{36}$/i.test(sp.space) ? sp.space : null),
  ])
  const props_ = Array.from(new Map(spaces.map((s) => [s.property_id, s.property])).entries())
  const wk = (id: string, w: number) => weekly.find((r) => r.space_id === id && r.weekday === w)
  return (
    <>
      <PageHeader title="Rates" subtitle="Set rates within the owner's minimum and maximum. A weekday rate replaces the standard rate on that day; a date rate replaces both. Every change is recorded below." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4">
        {props_.length === 0 && <Empty>No rooms or spaces yet.</Empty>}
        {props_.map(([pid, pname]) => (
          <Card key={pid} title={pname} pad={false}>
            <div className="overflow-x-auto"><table className="table text-sm">
              <thead><tr><th>Room / space</th><th>Allowed range</th><th>Standard</th>{[1, 2, 3, 4, 5, 6, 7].map((w) => <th key={w}>{WEEKDAY_NAMES[w]}</th>)}<th></th></tr></thead>
              <tbody>{spaces.filter((s) => s.property_id === pid).map((s) => {
                const fid = `f-${s.id}`, noRange = s.min_price === null || s.max_price === null
                const inp = (name: string, v: any) => <input form={fid} type="number" name={name} min={s.min_price ?? 0} max={s.max_price ?? undefined} step="1" defaultValue={v === null || v === undefined ? '' : Number(v)} disabled={noRange} className="input !px-1.5 !py-1 w-20" />
                return (
                  <tr key={s.id} id={`s-${s.id}`}>
                    <td className="font-medium whitespace-nowrap">{s.name}<div className="text-xs muted font-normal">{s.price_unit ? UNIT[s.price_unit] : <span className="text-amber-700">unit NOT CONFIRMED</span>}</div></td>
                    <td className="text-xs whitespace-nowrap">{noRange ? <span className="text-amber-700">NOT CONFIGURED</span> : `${inr(s.min_price)} – ${inr(s.max_price)}`}</td>
                    <td>{inp('standard', s.price)}</td>
                    {[1, 2, 3, 4, 5, 6, 7].map((w) => <td key={w}>{inp(`w${w}`, wk(s.id, w)?.price)}</td>)}
                    <td><form id={fid} action={saveWeekRatesAction}><Hidden name="space_id" value={s.id} />{noRange ? <span className="text-xs muted whitespace-nowrap">owner sets range first</span> : <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>}</form></td>
                  </tr>)
              })}</tbody>
            </table></div>
          </Card>
        ))}

        <Card title="Date-specific rates">
          <div id="dates" className="space-y-3 text-sm">
            <form action={saveDateRateAction} className="flex flex-wrap gap-2 items-end">
              <label className="block"><span className="label">Room / space</span><select name="space_id" required className="input">{props_.map(([pid, pname]) => <optgroup key={pid} label={pname}>{spaces.filter((s) => s.property_id === pid && s.min_price !== null && s.max_price !== null).map((s) => <option key={s.id} value={s.id}>{s.name} ({inr(s.min_price)}–{inr(s.max_price)})</option>)}</optgroup>)}</select></label>
              <label className="block"><span className="label">Date</span><input type="date" name="on_date" required min={today} className="input" /></label>
              <label className="block"><span className="label">Rate (₹)</span><input type="number" name="price" required min={0} step="1" className="input w-28" /></label>
              <SubmitButton className="btn-primary">Save date rate</SubmitButton>
            </form>
            {dated.length === 0 ? <p className="muted">No date-specific rates from today on.</p> : (
              <ul className="divide-y divide-slate-100">{dated.map((d) => (
                <li key={d.space_id + d.on_date} className="py-1.5 flex items-center gap-3">
                  <span className="w-28">{fmtDate(d.on_date)}</span><span className="flex-1">{d.name}</span><b>{inr(d.price)}</b>
                  <form action={removeDateRateAction}><Hidden name="space_id" value={d.space_id} /><Hidden name="on_date" value={d.on_date} /><SubmitButton className="btn-secondary btn-sm">Remove</SubmitButton></form>
                </li>))}</ul>
            )}
          </div>
        </Card>

        <Card title={`Price history (latest ${history.length})`} pad={false}>
          {history.length === 0 ? <div className="card-pad"><Empty>No price changes yet.</Empty></div> : (
            <div className="overflow-x-auto"><table className="table text-xs">
              <thead><tr><th>When</th><th>Changed by</th><th>Property · resource</th><th>What</th><th>Previous</th><th>New</th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}><td className="whitespace-nowrap">{fmtDateTime(h.at)}</td><td>{h.user_name} <span className="muted">({h.user_login})</span></td><td>{h.property} · {h.space}</td><td>{TYPE(h)}</td><td>{val(h.old_value)}</td><td className="font-medium">{val(h.new_value)}</td></tr>))}</tbody>
            </table></div>
          )}
          <p className="card-pad text-xs muted">History is permanent: it cannot be edited or deleted by anyone using the CRM. Issued quotations and bills keep the prices they were issued with.</p>
        </Card>
      </div>
    </>
  )
}
