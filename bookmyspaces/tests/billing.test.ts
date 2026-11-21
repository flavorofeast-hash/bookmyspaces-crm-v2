import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resetDb, closePool, seedSpaces, newCustomer, ist } from './helpers'
import { q, q1 } from '@/lib/db'
import { createBooking, setBookingStatus, getBooking } from '@/lib/bookings'
import { issueStatement, recordPayment, recordRefund, voidPayment, voidDocument } from '@/lib/billing'

let S: Awaited<ReturnType<typeof seedSpaces>>, cust: string, bookingId: string

beforeAll(async () => {
  await resetDb()
  S = await seedSpaces()
  cust = await newCustomer('Meera Ghosh', '9830000010')
  const e = { spaceIds: [S.hall], start: ist('2026-12-20', '16:00'), end: ist('2026-12-20', '23:00'), hours: 0 }
  bookingId = (await createBooking({ customerId: cust, bookingType: 'event', eventType: 'Birthday', guests: 50, event: e, start: e.start, end: e.end })).id
})
afterAll(closePool)

const balance = async (id = bookingId) => Number((await q1<any>(`SELECT balance FROM crm.booking_balances WHERE booking_id = $1`, [id]))!.balance)

describe('billing', () => {
  it('issues a quotation (moves enquiry to quoted)', async () => {
    const d = await issueStatement(bookingId, 'quotation')
    expect(d.number).toMatch(/^QT-\d{4}-0001$/)
    expect((await getBooking(bookingId)).status).toBe('quoted')
  })

  it('a corrected quotation gets a new number and the old one shows VOID', async () => {
    await q(`UPDATE crm.bookings SET discount = 1000 WHERE id = $1`, [bookingId])
    await q(`UPDATE crm.bookings SET total = subtotal - discount WHERE id = $1`, [bookingId])
    const d2 = await issueStatement(bookingId, 'quotation')
    expect(d2.number).toMatch(/-0002$/)
    const docs = await q<any>(`SELECT number, status, void_reason FROM crm.documents WHERE doc_type = 'quotation' ORDER BY number`)
    expect(docs[0]).toMatchObject({ status: 'void', void_reason: `Replaced by ${d2.number}` })
    expect(docs[1].status).toBe('issued')
  })

  it('refuses a bill before confirmation', async () => {
    await expect(issueStatement(bookingId, 'bill')).rejects.toThrow(/Confirm the booking/)
  })

  it('records an advance (confirming the booking) and issues a receipt with the right balance', async () => {
    expect(await balance()).toBe(14000)
    const r = await recordPayment(bookingId, { kind: 'advance', amount: 5000, method: 'upi', reference: 'UPI123', confirmBooking: true })
    expect(r.document.number).toMatch(/^RCP-\d{4}-0001$/)
    expect((await getBooking(bookingId)).status).toBe('confirmed')
    const doc = await q1<any>(`SELECT amount, paid_to_date, balance, content FROM crm.documents WHERE id = $1`, [r.document.id])
    expect(Number(doc.amount)).toBe(5000)
    expect(Number(doc.balance)).toBe(9000)
    expect(doc.content.payment.reference).toBe('UPI123')
    expect(await balance()).toBe(9000)
  })

  it('refuses a payment larger than the balance', async () => {
    await expect(recordPayment(bookingId, { kind: 'balance', amount: 9000.5, method: 'cash' })).rejects.toThrow(/more than the balance/)
  })

  it('issues the final bill showing payments received and balance', async () => {
    const d = await issueStatement(bookingId, 'bill')
    expect(d.number).toMatch(/^BILL-\d{4}-0001$/)
    const doc = await q1<any>(`SELECT amount, paid_to_date, balance, content FROM crm.documents WHERE id = $1`, [d.id])
    expect([Number(doc.amount), Number(doc.paid_to_date), Number(doc.balance)]).toEqual([14000, 5000, 9000])
    expect(doc.content.payments).toHaveLength(1)
    expect(doc.content.tax.enabled).toBe(false)
  })

  it('records the balance payment; balance reaches 0 and everything reconciles', async () => {
    const r = await recordPayment(bookingId, { kind: 'balance', amount: 9000, method: 'cash' })
    expect(await balance()).toBe(0)
    const docs = await q<any>(`SELECT doc_type, amount FROM crm.documents WHERE booking_id = $1 AND status = 'issued' AND doc_type = 'receipt'`, [bookingId])
    const receipts = docs.reduce((s, d) => s + Number(d.amount), 0)
    const b = await getBooking(bookingId)
    expect(receipts).toBe(Number(b.net_paid))
    expect(Number(b.total) - receipts).toBe(Number(b.balance))
    expect(r.document.number).toMatch(/-0002$/)
  })

  it('voiding a payment keeps the receipt number (VOID) and restores the balance; numbers are never reused', async () => {
    const pay = await q1<any>(`SELECT id FROM crm.payments WHERE booking_id = $1 AND kind = 'balance'`, [bookingId])
    await expect(voidPayment(pay.id, '')).rejects.toThrow(/reason/)
    await voidPayment(pay.id, 'Entered twice by mistake')
    const rc = await q1<any>(`SELECT number, status FROM crm.documents WHERE payment_id = $1`, [pay.id])
    expect(rc.status).toBe('void')
    expect(await balance()).toBe(9000)
    const again = await recordPayment(bookingId, { kind: 'balance', amount: 9000, method: 'bank_transfer' })
    expect(again.document.number).toMatch(/-0003$/)
    expect(again.document.number).not.toBe(rc.number)
  })

  it('issued documents and payments cannot be edited or deleted', async () => {
    const d = await q1<any>(`SELECT id FROM crm.documents WHERE doc_type = 'bill'`)
    await expect(q(`UPDATE crm.documents SET amount = 1 WHERE id = $1`, [d.id])).rejects.toThrow(/cannot be changed/)
    await expect(q(`DELETE FROM crm.documents WHERE id = $1`, [d.id])).rejects.toThrow(/cannot be deleted/)
    const p = await q1<any>(`SELECT id FROM crm.payments LIMIT 1`)
    await expect(q(`UPDATE crm.payments SET amount = 1 WHERE id = $1`, [p.id])).rejects.toThrow(/cannot be changed/)
    await expect(q(`DELETE FROM crm.payments WHERE id = $1`, [p.id])).rejects.toThrow(/cannot be deleted/)
    await expect(q(`INSERT INTO crm.documents (doc_type, number, booking_id, customer_id, amount, paid_to_date, balance, content, public_token) VALUES ('bill', (SELECT number FROM crm.documents WHERE doc_type='bill' LIMIT 1), $1, $2, 0,0,0,'{}','dup-token')`, [bookingId, cust]))
      .rejects.toMatchObject({ code: '23505' })
  })

  it('cancellation and refund: refund cannot exceed what was paid; refund note issued', async () => {
    const e = { spaceIds: [S.rooftop], start: ist('2027-01-10', '16:00'), end: ist('2027-01-10', '23:00'), hours: 0 }
    const b = await createBooking({ customerId: cust, bookingType: 'event', guests: 30, event: e, start: e.start, end: e.end, confirm: true })
    await recordPayment(b.id, { kind: 'advance', amount: 4000, method: 'upi' })
    await setBookingStatus(b.id, 'cancelled', null, 'Family emergency')
    await expect(recordPayment(b.id, { kind: 'payment', amount: 100, method: 'cash' })).rejects.toThrow(/cancelled/)
    await expect(recordRefund(b.id, { amount: 4500, method: 'upi', note: 'Cancellation refund' })).rejects.toThrow(/at most/)
    const r = await recordRefund(b.id, { amount: 3000, method: 'upi', note: 'Cancellation refund (1000 retained)' })
    expect(r.document.number).toMatch(/^RFN-\d{4}-0001$/)
    const m = await q1<any>(`SELECT received, refunded, net_paid, balance FROM crm.booking_balances WHERE booking_id = $1`, [b.id])
    expect([Number(m.received), Number(m.refunded), Number(m.net_paid), Number(m.balance)]).toEqual([4000, 3000, 1000, 0])
    const av = await q1<{ holds: boolean }>(`SELECT bool_or(holds) AS holds FROM crm.booking_items WHERE booking_id = $1`, [b.id])
    expect(av!.holds).toBe(false) // space released
  })

  it('a quotation can be voided by the owner with a reason; receipts cannot be voided directly', async () => {
    const qt = await q1<any>(`SELECT id FROM crm.documents WHERE doc_type = 'quotation' AND status = 'issued'`)
    await voidDocument(qt.id, 'Customer chose another package')
    const rc = await q1<any>(`SELECT id FROM crm.documents WHERE doc_type = 'receipt' AND status = 'issued' LIMIT 1`)
    await expect(voidDocument(rc.id, 'x')).rejects.toThrow(/voided by voiding their payment/)
  })

  it('50 simultaneous payments get 50 unique, gap-free receipt numbers', async () => {
    const e = { spaceIds: [S.room101], start: ist('2027-02-01', '14:00'), end: ist('2027-02-11', '11:00'), nights: 10 }
    const b = await createBooking({ customerId: cust, bookingType: 'room_stay', rooms: e, start: e.start, end: e.end, confirm: true })
    const before = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.documents WHERE doc_type = 'receipt'`))!.n
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => recordPayment(b.id, { kind: 'payment', amount: 100, method: 'cash' })))
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[]
    expect(ok).toHaveLength(50)
    const numbers = ok.map((r) => r.value.document.number)
    expect(new Set(numbers).size).toBe(50)
    const seqs = numbers.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b)
    expect(seqs[0]).toBe(before + 1)
    expect(seqs[49]).toBe(before + 50) // no gaps, no duplicates
    expect(await balance(b.id)).toBe(25000 - 5000)
  })
})
