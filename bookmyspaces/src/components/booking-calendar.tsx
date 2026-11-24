import Link from 'next/link'
import { q } from '@/lib/db'
import { dashboardCalendar, occupiesDate as onDay, type CalendarEntry } from '@/lib/bookings'
import { Badge } from '@/components/ui'
import { istDate, addDays, istToDate, fmtTime, fmtDate, STATUS_LABEL } from '@/lib/format'
import { formatPhone } from '@/lib/phone'

export type CalParams = { cal?: string; cv?: string; cp?: string; cs?: string }
const UUID = /^[0-9a-f-]{36}$/i
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dow = (d: string) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7 // Monday = 0
const monthName = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const chip = (e: CalendarEntry) =>
  e.status === 'completed' ? 'bg-slate-200 text-slate-800' : e.holds ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-50 text-amber-800 border border-dashed border-amber-300'

const when = (e: CalendarEntry) => e.kind === 'room'
  ? `Check-in ${fmtDate(e.start_at)} → check-out ${fmtDate(e.end_at)}`
  : `${fmtDate(e.start_at)} ${fmtTime(e.start_at)}–${istDate(new Date(e.start_at)) === istDate(new Date(e.end_at)) ? '' : fmtDate(e.end_at) + ' '}${fmtTime(e.end_at)}`

