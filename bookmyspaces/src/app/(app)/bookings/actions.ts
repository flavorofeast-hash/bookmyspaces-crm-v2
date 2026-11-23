'use server'

import { requireUser, requireOwner } from '@/lib/auth'
import { createBooking, setBookingStatus, addBookingItem, removeBookingItem, updateBookingDetails } from '@/lib/bookings'
import { issueStatement, recordPayment, recordRefund, voidPayment, voidDocument } from '@/lib/billing'
import { run, str, num, safeBack } from '@/lib/action'
import { istToDate, nightsBetween } from '@/lib/format'
import { q } from '@/lib/db'

export async function createBookingAction(f: FormData) {
  const u = await requireUser()
  const back = safeBack(f, '/bookings/new')
  await run(back, 'Booking saved.', async () => {
    const type = str(f, 'booking_type') as 'room_stay' | 'event' | 'event_with_stay'
    const roomIds = f.getAll('room_ids').map(String).filter(Boolean)
    const eventIds = f.getAll('event_ids').map(String).filter(Boolean)
    const settings = (await q<any>(`SELECT checkin_time::text AS ci, checkout_time::text AS co FROM crm.business_settings WHERE id = 1`))[0]
    let rooms = null, event = null
    const checkin = str(f, 'checkin'), checkout = str(f, 'checkout')
    if (type !== 'event' && checkin && checkout) {
      const nights = nightsBetween(checkin, checkout)
      if (nights < 1) throw new Error('Check-out must be at least one day after check-in.')
      rooms = { spaceIds: roomIds, start: istToDate(checkin, settings.ci.slice(0, 5)), end: istToDate(checkout, settings.co.slice(0, 5)), nights }
    }
    const ed = str(f, 'event_date'), st = str(f, 'start_time'), et = str(f, 'end_time')
    if (type !== 'room_stay' && ed && st && et) {
      if (et <= st) throw new Error('Event end time must be after the start time.')
      const start = istToDate(ed, st), end = istToDate(ed, et)
      event = { spaceIds: eventIds, start, end, hours: Math.ceil((end.getTime() - start.getTime()) / 3_600_000) }
    }
    if (!rooms && !event) throw new Error('Enter the dates first.')
    const starts = [rooms?.start, event?.start].filter(Boolean) as Date[]
    const ends = [rooms?.end, event?.end].filter(Boolean) as Date[]
    const intent = str(f, 'intent')
    const b = await createBooking({
      customerId: str(f, 'customer_id') || null,
      newCustomer: str(f, 'new_name') ? { name: str(f, 'new_name'), phone: str(f, 'new_phone'), source: str(f, 'new_source') || 'walk_in' } : null,
      bookingType: type, eventType: str(f, 'event_type') || null, guests: num(f, 'guests'),
      rooms, event, start: new Date(Math.min(...starts.map(Number))), end: new Date(Math.max(...ends.map(Number))),
      packageId: str(f, 'package_id') || null, foodRequirements: str(f, 'food_requirements'), notes: str(f, 'notes'),
      discount: num(f, 'discount') ?? 0, confirm: intent === 'confirm', quote: false,
    }, u.id)
    if (intent === 'quote') await issueStatement(b.id, 'quotation', u.id)
    return `/bookings/${b.id}`
  })
}

const bk = (f: FormData) => str(f, 'booking_id')

export async function setStatusAction(f: FormData) {
  const u = await requireUser()
  const to = str(f, 'to')
  const msg: Record<string, string> = { confirmed: 'Booking confirmed. The spaces are now blocked for these dates.', cancelled: 'Booking cancelled. The spaces are free again.', completed: 'Booking marked completed.', enquiry: 'Booking reopened as an enquiry.' }
  await run(`/bookings/${bk(f)}`, msg[to] ?? 'Status updated.', async () => { await setBookingStatus(bk(f), to, u.id, str(f, 'reason') || null) })
}

