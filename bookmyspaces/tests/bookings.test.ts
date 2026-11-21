import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resetDb, closePool, seedSpaces, newCustomer, ist } from './helpers'
import { q, q1 } from '@/lib/db'
import { createBooking, setBookingStatus, availability, addBookingItem, BookingConflictError, getBooking } from '@/lib/bookings'

let S: Awaited<ReturnType<typeof seedSpaces>>
let c1: string, c2: string

beforeAll(async () => {
  await resetDb()
  S = await seedSpaces()
  c1 = await newCustomer('Anita Roy', '9830000001')
  c2 = await newCustomer('Vikram Sen', '9830000002')
})
afterAll(closePool)

const rooms = (ids: string[], inD: string, outD: string) => ({ spaceIds: ids, start: ist(inD, '14:00'), end: ist(outD, '11:00'), nights: Math.round((+new Date(outD) - +new Date(inD)) / 864e5) })
const event = (ids: string[], d: string, s: string, e: string) => ({ spaceIds: ids, start: ist(d, s), end: ist(d, e), hours: 0 })

describe('bookings', () => {
  it('creates a single-room booking priced per night', async () => {
    const r = rooms([S.room101], '2026-12-10', '2026-12-12')
    const b = await createBooking({ customerId: c1, bookingType: 'room_stay', guests: 2, rooms: r, start: r.start, end: r.end, confirm: true })
    expect(b.ref).toMatch(/^BK-\d{4}-0001$/)
    const full = await getBooking(b.id)
    expect(full.status).toBe('confirmed')
    expect(Number(full.total)).toBe(5000) // 2 nights × 2500
  })

  it('creates a multiple-room booking (wedding guest accommodation)', async () => {
    const r = rooms([S.room102, S.room103], '2026-12-10', '2026-12-11')
    const b = await createBooking({ customerId: c2, bookingType: 'room_stay', eventType: 'Wedding guest stay', guests: 4, rooms: r, start: r.start, end: r.end, confirm: true })
    const full = await getBooking(b.id)
    expect(full.items).toHaveLength(2)
    expect(Number(full.total)).toBe(5500)
  })

  it('creates a hall booking with a package and a rooftop booking', async () => {
    const e = event([S.hall], '2026-12-20', '16:00', '23:00')
    const pk = (await q1<{ id: string }>(`INSERT INTO crm.packages (name, price, price_basis) VALUES ('Gold', 650, 'per_person') RETURNING id`))!.id
    const b = await createBooking({ customerId: c1, bookingType: 'event', eventType: 'Haldi', guests: 60, event: e, start: e.start, end: e.end, packageId: pk, confirm: true })
    const full = await getBooking(b.id)
    expect(Number(full.total)).toBe(15000 + 650 * 60)
    const rt = event([S.rooftop], '2026-12-20', '16:00', '23:00')
    const b2 = await createBooking({ customerId: c2, bookingType: 'event', eventType: "Friends' reunion", guests: 40, event: rt, start: rt.start, end: rt.end, confirm: true })
    expect((await getBooking(b2.id)).status).toBe('confirmed') // different space, same time: allowed
  })

  it('creates an event with stay (hall + rooms)', async () => {
    const e = event([S.hall], '2026-12-27', '08:00', '23:00')
    const r = rooms([S.room101, S.room102], '2026-12-26', '2026-12-28')
    const b = await createBooking({ customerId: c2, bookingType: 'event_with_stay', eventType: 'Family gathering', guests: 30, event: e, rooms: r, start: r.start, end: r.end, confirm: true })
    expect((await getBooking(b.id)).items).toHaveLength(3)
  })

  it('shows availability: booked, tentative and free', async () => {
    const e = event([S.hall], '2026-12-20', '18:00', '22:00')
    await createBooking({ customerId: c2, bookingType: 'event', event: event([S.rooftop], '2026-12-21', '16:00', '23:00'), start: ist('2026-12-21', '16:00'), end: ist('2026-12-21', '23:00') }) // enquiry only
    const av = await availability(e.start, e.end)
    expect(av.find((s) => s.id === S.hall)!.status).toBe('booked')
    expect(av.find((s) => s.id === S.room103)!.status).toBe('free')
    const av2 = await availability(ist('2026-12-21', '17:00'), ist('2026-12-21', '20:00'))
    expect(av2.find((s) => s.id === S.rooftop)!.status).toBe('tentative')
  })

  it('refuses to confirm an overlapping booking for the same hall', async () => {
    const e = event([S.hall], '2026-12-20', '18:00', '22:00')
    await expect(createBooking({ customerId: c2, bookingType: 'event', event: e, start: e.start, end: e.end, confirm: true })).rejects.toBeInstanceOf(BookingConflictError)
    const n = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.bookings WHERE start_at = $1`, [e.start])
    expect(n!.n).toBe(0) // whole creation rolled back
  })

  it('allows the overlapping enquiry but refuses confirming it later', async () => {
    const r = rooms([S.room101], '2026-12-11', '2026-12-13')
    const b = await createBooking({ customerId: c2, bookingType: 'room_stay', rooms: r, start: r.start, end: r.end })
    const err = await setBookingStatus(b.id, 'confirmed').catch((e) => e)
    expect(err).toBeInstanceOf(BookingConflictError)
    expect(err.message).toMatch(/Room 101 is already booked by BK-/)
    expect((await getBooking(b.id)).status).toBe('enquiry')
  })

  it('the database itself rejects a conflicting confirmed line inserted directly', async () => {
    const other = (await q1<{ id: string }>(`INSERT INTO crm.bookings (ref, customer_id, booking_type, start_at, end_at, status) VALUES ('RAW-1', $1, 'event', $2, $3, 'confirmed') RETURNING id`,
      [c2, ist('2026-12-20', '17:00'), ist('2026-12-20', '19:00')]))!.id
    await expect(q(`INSERT INTO crm.booking_items (booking_id, line_type, space_id, description, start_at, end_at) VALUES ($1,'space',$2,'raw',$3,$4)`,
      [other, S.hall, ist('2026-12-20', '17:00'), ist('2026-12-20', '19:00')])).rejects.toMatchObject({ code: '23P01' })
  })

  it('allows morning and evening functions in one hall on the same day', async () => {
    const m = event([S.hall], '2027-01-05', '08:00', '14:00'), ev = event([S.hall], '2027-01-05', '16:00', '23:00')
    await createBooking({ customerId: c1, bookingType: 'event', event: m, start: m.start, end: m.end, confirm: true })
    await createBooking({ customerId: c2, bookingType: 'event', event: ev, start: ev.start, end: ev.end, confirm: true })
  })

  it('allows a room check-out and the next check-in on the same day', async () => {
    const r = rooms([S.room101], '2026-12-12', '2026-12-14') // previous guest checks out 12th 11:00, this one checks in 12th 14:00
    await createBooking({ customerId: c2, bookingType: 'room_stay', rooms: r, start: r.start, end: r.end, confirm: true })
  })

  it('cancelling frees the space for someone else', async () => {
    const e = event([S.mroom], '2027-02-01', '14:00', '23:00')
    const a = await createBooking({ customerId: c1, bookingType: 'room_stay', event: e, start: e.start, end: e.end, confirm: true })
    await expect(setBookingStatus(a.id, 'cancelled')).rejects.toThrow(/reason/)
    await setBookingStatus(a.id, 'cancelled', null, 'Customer postponed')
    const b = await createBooking({ customerId: c2, bookingType: 'room_stay', event: e, start: e.start, end: e.end, confirm: true })
    expect((await getBooking(b.id)).status).toBe('confirmed')
  })

  it('adding a conflicting space line to a confirmed booking is refused', async () => {
    const e = event([S.rooftop], '2027-03-01', '16:00', '23:00')
    const a = await createBooking({ customerId: c1, bookingType: 'event', event: e, start: e.start, end: e.end, confirm: true })
    const b = await createBooking({ customerId: c2, bookingType: 'event', event: event([S.hall], '2027-03-01', '16:00', '23:00'), start: e.start, end: e.end, confirm: true })
    await expect(addBookingItem(b.id, { lineType: 'space', spaceId: S.rooftop, description: 'Rooftop add-on', qty: 1, unitPrice: 1000, start: e.start, end: e.end })).rejects.toBeInstanceOf(BookingConflictError)
    await addBookingItem(b.id, { lineType: 'food', description: 'Snacks', qty: 40, unitPrice: 150 })
    expect(Number((await getBooking(b.id)).total)).toBe(15000 + 6000)
    expect(a.id).toBeTruthy()
  })

  it('rejects invalid status jumps', async () => {
    const e = event([S.room103], '2027-04-01', '14:00', '23:00')
    const a = await createBooking({ customerId: c1, bookingType: 'room_stay', event: e, start: e.start, end: e.end })
    await expect(setBookingStatus(a.id, 'completed')).rejects.toThrow(/cannot be changed/)
  })
})
