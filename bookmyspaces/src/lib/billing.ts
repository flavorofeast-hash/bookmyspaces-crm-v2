import { randomBytes } from 'crypto'
import { q, q1, tx, type Db } from './db'
import { logActivity } from './activity'
import { setBookingStatusInTx } from './bookings'

export const DOC_PREFIX: Record<string, string> = { quotation: 'QT', bill: 'BILL', receipt: 'RCP', refund: 'RFN' }
const round2 = (n: number) => Math.round(n * 100) / 100

async function lockBooking(db: Db, bookingId: string) {
  const b = await q1<any>(
    `SELECT b.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, p.name AS property_name
     FROM crm.bookings b JOIN crm.customers c ON c.id = b.customer_id LEFT JOIN crm.properties p ON p.id = b.property_id
     WHERE b.id = $1 FOR UPDATE OF b`, [bookingId], db)
  if (!b) throw new Error('Booking not found.')
  return b
}

async function money(db: Db, bookingId: string) {
  return (await q1<{ total: string; received: string; refunded: string; net_paid: string; balance: string }>(
    `SELECT total, received, refunded, net_paid, balance FROM crm.booking_balances WHERE booking_id = $1`, [bookingId], db))!
}

async function snapshot(db: Db, b: any, extra: Record<string, unknown> = {}) {
  // Sequential on purpose: these run on one transaction's connection.
  const settings = await q1<any>(`SELECT business_name, address, phone, email, whatsapp_number, upi_id, bank_details, document_footer, gst_number FROM crm.business_settings WHERE id = 1`, [], db)
  const lines = await q<any>(`SELECT description, qty, unit_price, amount, tax_rate, start_at, end_at, line_type FROM crm.booking_items WHERE booking_id = $1 ORDER BY sort_order, start_at`, [b.id], db)
  const payments = await q<any>(`SELECT p.id, p.kind, p.amount, p.method, p.reference, p.paid_on, d.number AS document_number
            FROM crm.payments p LEFT JOIN crm.documents d ON d.payment_id = p.id AND d.status = 'issued'
            WHERE p.booking_id = $1 AND p.voided_at IS NULL ORDER BY p.paid_on, p.created_at`, [b.id], db)
  const m = await money(db, b.id)
  return {
    business: settings,
    customer: { name: b.customer_name, phone: b.customer_phone, email: b.customer_email },
    booking: {
      ref: b.ref, booking_type: b.booking_type, event_type: b.event_type, guests: b.guests, start_at: b.start_at, end_at: b.end_at,
      property: b.property_name, food_requirements: b.food_requirements, status: b.status,
    },
    lines, subtotal: b.subtotal, discount: b.discount, total: m.total,
    payments, received: m.received, refunded: m.refunded, net_paid: m.net_paid, balance: m.balance,
    tax: { enabled: false, note: 'GST not applicable' },
    ...extra,
  }
}

async function insertDocument(db: Db, d: { type: string; bookingId: string; customerId: string; paymentId?: string | null; supersedesId?: string | null; amount: number; paid: number; balance: number; content: any; userId?: string | null }) {
  const number = (await q1<{ n: string }>(`SELECT crm.next_number($1, $2) AS n`, [d.type, DOC_PREFIX[d.type]], db))!.n
  const doc = await q1<{ id: string; number: string }>(
    `INSERT INTO crm.documents (doc_type, number, booking_id, customer_id, payment_id, supersedes_id, amount, paid_to_date, balance, content, public_token, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, number`,
    [d.type, number, d.bookingId, d.customerId, d.paymentId ?? null, d.supersedesId ?? null, d.amount, d.paid, d.balance,
      JSON.stringify({ ...d.content, number }), randomBytes(18).toString('base64url'), d.userId ?? null], db)
  return doc!
}