export async function BookingCalendar({ sp }: { sp: CalParams }) {
  const today = istDate()
  const view = sp.cv === 'week' ? 'week' : 'month'
  const anchor = sp.cal && /^\d{4}-\d{2}(-\d{2})?$/.test(sp.cal) ? (sp.cal.length === 7 ? sp.cal + '-01' : sp.cal) : today
  const cp = sp.cp && UUID.test(sp.cp) ? sp.cp : null, cs = sp.cs && UUID.test(sp.cs) ? sp.cs : null
  let first: string, days: string[], prev: string, next: string, title: string
  if (view === 'month') {
    const m1 = anchor.slice(0, 7) + '-01'
    const nextM = addDays(m1, 32).slice(0, 7) + '-01', prevM = addDays(m1, -1).slice(0, 7) + '-01'
    first = addDays(m1, -dow(m1))
    const last = addDays(nextM, -1), end = addDays(last, 6 - dow(last))
    days = []; for (let d = first; d <= end; d = addDays(d, 1)) days.push(d)
    prev = prevM.slice(0, 7); next = nextM.slice(0, 7); title = monthName(m1)
  } else {
    first = addDays(anchor, -dow(anchor)); days = Array.from({ length: 7 }, (_, i) => addDays(first, i))
    prev = addDays(first, -7); next = addDays(first, 7); title = `Week of ${fmtDate(istToDate(first, '12:00'))}`
  }
  const month = view === 'month' ? anchor.slice(0, 7) : null
  const [entries, props, spaces] = await Promise.all([
    dashboardCalendar(istToDate(days[0], '00:00'), istToDate(addDays(days[days.length - 1], 1), '00:00'), cp, cs),
    q<{ id: string; name: string }>(`SELECT id, name FROM crm.properties WHERE active ORDER BY sort_order, name`),
    q<{ id: string; name: string; property_id: string; kind: string }>(`SELECT s.id, s.name, s.property_id, s.kind FROM crm.spaces s JOIN crm.properties p ON p.id = s.property_id WHERE s.active AND p.active ORDER BY p.sort_order, s.sort_order, s.kind, s.name`),
  ])
  const link = (o: Partial<CalParams>) => {
    const p = new URLSearchParams()
    const v = { cal: sp.cal, cv: sp.cv, cp: cp ?? undefined, cs: cs ?? undefined, ...o }
    for (const [k, val] of Object.entries(v)) if (val) p.set(k, val)
    return `/today?${p.toString()}#calendar`
  }
  const filteredSpace = spaces.find((s) => s.id === cs)
  const newLink = (d: string) => filteredSpace?.kind === 'room' ? `/bookings/new?type=room_stay&checkin=${d}&checkout=${addDays(d, 1)}` : `/bookings/new?event_date=${d}&checkin=${d}&checkout=${addDays(d, 1)}`
  // One agenda row per booking (a booking can hold several rooms/spaces).
  const agenda = Object.values(entries.reduce<Record<string, CalendarEntry & { spaces: string[] }>>((a, e) => {
    const x = (a[e.booking_id] ??= { ...e, spaces: [] })
    x.spaces.push(e.space); if (e.start_at < x.start_at) x.start_at = e.start_at; if (e.end_at > x.end_at) x.end_at = e.end_at
    return a
  }, {}))

  return (
    <div id="calendar" className="space-y-3 scroll-mt-20">
      <div className="flex flex-wrap items-center gap-2">
        <Link className="btn-secondary btn-sm" href={link({ cal: prev })} aria-label="Previous">←</Link>
        <Link className="btn-secondary btn-sm" href={link({ cal: undefined })}>Today</Link>
        <Link className="btn-secondary btn-sm" href={link({ cal: next })} aria-label="Next">→</Link>
        <span className="font-semibold text-sm mx-1">{title}</span>
        <span className="ml-auto flex gap-1">
          <Link className={view === 'month' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} href={link({ cv: undefined, cal: (month ?? first).slice(0, 7) })}>Month</Link>
          <Link className={view === 'week' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} href={link({ cv: 'week', cal: month ? (today.startsWith(month) ? today : month + '-01') : first })}>Week</Link>
        </span>
      </div>
      <form action="/today" className="flex flex-wrap gap-2 items-center">
        {sp.cal && <input type="hidden" name="cal" value={sp.cal} />}{view === 'week' && <input type="hidden" name="cv" value="week" />}
        <select name="cp" defaultValue={cp ?? ''} className="input !py-1 !text-xs max-w-[11rem]" aria-label="Property">
          <option value="">All properties</option>{props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="cs" defaultValue={cs ?? ''} className="input !py-1 !text-xs max-w-[11rem]" aria-label="Room or space">
          <option value="">All rooms & spaces</option>
          {props.map((p) => <optgroup key={p.id} label={p.name}>{spaces.filter((s) => s.property_id === p.id && (!cp || cp === p.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
        </select>
        <button className="btn-secondary btn-sm">Show</button>
        {(cp || cs) && <Link href={link({ cp: undefined, cs: undefined })} className="link text-xs">Clear filters</Link>}
      </form>

      <div className={view === 'month' ? 'grid grid-cols-7 border-l border-t border-slate-200 text-[11px]' : 'grid grid-cols-1 md:grid-cols-7 border-l border-t border-slate-200 text-xs'}>
        {view === 'month' && WEEKDAYS.map((w) => <div key={w} className="px-1 py-1 border-r border-b border-slate-200 bg-slate-50 font-medium text-slate-600 text-center">{w}</div>)}
        {days.map((d) => {
          const here = entries.filter((e) => onDay(e, d))
          const out = month && !d.startsWith(month)
          return (
            <div key={d} className={`min-w-0 border-r border-b border-slate-200 p-1 ${view === 'month' ? 'min-h-[4.5rem]' : 'min-h-[6rem]'} ${out ? 'bg-slate-50/60 text-slate-400' : ''} ${d === today ? 'ring-2 ring-inset ring-brand-500' : ''}`}>
              <Link href={newLink(d)} className="flex justify-between items-center mb-0.5 hover:text-brand-600" title={`New booking on ${fmtDate(istToDate(d, '12:00'))}`}>
                <span className="font-medium">{view === 'week' ? `${WEEKDAYS[dow(d)]} ${Number(d.slice(8))}` : Number(d.slice(8))}</span><span className="muted">+</span>
              </Link>
              {here.map((e) => (
                <Link key={e.item_id} href={`/bookings/${e.booking_id}`} className={`block rounded px-1 py-0.5 mb-0.5 truncate ${chip(e)}`}
                  title={`${e.ref} · ${STATUS_LABEL[e.status] ?? e.status} · ${e.customer}${e.phone ? ' · ' + formatPhone(e.phone) : ''} · ${e.property ?? ''} ${e.space} · ${when(e)}${e.assigned ? ' · assigned to ' + e.assigned : ''}`}>
                  {!e.holds && e.status !== 'completed' ? '? ' : ''}{e.kind !== 'room' ? fmtTime(e.start_at).replace(/:00| /g, '') + ' ' : ''}{e.space}<span className={view === 'month' ? 'hidden lg:inline' : ''}> · {e.customer}</span>
                </Link>
              ))}
            </div>
          )
        })}
      </div>
      <p className="text-xs muted"><span className="inline-block w-3 h-3 rounded bg-emerald-100 align-middle mr-1" />Confirmed (blocks the space)
        <span className="inline-block w-3 h-3 rounded bg-amber-50 border border-dashed border-amber-300 align-middle ml-3 mr-1" />? Enquiry / quoted (does not block)
        <span className="inline-block w-3 h-3 rounded bg-slate-200 align-middle ml-3 mr-1" />Completed. Cancelled bookings are not shown. Click a date to start a booking — availability is checked on the next page.</p>

      <details className="text-sm" open={view === 'week' || agenda.length <= 12}>
        <summary className="cursor-pointer font-medium">Bookings in this {view} ({agenda.length})</summary>
        {agenda.length === 0 ? <p className="muted mt-2">No bookings in this period{cp || cs ? ' for this filter' : ''}.</p> : (
          <ul className="divide-y divide-slate-100 mt-1">{agenda.map((b) => (
            <li key={b.booking_id} className="py-2 flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
              <Link href={`/bookings/${b.booking_id}`} className="link font-medium">{b.ref}</Link>
              <Badge value={b.status} label={STATUS_LABEL[b.status] ?? b.status} />
              <span className="font-medium">{b.customer}</span>
              {b.phone && <a href={`tel:${b.phone}`} className="link text-xs">{formatPhone(b.phone)}</a>}
              <span className="text-xs muted">{b.property} · {b.spaces.join(', ')}</span>
              <span className="text-xs">{when(b)}</span>
              <span className="text-xs muted">{b.assigned ? `Assigned: ${b.assigned}` : 'Not assigned'}</span>
            </li>))}</ul>
        )}
      </details>
    </div>
  )
}
