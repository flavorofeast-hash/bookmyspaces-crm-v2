import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resetDb, closePool, seedSpaces, newCustomer, ist } from './helpers'
import { createBooking, setBookingStatus, dashboardCalendar, occupiesDate } from '@/lib/bookings'

let S: Awaited<ReturnType<typeof seedSpaces>>
let a: string, b: string
beforeAll(async () => { await resetDb(); S = await seedSpaces(); a = await newCustomer('Cal A', '9830000011'); b = await newCustomer('Cal B', '9830000012') })
afterAll(closePool)

const ev = (id: string, d: string, s: string, e: string) => ({ event: { spaceIds: [id], start: ist(d, s), end: ist(d, e), hours: 0 }, start: ist(d, s), end: ist(d, e) })
const month = (m: string) => dashboardCalendar(ist(m + '-01', '00:00'), ist(m + '-28', '00:00'))
const datesOf = (e: any, from: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(from + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) }).filter((d) => occupiesDate(e, d))

describe('dashboard calendar', () => {
  it('1-2. confirmed hall and rooftop bookings appear on the correct date, with customer, phone and status', async () => {
    const h = await createBooking({ customerId: a, bookingType: 'event', ...ev(S.hall, '2027-02-10', '16:00', '23:00'), confirm: true })
    const r = await createBooking({ customerId: b, bookingType: 'event', ...ev(S.rooftop, '2027-02-11', '08:00', '14:00'), confirm: true })
    const rows = await month('2027-02')
    const hall = rows.find((x) => x.booking_id === h.id)!, roof = rows.find((x) => x.booking_id === r.id)!
    expect(datesOf(hall, '2027-02-08', 7)).toEqual(['2027-02-10'])
    expect(datesOf(roof, '2027-02-08', 7)).toEqual(['2027-02-11'])
    expect(hall).toMatchObject({ status: 'confirmed', holds: true, customer: 'Cal A', phone: '919830000011', space: 'Celebration Hall', property: 'Skyline Serenity' })
    expect(roof.property).toBe('MonuRama Homestay')
  })

  it('3. a room stay covers check-in up to, not including, check-out', async () => {
    const st = { spaceIds: [S.room101], start: ist('2027-02-14', '14:00'), end: ist('2027-02-17', '11:00'), nights: 3 }
    const bk = await createBooking({ customerId: a, bookingType: 'room_stay', rooms: st, start: st.start, end: st.end, confirm: true })
    const e = (await month('2027-02')).find((x) => x.booking_id === bk.id)!
    expect(datesOf(e, '2027-02-12', 8)).toEqual(['2027-02-14', '2027-02-15', '2027-02-16'])
    // next guest can check in on the check-out day
    const st2 = { spaceIds: [S.room101], start: ist('2027-02-17', '14:00'), end: ist('2027-02-18', '11:00'), nights: 1 }
    await expect(createBooking({ customerId: b, bookingType: 'room_stay', rooms: st2, start: st2.start, end: st2.end, confirm: true })).resolves.toBeTruthy()
  })

  it('4. cancelled bookings disappear from the calendar and stop blocking', async () => {
    const x = await createBooking({ customerId: a, bookingType: 'event', ...ev(S.hall, '2027-02-20', '16:00', '23:00'), confirm: true })
    await expect(createBooking({ customerId: b, bookingType: 'event', ...ev(S.hall, '2027-02-20', '18:00', '22:00'), confirm: true })).rejects.toThrow(/Double booking/)
    await setBookingStatus(x.id, 'cancelled', null, 'calendar test')
    expect((await month('2027-02')).some((r) => r.booking_id === x.id)).toBe(false)
    await expect(createBooking({ customerId: b, bookingType: 'event', ...ev(S.hall, '2027-02-20', '18:00', '22:00'), confirm: true })).resolves.toBeTruthy()
  })

  it('5-6. overlapping hall/rooftop slot refused; non-overlapping slots on the same date allowed', async () => {
    await createBooking({ customerId: a, bookingType: 'event', ...ev(S.rooftop, '2027-02-24', '08:00', '14:00'), confirm: true })
    await expect(createBooking({ customerId: b, bookingType: 'event', ...ev(S.rooftop, '2027-02-24', '13:00', '18:00'), confirm: true })).rejects.toThrow(/Double booking/)
    await expect(createBooking({ customerId: b, bookingType: 'event', ...ev(S.rooftop, '2027-02-24', '16:00', '23:00'), confirm: true })).resolves.toBeTruthy()
    const day = (await month('2027-02')).filter((r) => r.space_id === S.rooftop && occupiesDate(r, '2027-02-24'))
    expect(day.filter((r) => r.holds)).toHaveLength(2)
  })

  it('7. two simultaneous confirmations of the same hall and time: exactly one succeeds', async () => {
    const [x, y] = await Promise.all([a, b].map((c) => createBooking({ customerId: c, bookingType: 'event', ...ev(S.hall, '2027-02-26', '10:00', '15:00') })))
    const res = await Promise.allSettled([setBookingStatus(x.id, 'confirmed'), setBookingStatus(y.id, 'confirmed')])
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const day = (await month('2027-02')).filter((r) => r.space_id === S.hall && occupiesDate(r, '2027-02-26'))
    expect(day.filter((r) => r.holds)).toHaveLength(1)
    expect(day.filter((r) => !r.holds)).toHaveLength(1) // the loser stays visible as an enquiry, not a booking
  })

  it('8. property and resource filters', async () => {
    const all = await month('2027-02')
    const sky = await dashboardCalendar(ist('2027-02-01', '00:00'), ist('2027-02-28', '00:00'), S.p1)
    const monu = await dashboardCalendar(ist('2027-02-01', '00:00'), ist('2027-02-28', '00:00'), S.p2)
    expect(sky.length + monu.length).toBe(all.length)
    expect(sky.every((r) => r.property === 'Skyline Serenity') && monu.every((r) => r.property === 'MonuRama Homestay')).toBe(true)
    const one = await dashboardCalendar(ist('2027-02-01', '00:00'), ist('2027-02-28', '00:00'), null, S.room101)
    expect(one.length).toBeGreaterThan(0)
    expect(one.every((r) => r.space_id === S.room101)).toBe(true)
    expect(await dashboardCalendar(ist('2027-03-01', '00:00'), ist('2027-03-31', '00:00'))).toHaveLength(0) // only the displayed range is loaded
  })
})