/** Issues a quotation or bill. A previous live one of the same type is voided and linked as superseded. */
export async function issueStatement(bookingId: string, type: 'quotation' | 'bill', userId?: string | null) {
  return tx(async (db) => {
    const b = await lockBooking(db, bookingId)
    if (b.status === 'cancelled') throw new Error('Cancelled bookings cannot be quoted or billed.')
    if (type === 'bill' && !['confirmed', 'completed'].includes(b.status)) throw new Error('Confirm the booking before issuing the final bill.')
    const items = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.booking_items WHERE booking_id = $1`, [bookingId], db)
    if (!items?.n) throw new Error('Add at least one room, space or item before issuing a document.')
    const prev = await q1<{ id: string; number: string }>(`SELECT id, number FROM crm.documents WHERE booking_id = $1 AND doc_type = $2 AND status = 'issued' ORDER BY issued_at DESC LIMIT 1`, [bookingId, type], db)
    const content = await snapshot(db, b, { kind: type })
    const m = await money(db, bookingId)
    const doc = await insertDocument(db, { type, bookingId, customerId: b.customer_id, supersedesId: prev?.id, amount: Number(m.total), paid: Number(m.net_paid), balance: Number(m.balance), content, userId })
    if (prev) await q(`UPDATE crm.documents SET status = 'void', voided_at = now(), void_reason = $2 WHERE id = $1`, [prev.id, `Replaced by ${doc.number}`], db)
    if (type === 'quotation' && b.status === 'enquiry') await q(`UPDATE crm.bookings SET status = 'quoted', updated_at = now() WHERE id = $1`, [bookingId], db)
    await logActivity({ userId, customerId: b.customer_id, bookingId, action: `${type}_issued`, detail: doc.number }, db)
    return doc
  })
}

export type PaymentInput = { kind: 'advance' | 'balance' | 'payment'; amount: number; method: string; reference?: string | null; paidOn?: string | null; note?: string | null; confirmBooking?: boolean }

/** Records money received and issues its receipt in the same transaction. */
export async function recordPayment(bookingId: string, p: PaymentInput, userId?: string | null) {
  return tx(async (db) => {
    const b = await lockBooking(db, bookingId)
    if (b.status === 'cancelled') throw new Error('This booking is cancelled. Record a refund instead.')
    const amount = round2(Number(p.amount))
    if (!(amount > 0)) throw new Error('Enter an amount greater than 0.')
    const before = await money(db, bookingId)
    if (amount > Number(before.balance) + 0.001) throw new Error(`This is more than the balance due (₹${Number(before.balance).toLocaleString('en-IN')}).`)
    if (p.confirmBooking && ['enquiry', 'quoted'].includes(b.status)) {
      // confirm first so a double booking is refused before any money is recorded
      await setBookingStatusInTx(db, bookingId, 'confirmed', userId)
      b.status = 'confirmed'
    }
    const pay = await q1<{ id: string }>(
      `INSERT INTO crm.payments (booking_id, customer_id, kind, amount, method, reference, paid_on, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, (now() AT TIME ZONE 'Asia/Kolkata')::date),$8,$9) RETURNING id`,
      [bookingId, b.customer_id, p.kind, amount, p.method, p.reference || null, p.paidOn || null, p.note || null, userId ?? null], db)
    const after = await money(db, bookingId)
    const content = await snapshot(db, b, { kind: 'receipt', payment: { kind: p.kind, amount, method: p.method, reference: p.reference || null, paid_on: p.paidOn || null } })
    const doc = await insertDocument(db, { type: 'receipt', bookingId, customerId: b.customer_id, paymentId: pay!.id, amount, paid: Number(after.net_paid), balance: Number(after.balance), content, userId })
    await logActivity({ userId, customerId: b.customer_id, bookingId, action: 'payment_received', detail: `${b.ref}: ₹${amount} ${p.kind} — ${doc.number}` }, db)
    return { paymentId: pay!.id, document: doc }
  })
}

export async function recordRefund(bookingId: string, r: { amount: number; method: string; reference?: string | null; paidOn?: string | null; note: string }, userId?: string | null) {
  return tx(async (db) => {
    const b = await lockBooking(db, bookingId)
    const amount = round2(Number(r.amount))
    if (!(amount > 0)) throw new Error('Enter a refund amount greater than 0.')
    if (!r.note?.trim()) throw new Error('Write the reason for the refund.')
    const before = await money(db, bookingId)
    if (amount > Number(before.net_paid) + 0.001) throw new Error(`You can refund at most what was paid (₹${Number(before.net_paid).toLocaleString('en-IN')}).`)
    const pay = await q1<{ id: string }>(
      `INSERT INTO crm.payments (booking_id, customer_id, kind, amount, method, reference, paid_on, note, created_by)
       VALUES ($1,$2,'refund',$3,$4,$5,COALESCE($6::date, (now() AT TIME ZONE 'Asia/Kolkata')::date),$7,$8) RETURNING id`,
      [bookingId, b.customer_id, amount, r.method, r.reference || null, r.paidOn || null, r.note.trim(), userId ?? null], db)
    const after = await money(db, bookingId)
    const content = await snapshot(db, b, { kind: 'refund', payment: { kind: 'refund', amount, method: r.method, reference: r.reference || null, reason: r.note.trim() } })
    const doc = await insertDocument(db, { type: 'refund', bookingId, customerId: b.customer_id, paymentId: pay!.id, amount, paid: Number(after.net_paid), balance: Number(after.balance), content, userId })
    await logActivity({ userId, customerId: b.customer_id, bookingId, action: 'refund_recorded', detail: `${b.ref}: ₹${amount} — ${doc.number}` }, db)
    return { paymentId: pay!.id, document: doc }
  })
}

/** Voids a payment (owner only at the UI). Its receipt/refund note keeps its number and becomes VOID. */
export async function voidPayment(paymentId: string, reason: string, userId?: string | null) {
  if (!reason?.trim()) throw new Error('Give a reason for voiding this payment.')
  return tx(async (db) => {
    const p = await q1<{ booking_id: string; customer_id: string; amount: string; voided_at: string | null }>(`SELECT booking_id, customer_id, amount, voided_at FROM crm.payments WHERE id = $1 FOR UPDATE`, [paymentId], db)
    if (!p) throw new Error('Payment not found.')
    if (p.voided_at) throw new Error('This payment is already void.')
    await q(`UPDATE crm.payments SET voided_at = now(), void_reason = $2 WHERE id = $1`, [paymentId, reason.trim()], db)
    await q(`UPDATE crm.documents SET status = 'void', voided_at = now(), void_reason = $2 WHERE payment_id = $1 AND status = 'issued'`, [paymentId, `Payment voided: ${reason.trim()}`], db)
    await logActivity({ userId, customerId: p.customer_id, bookingId: p.booking_id, action: 'payment_voided', detail: `₹${p.amount}: ${reason.trim()}` }, db)
  })
}

export async function voidDocument(documentId: string, reason: string, userId?: string | null) {
  if (!reason?.trim()) throw new Error('Give a reason for voiding this document.')
  return tx(async (db) => {
    const d = await q1<{ doc_type: string; status: string; number: string; booking_id: string; customer_id: string }>(`SELECT doc_type, status, number, booking_id, customer_id FROM crm.documents WHERE id = $1 FOR UPDATE`, [documentId], db)
    if (!d) throw new Error('Document not found.')
    if (d.status === 'void') throw new Error('This document is already void.')
    if (d.doc_type === 'receipt' || d.doc_type === 'refund') throw new Error('Receipts and refund notes are voided by voiding their payment.')
    await q(`UPDATE crm.documents SET status = 'void', voided_at = now(), void_reason = $2 WHERE id = $1`, [documentId, reason.trim()], db)
    await logActivity({ userId, customerId: d.customer_id, bookingId: d.booking_id, action: 'document_voided', detail: `${d.number}: ${reason.trim()}` }, db)
  })
}

export async function getDocument(by: { id?: string; token?: string }) {
  return q1<any>(`SELECT * FROM crm.documents WHERE ${by.id ? 'id = $1' : 'public_token = $1'}`, [by.id ?? by.token])
}
