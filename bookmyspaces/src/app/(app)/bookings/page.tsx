import Link from 'next/link'
import { listBookings, listSpaces, calendarItems } from '@/lib/bookings'
import { PageHeader, Card, Flash, Badge, Empty } from '@/components/ui'
import { inr, fmtDateTime, fmtDay, istDate, addDays, istToDate, STATUS_LABEL, BOOKING_TYPE_LABEL } from '@/lib/format'

type SP = { view?: string; status?: string; q?: string; from?: string; ok?: string; err?: string }

async function Calendar({ from }: { from: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const [spaces, items] = await Promise.all([listSpaces(), calendarItems(istToDate(days[0], '00:00'), istToDate(addDays(days[6], 1), '00:00'))])
  if (!spaces.length) return <Empty>No rooms or spaces yet. <Link className="link" href="/settings#spaces">Add them in Settings</Link>.</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse min-w-[760px] w-full">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white text-left p-2 border-b border-slate-200 w-40">Room / space</th>
            {days.map((d) => <th key={d} className={`p-2 border-b border-slate-200 text-left font-medium ${d === istDate() ? 'text-brand-600' : 'text-slate-600'}`}>{fmtDay(istToDate(d, '12:00'))}</th>)}
          </tr>
        </thead>
        <tbody>
          {spaces.map((s) => (
            <tr key={s.id} className="align-top">
              <td className="sticky left-0 bg-white p-2 border-b border-slate-100"><div className="font-medium">{s.name}</div><div className="muted">{s.property_name}</div></td>
              {days.map((d) => {
                const ds = istToDate(d, '00:00').getTime(), de = istToDate(addDays(d, 1), '00:00').getTime()
                const here = items.filter((i) => i.space_id === s.id && new Date(i.start_at).getTime() < de && new Date(i.end_at).getTime() > ds)
                return (
                  <td key={d} className="p-1 border-b border-l border-slate-100 h-12">
                    {here.map((i) => (
                      <Link key={i.booking_id + i.start_at} href={`/bookings/${i.booking_id}`}
                        className={`block rounded px-1.5 py-1 mb-1 truncate ${i.holds ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-50 text-amber-800 border border-dashed border-amber-300'}`}
                        title={`${i.ref} · ${i.customer} · ${fmtDateTime(i.start_at)} – ${fmtDateTime(i.end_at)}`}>
                        {i.customer}{s.kind !== 'room' ? ` ${new Date(i.start_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric' })}` : ''}
                      </Link>
                    ))}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs muted mt-2"><span className="inline-block w-3 h-3 rounded bg-emerald-100 align-middle mr-1" />Confirmed (blocked) <span className="inline-block w-3 h-3 rounded bg-amber-50 border border-dashed border-amber-300 align-middle ml-3 mr-1" />Enquiry / quoted (not blocked yet)</p>
    </div>
  )
}

export default async function BookingsPage({ searchParams: sp }: { searchParams: SP }) {
  const view = sp.view === 'list' ? 'list' : 'calendar'
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : istDate()
  const rows = view === 'list' ? await listBookings({ status: sp.status, term: sp.q }) : []
  return (
    <>
      <PageHeader title="Bookings" actions={<Link href="/bookings/new" className="btn-primary">+ New booking</Link>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link href="/bookings" className={view === 'calendar' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>Calendar</Link>
        <Link href="/bookings?view=list" className={view === 'list' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>List</Link>
        {view === 'calendar' && (
          <div className="flex items-center gap-1 ml-auto">
            <Link className="btn-secondary btn-sm" href={`/bookings?from=${addDays(from, -7)}`}>← Week</Link>
            <Link className="btn-secondary btn-sm" href="/bookings">Today</Link>
            <Link className="btn-secondary btn-sm" href={`/bookings?from=${addDays(from, 7)}`}>Week →</Link>
            <form className="flex gap-1"><input type="date" name="from" defaultValue={from} className="input !py-1 !text-xs" /><button className="btn-secondary btn-sm">Go</button></form>
          </div>
        )}
      </div>
      {view === 'calendar' ? <Card><Calendar from={from} /></Card> : (
        <>
          <form className="flex flex-wrap gap-2 mb-3">
            <input type="hidden" name="view" value="list" />
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Booking no., customer or mobile" className="input max-w-xs" />
            <select name="status" defaultValue={sp.status ?? ''} className="input max-w-[11rem]">
              <option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="btn-secondary">Filter</button>
          </form>
          <Card pad={false}>
            {rows.length === 0 ? <div className="card-pad"><Empty>No bookings found.</Empty></div> : (
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Booking</th><th>Customer</th><th>When</th><th className="hidden md:table-cell">Rooms / spaces</th><th>Status</th><th>Total</th><th>Balance</th></tr></thead>
                <tbody>{rows.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/bookings/${b.id}`} className="link font-medium">{b.ref}</Link><div className="text-xs muted">{BOOKING_TYPE_LABEL[b.booking_type]}{b.event_type ? ` · ${b.event_type}` : ''}</div></td>
                    <td>{b.customer_name}</td>
                    <td className="text-xs whitespace-nowrap">{fmtDateTime(b.start_at)}<br />{fmtDateTime(b.end_at)}</td>
                    <td className="hidden md:table-cell text-xs">{b.spaces ?? '—'}</td>
                    <td><Badge value={b.status} label={STATUS_LABEL[b.status]} /></td>
                    <td>{inr(b.total)}</td>
                    <td className={Number(b.balance) > 0 && ['confirmed', 'completed'].includes(b.status) ? 'text-amber-700 font-medium' : ''}>{inr(b.balance)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>
        </>
      )}
    </>
  )
}
