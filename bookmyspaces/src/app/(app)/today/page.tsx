import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { todayData } from '@/lib/today'
import { completeFollowUpAction } from '../customers/actions'
import { PageHeader, Card, Flash, Empty, Stat, Hidden, Badge } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { inr, fmtDate, fmtTime, fmtDay, fmtDateTime, SOURCE_LABEL, STATUS_LABEL } from '@/lib/format'
import { formatPhone } from '@/lib/phone'
import { BookingCalendar, type CalParams } from '@/components/booking-calendar'

export default async function TodayPage(props: { searchParams: Promise<{ ok?: string; err?: string } & CalParams> }) {
  await requireUser() // every page checks the session itself; the layout check alone can be skipped by client navigations
  const searchParams = await props.searchParams
  const d = await todayData()
  const free = d.spaces.filter((s) => !s.busy)
  const attention = d.followUps.length + d.newEnquiries.length + d.unread.length + d.dueSoon.length
  const freeBy = (kind: string) => free.filter((s) => (kind === 'room' ? s.kind === 'room' : s.kind !== 'room'))
  return (
    <>
      <PageHeader title="Today" subtitle={fmtDate(new Date())} actions={<><Link href="/customers/new" className="btn-primary">+ New enquiry</Link><Link href="/bookings/new" className="btn-secondary">+ New booking</Link></>} />
      <Flash ok={searchParams.ok} err={searchParams.err} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Needs attention" value={attention} sub="follow-ups, enquiries, chats, balances" tone={attention ? 'warn' : 'good'} />
        <Stat label="Outstanding balances" value={inr(d.money.outstanding)} sub={`${d.money.outstanding_count} booking(s)`} href="/billing" tone={Number(d.money.outstanding) > 0 ? 'warn' : undefined} />
        <Stat label="Booked this month" value={inr(d.money.booked_this_month)} sub={`Upcoming confirmed: ${inr(d.money.upcoming_value)}`} />
        <Stat label="Received this month" value={inr(d.money.received_this_month)} sub={`Advances ${inr(d.money.advances_this_month)} · today ${inr(d.money.received_today)}`} tone="good" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Booking calendar" className="lg:col-span-2"><BookingCalendar sp={searchParams} /></Card>

        <Card title={`Follow-ups due (${d.followUps.length})`}>
          {d.followUps.length === 0 ? <Empty>Nothing due. </Empty> : (
            <ul className="divide-y divide-slate-100">{d.followUps.map((f) => (
              <li key={f.id} className="py-2 flex items-start justify-between gap-2 text-sm">
                <span><Link href={`/customers/${f.customer_id}`} className="link font-medium">{f.customer_name}</Link> — {f.note}
                  <span className={`block text-xs ${f.due_on < d.today ? 'text-red-600' : 'muted'}`}>{f.due_on < d.today ? 'Overdue since ' : 'Due '}{fmtDate(f.due_on)}{f.phone ? ` · ${formatPhone(f.phone)}` : ''}</span></span>
                <form action={completeFollowUpAction}><Hidden name="id" value={f.id} /><Hidden name="back" value="/today" /><SubmitButton className="btn-secondary btn-sm">Done</SubmitButton></form>
              </li>))}</ul>
          )}
        </Card>

        <Card title={`New enquiries — last 7 days (${d.newEnquiries.length})`}>
          {d.newEnquiries.length === 0 ? <Empty>No new enquiries.</Empty> : (
            <ul className="divide-y divide-slate-100">{d.newEnquiries.map((c) => (
              <li key={c.id} className="py-2 text-sm flex items-start justify-between gap-2">
                <span><Link href={`/customers/${c.id}`} className="link font-medium">{c.name}</Link> <span className="text-xs muted">{SOURCE_LABEL[c.source] ?? c.source} · {fmtDateTime(c.created_at)}</span>
                  {c.requirements && <span className="block text-xs muted line-clamp-1">{c.requirements}</span>}</span>
                {c.booking_id ? <Link href={`/bookings/${c.booking_id}`}><Badge value={c.booking_status} label={STATUS_LABEL[c.booking_status]} /></Link>
                  : <Link href={`/bookings/new?customer=${c.id}`} className="btn-secondary btn-sm">Create booking</Link>}
              </li>))}</ul>
          )}
        </Card>

        {(d.unread.length > 0 || d.dueSoon.length > 0) && (
          <Card title="Waiting on you">
            {d.unread.map((u) => <p key={u.id} className="text-sm py-1"><Link href={`/inbox/${u.id}`} className="link font-medium">{u.name}</Link> sent {u.n} unread WhatsApp message{u.n > 1 ? 's' : ''} <span className="text-xs muted">{fmtDateTime(u.last_at)}</span></p>)}
            {d.dueSoon.map((b) => <p key={b.id} className="text-sm py-1"><Link href={`/bookings/${b.id}`} className="link font-medium">{b.ref}</Link> {b.customer_name} — <span className="text-amber-700">{inr(b.balance)} due</span>, starts {fmtDate(b.start_at)}</p>)}
          </Card>
        )}

        <Card title="Today at the properties">
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs font-semibold muted mb-1">Check-ins ({d.checkIns.length})</div>
              {d.checkIns.length === 0 ? <span className="muted">None</span> : d.checkIns.map((i) => <div key={i.id}><Link href={`/bookings/${i.booking_id}`} className="link">{i.space_name}</Link> · {i.customer_name} · {fmtTime(i.start_at)}</div>)}</div>
            <div><div className="text-xs font-semibold muted mb-1">Check-outs ({d.checkOuts.length})</div>
              {d.checkOuts.length === 0 ? <span className="muted">None</span> : d.checkOuts.map((i) => <div key={i.id}><Link href={`/bookings/${i.booking_id}`} className="link">{i.space_name}</Link> · {i.customer_name} · {fmtTime(i.end_at)}</div>)}</div>
            <div><div className="text-xs font-semibold muted mb-1">Events ({d.eventsToday.length})</div>
              {d.eventsToday.length === 0 ? <span className="muted">None</span> : d.eventsToday.map((i) => <div key={i.id}><Link href={`/bookings/${i.booking_id}`} className="link">{i.space_name}</Link> · {i.customer_name} · {fmtTime(i.start_at)}–{fmtTime(i.end_at)}{i.guests ? ` · ${i.guests} guests` : ''}</div>)}</div>
          </div>
        </Card>

        <Card title={`Available now (${free.length} of ${d.spaces.length})`} actions={<Link href="/bookings" className="link text-sm">Calendar →</Link>}>
          {d.spaces.length === 0 ? <Empty>No rooms or spaces set up. <Link href="/settings#spaces" className="link">Add them in Settings</Link>.</Empty> : (
            <div className="space-y-2 text-sm">
              <div><span className="text-xs font-semibold muted">Rooms free tonight ({freeBy('room').length}): </span>{freeBy('room').map((s) => s.name).join(', ') || 'none'}</div>
              <div><span className="text-xs font-semibold muted">Halls & rooftop free for the rest of today ({freeBy('event').length}): </span>{freeBy('event').map((s) => s.name).join(', ') || 'none'}</div>
            </div>
          )}
        </Card>

        <Card title="Upcoming room bookings — next 7 days">
          {d.upcomingRooms.length === 0 ? <Empty>None.</Empty> : d.upcomingRooms.map((b) => (
            <p key={b.id} className="text-sm py-1"><b>{fmtDay(b.start_at)}</b> <Link href={`/bookings/${b.id}`} className="link">{b.ref}</Link> {b.customer_name} · {b.rooms}{Number(b.balance) > 0 && <span className="text-amber-700"> · {inr(b.balance)} due</span>}</p>))}
        </Card>

        <Card title="Upcoming events — next 7 days">
          {d.upcomingEvents.length === 0 ? <Empty>None.</Empty> : d.upcomingEvents.map((b) => (
            <p key={b.id} className="text-sm py-1"><b>{fmtDay(b.start_at)} {fmtTime(b.start_at)}</b> <Link href={`/bookings/${b.id}`} className="link">{b.ref}</Link> {b.customer_name} · {b.event_type ?? 'Event'}{b.guests ? ` (${b.guests})` : ''} · {b.venues ?? ''}{Number(b.balance) > 0 && <span className="text-amber-700"> · {inr(b.balance)} due</span>}</p>))}
        </Card>

        <Card title="Recent activity" className="lg:col-span-2">
          {d.activity.length === 0 ? <Empty>No activity yet.</Empty> : (
            <ul className="space-y-1 text-sm">{d.activity.map((a) => (
              <li key={a.id}><span className="text-xs muted">{fmtDateTime(a.at)}</span> — {a.action.replace(/_/g, ' ')}{a.customer_name ? <> · <Link href={`/customers/${a.customer_id}`} className="link">{a.customer_name}</Link></> : ''}{a.ref ? <> · <Link href={`/bookings/${a.booking_id}`} className="link">{a.ref}</Link></> : ''}{a.detail ? <span className="muted"> — {a.detail}</span> : ''}</li>))}</ul>
          )}
        </Card>
      </div>
    </>
  )
}
