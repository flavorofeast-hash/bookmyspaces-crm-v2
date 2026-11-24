import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resetDb, closePool, seedSpaces, newCustomer, ist } from './helpers'
import { q, q1 } from '@/lib/db'
import { setRate, ratesFor, isoWeekday } from '@/lib/rates'
import { updateSpace } from '@/lib/setup'
import { createBooking, getBooking, addBookingItem, availability } from '@/lib/bookings'
import { issueStatement } from '@/lib/billing'

let S: Awaited<ReturnType<typeof seedSpaces>>
let c1: string
const owner = { id: '', name: 'Owner Test', email: 'owner-t' }, staff = { id: '', name: 'Asha (staff)', email: 'asha' }
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
const spaceForm = (id: string, name: string, kind: string, o: Record<string, string>) => form({ id, name, kind, active: 'on', price_unit: kind === 'room' ? 'night' : 'slot', ...o })

beforeAll(async () => {
  await resetDb(); S = await seedSpaces(); c1 = await newCustomer('Price Test', '9830000021')
  owner.id = (await q1<{ id: string }>(`INSERT INTO crm.app_users (email, name, role, password_hash) VALUES ('owner-t','Owner Test','owner','x') RETURNING id`))!.id
  staff.id = (await q1<{ id: string }>(`INSERT INTO crm.app_users (email, name, role, password_hash) VALUES ('asha','Asha (staff)','staff','x') RETURNING id`))!.id
  // Room 101: range 700–1500, no standard rate forced (the seed's 2500 is cleared first).
  await updateSpace(spaceForm(S.room101, 'Room 101', 'room', { price: '', min_price: '700', max_price: '1500' }), owner)
  await updateSpace(spaceForm(S.hall, 'Celebration Hall', 'hall', { price: '', min_price: '1500', max_price: '5500' }), owner)
})
afterAll(closePool)

