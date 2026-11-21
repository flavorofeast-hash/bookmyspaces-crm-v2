import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { availability, type AvailabilitySpace } from '@/lib/bookings'
import { createBookingAction } from '../actions'
import { PageHeader, Card, Flash, Field, Badge, Hidden } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { istDate, addDays, istToDate, nightsBetween, EVENT_TYPES, fmtDateTime, inr, SOURCE_LABEL } from '@/lib/format'
import { formatPhone } from '@/lib/phone'

type SP = { customer?: string; type?: string; checkin?: string; checkout?: string; event_date?: string; slot?: string; start_time?: string; end_time?: string; ok?: string; err?: string }

function SpaceList({ spaces, name, unit }: { spaces: AvailabilitySpace[]; name: string; unit: string }) {
  if (!spaces.length) return <p className="text-sm muted">No {unit} set up yet. <Link href="/settings#spaces" className="link">Add them in Settings</Link>.</p>
  const byProp = spaces.reduce<Record<string, AvailabilitySpace[]>>((a, s) => ((a[s.property_name] ??= []).push(s), a), {})
  return (
    <div className="space-y-3">
      {Object.entries(byProp).map(([prop, list]) => (
        <div key={prop}>
          <div className="text-xs font-semibold muted mb-1.5">{prop}</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {list.map((s) => (
              <label key={s.id} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${s.status === 'booked' ? 'bg-red-50 border-red-200 opacity-80' : s.status === 'tentative' ? 'border-amber-300' : 'border-slate-200 hover:border-brand-500'}`}>
                <input type="checkbox" name={name} value={s.id} disabled={s.status === 'booked'} className="mt-1" />
                <span className="flex-1">
                  <span className="font-medium">{s.name}</span> <Badge value={s.status} label={s.status === 'free' ? 'Free' : s.status === 'booked' ? 'Booked' : 'Enquiry pending'} />
                  <span className="block text-xs muted">{[s.room_type, s.capacity ? `up to ${s.capacity}` : null, `${inr(s.price)}/${s.price_unit}`].filter(Boolean).join(' · ')}</span>
                  {s.conflicts.map((c) => <span key={c.booking_id + c.start_at} className="block text-xs text-slate-600">{c.ref} · {c.customer} · {fmtDateTime(c.start_at)} – {fmtDateTime(c.end_at)} ({c.status})</span>)}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default async function NewBookingPage({ searchParams: sp }: { searchParams: SP }) {
  const type = (['room_stay', 'event', 'event_with_stay'].includes(sp.type ?? '') ? sp.type : 'event') as string
  const [customer, slots, packages, recent, settings] = await Promise.all([
    sp.customer ? q1<any>(`SELECT id, name, phone FROM crm.customers WHERE id = $1`, [sp.customer]).catch(() => null) : null,
    q<any>(`SELECT id, name, start_time::text AS st, end_time::text AS et FROM crm.event_slots ORDER BY sort_order`),
    q<any>(`SELECT id, name, price, price_basis FROM crm.packages WHERE active ORDER BY name`),
    sp.customer ? [] : q<any>(`SELECT id, name, phone FROM crm.customers ORDER BY updated_at DESC LIMIT 300`),
    q1<any>(`SELECT checkin_time::text AS ci, checkout_time::text AS co FROM crm.business_settings WHERE id = 1`),
  ])
  const today = istDate()
  const checkin = sp.checkin || ''
  const checkout = sp.checkout || (checkin ? addDays(checkin, 1) : '')
  const slot = slots.find((s) => s.id === sp.slot)
  const startTime = sp.start_time || slot?.st?.slice(0, 5) || ''
  const endTime = sp.end_time || slot?.et?.slice(0, 5) || ''
  const needRooms = type !== 'event', needEvent = type !== 'room_stay'
  const roomsReady = needRooms && checkin && checkout && nightsBetween(checkin, checkout) >= 1
  const eventReady = needEvent && sp.event_date && startTime && endTime && endTime > startTime
  const [roomAv, eventAv] = await Promise.all([
    roomsReady ? availability(istToDate(checkin, settings.ci.slice(0, 5)), istToDate(checkout, settings.co.slice(0, 5)), ['room']) : null,
    eventReady ? availability(istToDate(sp.event_date!, startTime), istToDate(sp.event_date!, endTime), ['hall', 'rooftop', 'other']) : null,
  ])
  const ready = (!needRooms || roomsReady) && (!needEvent || eventReady)
  const selfUrl = '/bookings/new?' + new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !['ok', 'err'].includes(k)) as [string, string][]).toString()

  return (
    <>
      <PageHeader title={customer ? `New booking for ${customer.name}` : 'New booking or enquiry'} subtitle="1. Choose type and dates → 2. Check availability → 3. Pick rooms/spaces and save" />
      <Flash ok={sp.ok} err={sp.err} />

      <Card title="1. Type and dates" className="mb-4">
        <form method="get" className="space-y-4">
          {customer && <Hidden name="customer" value={customer.id} />}
          <div className="flex flex-wrap gap-2">
            {[['event', 'Event (hall / rooftop)'], ['room_stay', 'Room stay'], ['event_with_stay', 'Event + rooms']].map(([v, l]) => (
              <label key={v} className={`btn-secondary cursor-pointer ${type === v ? '!border-brand-600 !bg-brand-50 text-brand-700' : ''}`}>
                <input type="radio" name="type" value={v} defaultChecked={type === v} className="mr-1" />{l}
              </label>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-1">Event / function</legend>
              <Field label="Event date"><input type="date" name="event_date" defaultValue={sp.event_date ?? ''} min={today} className="input" /></Field>
              <Field label="Time slot">
                <select name="slot" defaultValue={sp.slot ?? ''} className="input">
                  <option value="">Custom times (below)</option>
                  {slots.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.st.slice(0, 5)}–{s.et.slice(0, 5)})</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start"><input type="time" name="start_time" defaultValue={sp.slot ? '' : sp.start_time ?? ''} className="input" /></Field>
                <Field label="End"><input type="time" name="end_time" defaultValue={sp.slot ? '' : sp.end_time ?? ''} className="input" /></Field>
              </div>
              <p className="text-xs muted">Used for Event and Event + rooms.</p>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-1">Rooms</legend>
              <Field label={`Check-in (from ${settings.ci.slice(0, 5)})`}><input type="date" name="checkin" defaultValue={checkin} min={today} className="input" /></Field>
              <Field label={`Check-out (by ${settings.co.slice(0, 5)})`}><input type="date" name="checkout" defaultValue={sp.checkout ?? ''} className="input" /></Field>
              <p className="text-xs muted">Used for Room stay and Event + rooms.</p>
            </fieldset>
          </div>
          <button className="btn-primary">Check availability</button>
        </form>
      </Card>

      {ready && (
        <form action={createBookingAction} className="space-y-4">
          <Hidden name="back" value={selfUrl} />
          <Hidden name="booking_type" value={type} />
          {needRooms && <><Hidden name="checkin" value={checkin} /><Hidden name="checkout" value={checkout} /></>}
          {needEvent && <><Hidden name="event_date" value={sp.event_date} /><Hidden name="start_time" value={startTime} /><Hidden name="end_time" value={endTime} /></>}

          {eventAv && <Card title={`2a. Halls & rooftop — ${sp.event_date} ${startTime}–${endTime}`}><SpaceList spaces={eventAv} name="event_ids" unit="halls or rooftop spaces" /></Card>}
          {roomAv && <Card title={`2b. Rooms — ${checkin} to ${checkout} (${nightsBetween(checkin, checkout)} night${nightsBetween(checkin, checkout) > 1 ? 's' : ''})`}><SpaceList spaces={roomAv} name="room_ids" unit="rooms" /></Card>}

          <Card title="3. Customer and details">
            <div className="grid sm:grid-cols-2 gap-3">
              {customer ? (
                <div className="sm:col-span-2 text-sm"><Hidden name="customer_id" value={customer.id} />Customer: <b>{customer.name}</b> {formatPhone(customer.phone)} <Link href="/bookings/new" className="link ml-2 text-xs">change</Link></div>
              ) : (
                <>
                  <Field label="Existing customer" className="sm:col-span-2">
                    <select name="customer_id" className="input" defaultValue="">
                      <option value="">— new customer (enter below) —</option>
                      {recent.map((c: any) => <option key={c.id} value={c.id}>{c.name} {formatPhone(c.phone)}</option>)}
                    </select>
                  </Field>
                  <Field label="…or new customer name"><input name="new_name" className="input" /></Field>
                  <Field label="New customer mobile"><input name="new_phone" type="tel" className="input" /></Field>
                  <Field label="How did they find us?"><select name="new_source" className="input" defaultValue="walk_in">{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                </>
              )}
              <Field label="Occasion">
                <select name="event_type" className="input" defaultValue={type === 'room_stay' ? '' : 'Family gathering'}>
                  <option value="">—</option>{EVENT_TYPES.map((e) => <option key={e}>{e}</option>)}
                </select>
              </Field>
              <Field label="Number of guests"><input type="number" name="guests" min={0} className="input" /></Field>
              <Field label="Package (food)">
                <select name="package_id" className="input" defaultValue="">
                  <option value="">— none —</option>
                  {packages.map((p) => <option key={p.id} value={p.id}>{p.name} — {inr(p.price)} {p.price_basis === 'per_person' ? 'per guest' : 'flat'}</option>)}
                </select>
              </Field>
              <Field label="Discount (₹)"><input type="number" name="discount" min={0} step="1" defaultValue={0} className="input" /></Field>
              <Field label="Food & other requirements" className="sm:col-span-2"><textarea name="food_requirements" rows={2} className="input" placeholder="Veg/non-veg, menu, decoration, DJ…" /></Field>
              <Field label="Notes" className="sm:col-span-2"><textarea name="notes" rows={2} className="input" /></Field>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <SubmitButton name="intent" value="enquiry" className="btn-secondary">Save as enquiry</SubmitButton>
              <SubmitButton name="intent" value="quote" className="btn-secondary">Save and issue quotation</SubmitButton>
              <SubmitButton name="intent" value="confirm" className="btn-green">Save and confirm booking</SubmitButton>
            </div>
            <p className="text-xs muted mt-2">Confirming blocks the selected rooms/spaces. If someone else has confirmed them for an overlapping time, the system refuses and shows who.</p>
          </Card>
        </form>
      )}
    </>
  )
}