export async function addItemAction(f: FormData) {
  const u = await requireUser()
  await run(`/bookings/${bk(f)}`, 'Item added.', async () => {
    const lineType = str(f, 'line_type') as 'space' | 'food' | 'extra'
    let start: Date | null = null, end: Date | null = null
    if (lineType === 'space') {
      if (!str(f, 'start_date') || !str(f, 'end_date')) throw new Error('Enter the start and end for the room or space.')
      start = istToDate(str(f, 'start_date'), str(f, 'start_time') || '14:00')
      end = istToDate(str(f, 'end_date'), str(f, 'end_time') || '11:00')
    }
    let description = str(f, 'description')
    if (lineType === 'space' && !description) {
      const s = (await q<any>(`SELECT s.name, p.name AS property FROM crm.spaces s JOIN crm.properties p ON p.id = s.property_id WHERE s.id = $1`, [str(f, 'space_id')]))[0]
      description = s ? `${s.property} · ${s.name}` : 'Space'
    }
    await addBookingItem(bk(f), { lineType, spaceId: str(f, 'space_id') || null, description, qty: num(f, 'qty') ?? 1, unitPrice: num(f, 'unit_price') ?? 0, start, end }, u.id)
  })
}

export async function removeItemAction(f: FormData) {
  const u = await requireUser()
  await run(`/bookings/${bk(f)}`, 'Item removed.', async () => { await removeBookingItem(str(f, 'item_id'), u.id) })
}

export async function updateDetailsAction(f: FormData) {
  const u = await requireUser()
  await run(`/bookings/${bk(f)}`, 'Booking details saved.', async () => {
    await updateBookingDetails(bk(f), { eventType: str(f, 'event_type'), guests: num(f, 'guests'), foodRequirements: str(f, 'food_requirements'), notes: str(f, 'notes'), discount: f.has('discount') ? num(f, 'discount') ?? 0 : undefined, assignedTo: f.has('assigned_to') ? str(f, 'assigned_to') || null : undefined }, u.id)
  })
}

export async function issueDocAction(f: FormData) {
  const u = await requireUser()
  const type = str(f, 'type') as 'quotation' | 'bill'
  await run(`/bookings/${bk(f)}`, type === 'bill' ? 'Final bill issued.' : 'Quotation issued.', async () => {
    await issueStatement(bk(f), type, u.id)
  })
}

export async function recordPaymentAction(f: FormData) {
  const u = await requireUser()
  await run(`/bookings/${bk(f)}`, 'Payment recorded and receipt issued.', async () => {
    const r = await recordPayment(bk(f), {
      kind: (str(f, 'kind') || 'advance') as any, amount: num(f, 'amount') ?? 0, method: str(f, 'method') || 'cash',
      reference: str(f, 'reference'), paidOn: str(f, 'paid_on') || null, note: str(f, 'note'), confirmBooking: f.get('confirm') === 'on',
    }, u.id)
    return `/bookings/${bk(f)}?receipt=${r.document.id}`
  })
}

export async function recordRefundAction(f: FormData) {
  const u = await requireUser()
  await run(`/bookings/${bk(f)}`, 'Refund recorded and refund note issued.', async () => {
    await recordRefund(bk(f), { amount: num(f, 'amount') ?? 0, method: str(f, 'method') || 'upi', reference: str(f, 'reference'), paidOn: str(f, 'paid_on') || null, note: str(f, 'note') }, u.id)
  })
}

export async function voidPaymentAction(f: FormData) {
  const u = await requireOwner()
  await run(`/bookings/${bk(f)}`, 'Payment voided. Its receipt now shows VOID.', async () => { await voidPayment(str(f, 'payment_id'), str(f, 'reason'), u.id) })
}

export async function voidDocumentAction(f: FormData) {
  const u = await requireOwner()
  await run(`/bookings/${bk(f)}`, 'Document voided.', async () => { await voidDocument(str(f, 'document_id'), str(f, 'reason'), u.id) })
}