describe('flexible pricing', () => {
  it('a range alone does not make a space bookable, and no maximum is forced as default', async () => {
    const s = await q1<any>(`SELECT price, min_price, max_price FROM crm.spaces WHERE id = $1`, [S.room101])
    expect(s).toMatchObject({ price: null, min_price: '700.00', max_price: '1500.00' })
    const av = await availability(ist('2027-05-03', '14:00'), ist('2027-05-04', '11:00'))
    expect(av.find((x) => x.id === S.room101)!.status).toBe('not_configured')
  })

  it('staff can set rates inside the range; below the minimum or above the maximum is refused', async () => {
    await setRate(staff, S.room101, 'standard', 700)
    await setRate(staff, S.room101, 'standard', 1500)
    await setRate(staff, S.room101, 'standard', 1000)
    await expect(setRate(staff, S.room101, 'standard', 699)).rejects.toThrow(/outside the allowed range/)
    await expect(setRate(staff, S.room101, 'standard', 1501)).rejects.toThrow(/outside the allowed range/)
    await expect(setRate(staff, S.room101, 'weekday', 1600, { weekday: 6 })).rejects.toThrow(/outside the allowed range/)
    await expect(setRate(staff, S.room101, 'date', 650, { onDate: '2027-05-05' })).rejects.toThrow(/outside the allowed range/)
    await expect(setRate(staff, S.room102, 'standard', 2000)).rejects.toThrow(/has not set a minimum and maximum/) // no range yet
    expect(Number((await q1<any>(`SELECT price FROM crm.spaces WHERE id = $1`, [S.room101]))!.price)).toBe(1000)
  })

  it('the database itself refuses out-of-range prices (even bypassing the app)', async () => {
    await expect(q(`UPDATE crm.spaces SET price = 1600 WHERE id = $1`, [S.room101])).rejects.toThrow()
    await expect(q(`INSERT INTO crm.space_rates (space_id, weekday, price) VALUES ($1, 3, 500)`, [S.room101])).rejects.toThrow(/outside the allowed range/)
    await setRate(staff, S.room101, 'weekday', 1400, { weekday: 6 })
    await expect(q(`UPDATE crm.spaces SET max_price = 1300 WHERE id = $1`, [S.room101])).rejects.toThrow(/outside the new range/)
  })

  it('booking totals use date-specific, then weekday, then standard rate, night by night', async () => {
    // 2027-05-07 Fri, 05-08 Sat (weekday rate 1400), 05-09 Sun (date rate 1200 beats nothing), 05-10 Mon standard 1000
    expect(isoWeekday('2027-05-08')).toBe(6)
    await setRate(staff, S.room101, 'date', 1200, { onDate: '2027-05-09' })
    await setRate(staff, S.room101, 'date', 900, { onDate: '2027-05-15' }) // a Saturday: date rate beats the Saturday rate
    const r = await ratesFor(undefined, [{ id: S.room101, price: '1000' }], ['2027-05-08', '2027-05-15'])
    expect(r({ id: S.room101, price: '1000' }, '2027-05-15')).toBe(900)
    const st = { spaceIds: [S.room101], start: ist('2027-05-07', '14:00'), end: ist('2027-05-11', '11:00'), nights: 4 }
    const b = await createBooking({ customerId: c1, bookingType: 'room_stay', rooms: st, start: st.start, end: st.end, confirm: true })
    const full = await getBooking(b.id)
    expect(Number(full.total)).toBe(1000 + 1400 + 1200 + 1000)
    expect(full.items.map((i: any) => [Number(i.qty), Number(i.unit_price)])).toEqual([[1, 1000], [1, 1400], [1, 1200], [1, 1000]])
    // the split lines still hold the room continuously: nobody can book 11:00–14:00 in the middle of the stay
    const gap = { spaceIds: [S.room101], start: ist('2027-05-08', '11:00'), end: ist('2027-05-08', '14:00'), nights: 1 }
    await expect(createBooking({ customerId: c1, bookingType: 'room_stay', rooms: gap, start: gap.start, end: gap.end, confirm: true })).rejects.toThrow(/Double booking/)
  })

  it('hall events use the rate for the event date; manual lines outside the range are refused', async () => {
    await setRate(staff, S.hall, 'standard', 3000)
    await setRate(staff, S.hall, 'weekday', 5500, { weekday: 7 })
    const e = { spaceIds: [S.hall], start: ist('2027-05-16', '16:00'), end: ist('2027-05-16', '23:00'), hours: 0 } // Sunday
    const b = await createBooking({ customerId: c1, bookingType: 'event', event: e, start: e.start, end: e.end })
    expect(Number((await getBooking(b.id)).total)).toBe(5500)
    await expect(addBookingItem(b.id, { lineType: 'space', spaceId: S.hall, description: 'extra slot', qty: 1, unitPrice: 9000, start: ist('2027-05-17', '08:00'), end: ist('2027-05-17', '14:00') })).rejects.toThrow(/outside the allowed range/)
  })

  it('every change is in the audit history with who, what, old and new — and history cannot be edited or deleted', async () => {
    const rows = await q<any>(`SELECT * FROM crm.price_audit WHERE space_id = $1 ORDER BY id`, [S.room101])
    expect(rows[0]).toMatchObject({ user_name: 'Owner Test', user_login: 'owner-t', rate_type: 'range', old_value: null, new_value: '700 – 1500', space: 'Room 101', property: 'Skyline Serenity' })
    expect(rows.find((r) => r.rate_type === 'standard' && r.new_value === '1000')).toMatchObject({ user_name: 'Asha (staff)', user_login: 'asha', old_value: '1500' })
    expect(rows.find((r) => r.rate_type === 'weekday')).toMatchObject({ weekday: 6, old_value: null, new_value: '1400' })
    expect(rows.find((r) => r.rate_type === 'date' && r.new_value === '1200')!.on_date).toBeTruthy()
    expect(rows.every((r) => r.at)).toBe(true)
    expect(rows.some((r) => r.new_value === '699' || r.new_value === '1501')).toBe(false) // refused changes leave no trace
    await expect(q(`UPDATE crm.price_audit SET new_value = '1' WHERE id = $1`, [rows[0].id])).rejects.toThrow(/cannot be changed or deleted/)
    await expect(q(`DELETE FROM crm.price_audit WHERE id = $1`, [rows[0].id])).rejects.toThrow(/cannot be changed or deleted/)
  })

  it('issued quotations keep their original prices after rates change', async () => {
    const e = { spaceIds: [S.hall], start: ist('2027-05-19', '16:00'), end: ist('2027-05-19', '23:00'), hours: 0 } // Wednesday → standard 3000
    const b = await createBooking({ customerId: c1, bookingType: 'event', event: e, start: e.start, end: e.end })
    await issueStatement(b.id, 'quotation')
    const before = await q1<any>(`SELECT amount, content FROM crm.documents WHERE booking_id = $1 AND doc_type = 'quotation'`, [b.id])
    await setRate(staff, S.hall, 'standard', 4500)
    const after = await q1<any>(`SELECT amount, content FROM crm.documents WHERE booking_id = $1 AND doc_type = 'quotation'`, [b.id])
    expect(Number(after.amount)).toBe(3000)
    expect(after).toEqual(before)
    expect(Number((await getBooking(b.id)).total)).toBe(3000) // existing booking lines are not repriced either
  })

  it('a space whose pricing unit is not confirmed cannot be booked', async () => {
    await updateSpace(spaceForm(S.mroom, 'Studio', 'other', { price: '2000', min_price: '1400', max_price: '5000', price_unit: '' }), owner)
    expect((await q1<any>(`SELECT price_unit FROM crm.spaces WHERE id = $1`, [S.mroom]))!.price_unit).toBeNull()
    const av = await availability(ist('2027-05-20', '10:00'), ist('2027-05-20', '12:00'))
    expect(av.find((x) => x.id === S.mroom)!.status).toBe('not_configured')
    const e = { spaceIds: [S.mroom], start: ist('2027-05-20', '10:00'), end: ist('2027-05-20', '12:00'), hours: 2 }
    await expect(createBooking({ customerId: c1, bookingType: 'event', event: e, start: e.start, end: e.end })).rejects.toThrow(/not configured/)
    expect((await q<any>(`SELECT * FROM crm.price_audit WHERE space_id = $1 AND rate_type = 'unit'`, [S.mroom]))[0]).toMatchObject({ old_value: 'night', new_value: null })
  })

  it('per-day spaces (studio) are charged by the number of days, each day at its own rate', async () => {
    await updateSpace(spaceForm(S.mroom, 'Studio', 'other', { price: '2000', min_price: '1400', max_price: '5000', price_unit: 'day' }), owner)
    const audit = await q<any>(`SELECT old_value, new_value FROM crm.price_audit WHERE space_id = $1 AND rate_type = 'unit' ORDER BY id`, [S.mroom])
    expect(audit[audit.length - 1]).toMatchObject({ old_value: null, new_value: 'day' })
    await setRate(staff, S.mroom, 'weekday', 3000, { weekday: 6 }) // Saturdays
    const one = { spaceIds: [S.mroom], start: ist('2027-06-02', '09:00'), end: ist('2027-06-02', '18:00'), hours: 9 } // Wednesday, 1 day
    const b1 = await createBooking({ customerId: c1, bookingType: 'event', event: one, start: one.start, end: one.end })
    expect((await getBooking(b1.id)).items.map((i: any) => [Number(i.qty), Number(i.unit_price)])).toEqual([[1, 2000]])
    const three = { spaceIds: [S.mroom], start: ist('2027-06-04', '09:00'), end: ist('2027-06-06', '18:00'), hours: 57 } // Fri, Sat, Sun = 3 days
    const b3 = await createBooking({ customerId: c1, bookingType: 'event', event: three, start: three.start, end: three.end, confirm: true })
    const full = await getBooking(b3.id)
    expect(full.items.map((i: any) => [Number(i.qty), Number(i.unit_price)])).toEqual([[1, 2000], [1, 3000], [1, 2000]])
    expect(Number(full.total)).toBe(7000)
    // the split lines keep the studio held for the whole period
    const mid = { spaceIds: [S.mroom], start: ist('2027-06-05', '00:00'), end: ist('2027-06-05', '01:00'), hours: 1 }
    await expect(createBooking({ customerId: c1, bookingType: 'event', event: mid, start: mid.start, end: mid.end, confirm: true })).rejects.toThrow(/Double booking/)
    // a manually added per-day line gets its quantity from the dates (2 days), not from the typed quantity
    await addBookingItem(b1.id, { lineType: 'space', spaceId: S.mroom, description: 'Studio extra', qty: 1, unitPrice: 2000, start: ist('2027-06-09', '09:00'), end: ist('2027-06-10', '18:00') })
    const extra = (await getBooking(b1.id)).items.find((i: any) => i.description === 'Studio extra')
    expect(Number(extra.qty)).toBe(2)
  })
})
