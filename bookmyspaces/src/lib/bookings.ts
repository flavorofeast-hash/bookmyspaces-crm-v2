import { q, q1, tx, isPgError, type Db } from './db'
import { logActivity } from './activity'
import { createCustomer, findCustomerByPhone } from './customers'

export type Space = {
  id: string; property_id: string; property_name: string; name: string; kind: 'room' | 'hall' | 'rooftop' | 'other'
  room_type: string | null; capacity: number | null; facilities: string | null; price: string | null; price_unit: string; active: boolean
}

export type AvailabilitySpace = Space & {
  status: 'free' | 'booked' | 'tentative' | 'not_configured'
  conflicts: { booking_id: string; ref: string; status: string; customer: string; start_at: string; end_at: string }[]
}

export class BookingConflictError extends Error {
  constructor(public conflicts: { space: string; ref: string; customer: string; start_at: string; end_at: string }[]) {
    super('Double booking prevented: ' + conflicts.map((c) => `${c.space} is already booked by ${c.ref} (${c.customer})`).join('; '))
  }
}

export async function listSpaces(includeInactive = false, db?: Db): Promise<Space[]> {
  return q<Space>(
    `SELECT s.*, p.name AS property_name FROM crm.spaces s JOIN crm.properties p ON p.id = s.property_id
     WHERE ($1 OR (s.active AND p.active)) ORDER BY p.sort_order, p.name, s.sort_order, s.kind, s.name`, [includeInactive], db)
}

/** Availability of every active space for [start, end). Confirmed/completed bookings block; enquiries/quotes show as tentative. */
export async function availability(start: Date, end: Date, kinds?: string[], excludeBookingId?: string): Promise<AvailabilitySpace[]> {
  const spaces = await listSpaces()
  const rows = await q<{ space_id: string; booking_id: string; ref: string; status: string; customer: string; start_at: string; end_at: string; holds: boolean }>(
    `SELECT i.space_id, b.id AS booking_id, b.ref, b.status, c.name AS customer, i.start_at, i.end_at, i.holds
     FROM crm.booking_items i JOIN crm.bookings b ON b.id = i.booking_id JOIN crm.customers c ON c.id = b.customer_id
     WHERE i.space_id IS NOT NULL AND b.status IN ('enquiry','quoted','confirmed','completed')
       AND tstzrange(i.start_at, i.end_at, '[)') && tstzrange($1, $2, '[)')
       AND ($3::uuid IS NULL OR b.id <> $3::uuid)
     ORDER BY i.start_at`, [start, end, excludeBookingId ?? null])
  return spaces
    .filter((s) => !kinds || kinds.includes(s.kind))
    .map((s) => {
      const mine = rows.filter((r) => r.space_id === s.id)
      const status = s.price === null ? 'not_configured' : mine.some((r) => r.holds) ? 'booked' : mine.length ? 'tentative' : 'free'
      return { ...s, status, conflicts: mine.map(({ booking_id, ref, status, customer, start_at, end_at }) => ({ booking_id, ref, status, customer, start_at, end_at })) }
    })
}

export type NewBookingInput = {
  customerId?: string | null
  newCustomer?: { name: string; phone?: string; email?: string; source?: string } | null
  bookingType: 'room_stay' | 'event' | 'event_with_stay'
  eventType?: string | null
  guests?: number | null
  rooms?: { spaceIds: string[]; start: Date; end: Date; nights: number } | null
  event?: { spaceIds: string[]; start: Date; end: Date; hours: number } | null
  start: Date
  end: Date
  packageId?: string | null
  foodRequirements?: string | null
  notes?: string | null
  discount?: number
  confirm?: boolean
  quote?: boolean
  source?: string | null
  campaignId?: string | null
}

function qtyFor(space: Space, ctx: { nights: number; hours: number; guests: number }): number {
  switch (space.price_unit) {
    case 'night': return Math.max(1, ctx.nights)
    case 'hour': return Math.max(1, ctx.hours)
    case 'person': return Math.max(1, ctx.guests)
    case 'day': return Math.max(1, ctx.nights || 1)
    default: return 1
  }
}

const unitLabel: Record<string, string> = { night: 'night', hour: 'hour', person: 'guest', day: 'day', slot: 'slot' }

export async function recalcBooking(bookingId: string, db: Db) {
  await q(
    `UPDATE crm.bookings b SET subtotal = s.sub, total = GREATEST(s.sub - b.discount, 0), updated_at = now()
     FROM (SELECT COALESCE(sum(amount), 0) AS sub FROM crm.booking_items WHERE booking_id = $1) s WHERE b.id = $1`, [bookingId], db)
}

async function conflictDetails(bookingId: string, db: Db) {
  return q<{ space: string; ref: string; customer: string; start_at: string; end_at: string }>(
    `SELECT DISTINCT s.name AS space, b2.ref, c.name AS customer, o.start_at, o.end_at
     FROM crm.booking_items i
     JOIN crm.booking_items o ON o.space_id = i.space_id AND o.holds AND o.booking_id <> i.booking_id
       AND tstzrange(o.start_at, o.end_at, '[)') && tstzrange(i.start_at, i.end_at, '[)')
     JOIN crm.bookings b2 ON b2.id = o.booking_id JOIN crm.customers c ON c.id = b2.customer_id
     JOIN crm.spaces s ON s.id = i.space_id
     WHERE i.booking_id = $1`, [bookingId], db)
}

async function addSpaceLines(db: Db, bookingId: string, spaceIds: string[], start: Date, end: Date, ctx: { nights: number; hours: number; guests: number }) {
  if (!spaceIds.length) return
  const spaces = await q<Space>(`SELECT s.*, p.name AS property_name FROM crm.spaces s JOIN crm.properties p ON p.id = s.property_id WHERE s.id = ANY($1::uuid[])`, [spaceIds], db)
  let i = 0
  for (const s of spaces) {
    if (s.price === null || !s.active) throw new Error(`${s.name} (${s.property_name}) is not configured for booking yet (inactive or no price set). Complete it in Settings → Rooms & spaces first.`)
    const qty = qtyFor(s, ctx)
    const desc = `${s.property_name} · ${s.name}` + (qty > 1 || s.price_unit !== 'slot' ? ` (${qty} ${unitLabel[s.price_unit] ?? s.price_unit}${qty === 1 ? '' : 's'})` : '')
    await q(
      `INSERT INTO crm.booking_items (booking_id, line_type, space_id, description, start_at, end_at, qty, unit_price, sort_order)
       VALUES ($1,'space',$2,$3,$4,$5,$6,$7,$8)`, [bookingId, s.id, desc, start, end, qty, s.price, i++], db)
  }
}

export async function createBooking(input: NewBookingInput, userId?: string | null): Promise<{ id: string; ref: string }> {
  if (!(input.end > input.start)) throw new Error('The end must be after the start.')
  const guests = Math.max(0, Number(input.guests ?? 0))
  {
    return await tx(async (db) => {
      let customerId = input.customerId || null
      if (!customerId && input.newCustomer?.name) {
        const existing = await findCustomerByPhone(input.newCustomer.phone, db)
        customerId = existing ? existing.id : (await createCustomer({ ...input.newCustomer }, userId, db)).id
      }
      if (!customerId) throw new Error('Choose a customer or enter the new customer’s name and mobile.')
      const cust = await q1<{ source: string; campaign_id: string | null }>(`SELECT source, campaign_id FROM crm.customers WHERE id = $1`, [customerId], db)
      if (!cust) throw new Error('Customer not found.')
      const ref = (await q1<{ n: string }>(`SELECT crm.next_number('booking','BK') AS n`, [], db))!.n
      const firstSpace = [...(input.event?.spaceIds ?? []), ...(input.rooms?.spaceIds ?? [])][0]
      const prop = firstSpace ? await q1<{ property_id: string }>(`SELECT property_id FROM crm.spaces WHERE id = $1`, [firstSpace], db) : null
      const b = await q1<{ id: string }>(
        `INSERT INTO crm.bookings (ref, customer_id, property_id, booking_type, event_type, guests, start_at, end_at, status, package_id,
           food_requirements, notes, discount, source, campaign_id, created_by, assigned_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'enquiry',$9,$10,$11,$12,$13,$14,$15,$15) RETURNING id`,
        [ref, customerId, prop?.property_id ?? null, input.bookingType, input.eventType || null, guests || null, input.start, input.end,
          input.packageId || null, input.foodRequirements || null, input.notes || null, Math.max(0, input.discount ?? 0),
          input.source ?? cust.source, input.campaignId ?? cust.campaign_id, userId ?? null], db)
      const id = b!.id
      if (input.event) await addSpaceLines(db, id, input.event.spaceIds, input.event.start, input.event.end, { nights: 1, hours: input.event.hours, guests })
      if (input.rooms) await addSpaceLines(db, id, input.rooms.spaceIds, input.rooms.start, input.rooms.end, { nights: input.rooms.nights, hours: 0, guests })
      if (input.packageId) {
        const p = await q1<{ name: string; price: string | null; price_basis: string }>(`SELECT name, price, price_basis FROM crm.packages WHERE id = $1`, [input.packageId], db)
        if (p && p.price === null) throw new Error(`The “${p.name}” package has no price yet. Set it in Settings → Packages first.`)
        if (p) {
          const qty = p.price_basis === 'per_person' ? Math.max(1, guests) : 1
          await q(`INSERT INTO crm.booking_items (booking_id, line_type, description, qty, unit_price, sort_order) VALUES ($1,'package',$2,$3,$4,50)`,
            [id, `${p.name} package` + (p.price_basis === 'per_person' ? ` (${qty} guests)` : ''), qty, p.price], db)
        }
      }
      await recalcBooking(id, db)
      await logActivity({ userId, customerId, bookingId: id, action: 'booking_created', detail: ref }, db)
      if (input.confirm) await setBookingStatusInTx(db, id, 'confirmed', userId)
      else if (input.quote) await q(`UPDATE crm.bookings SET status = 'quoted' WHERE id = $1`, [id], db)
      return { id, ref }
    })
  }
}

const TRANSITIONS: Record<string, string[]> = {
  enquiry: ['quoted', 'confirmed', 'cancelled'],
  quoted: ['enquiry', 'confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: ['enquiry'],
}

export async function setBookingStatusInTx(db: Db, id: string, to: string, userId?: string | null, reason?: string | null) {
  const b = await q1<{ status: string; ref: string; customer_id: string }>(`SELECT status, ref, customer_id FROM crm.bookings WHERE id = $1 FOR UPDATE`, [id], db)
  if (!b) throw new Error('Booking not found.')
  if (b.status === to) return
  if (!TRANSITIONS[b.status]?.includes(to)) throw new Error(`A ${b.status} booking cannot be changed to ${to}.`)
  if (to === 'cancelled' && !reason?.trim()) throw new Error('Please give a reason for cancelling.')
  await q(`SAVEPOINT status_change`, [], db)
  try {
    await q(
      `UPDATE crm.bookings SET status = $2, updated_at = now(),
         cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE NULL END,
         cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE NULL END
       WHERE id = $1`, [id, to, reason ?? null], db)
  } catch (e) {
    if (isPgError(e, '23P01')) {
      await q(`ROLLBACK TO SAVEPOINT status_change`, [], db)
      throw new BookingConflictError(await conflictDetails(id, db))
    }
    throw e
  }
  await logActivity({ userId, customerId: b.customer_id, bookingId: id, action: `booking_${to}`, detail: reason ? `${b.ref}: ${reason}` : b.ref }, db)
}

export async function setBookingStatus(id: string, to: string, userId?: string | null, reason?: string | null) {
  await tx((db) => setBookingStatusInTx(db, id, to, userId, reason))
}

export async function addBookingItem(bookingId: string, item: { lineType: 'space' | 'food' | 'extra'; spaceId?: string | null; description: string; qty: number; unitPrice: number; start?: Date | null; end?: Date | null }, userId?: string | null) {
  await tx(async (db) => {
    const b = await q1<{ status: string; customer_id: string; ref: string }>(`SELECT status, customer_id, ref FROM crm.bookings WHERE id = $1 FOR UPDATE`, [bookingId], db)
    if (!b) throw new Error('Booking not found.')
    if (['completed', 'cancelled'].includes(b.status)) throw new Error('Completed or cancelled bookings cannot be changed.')
    if (!item.description.trim()) throw new Error('Describe the item.')
    if (!(item.qty > 0)) throw new Error('Quantity must be more than 0.')
    if (!(item.unitPrice >= 0)) throw new Error('Price cannot be negative.')
    await q(`SAVEPOINT add_item`, [], db)
    try {
      await q(
        `INSERT INTO crm.booking_items (booking_id, line_type, space_id, description, start_at, end_at, qty, unit_price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(max(sort_order),0)+1 FROM crm.booking_items WHERE booking_id=$1))`,
        [bookingId, item.lineType, item.spaceId ?? null, item.description.trim(), item.start ?? null, item.end ?? null, item.qty, item.unitPrice], db)
    } catch (e) {
      if (isPgError(e, '23P01')) {
        await q(`ROLLBACK TO SAVEPOINT add_item`, [], db)
        const c = await q<{ space: string; ref: string; customer: string; start_at: string; end_at: string }>(
          `SELECT s.name AS space, b.ref, c.name AS customer, i.start_at, i.end_at FROM crm.booking_items i
           JOIN crm.bookings b ON b.id = i.booking_id JOIN crm.customers c ON c.id = b.customer_id JOIN crm.spaces s ON s.id = i.space_id
           WHERE i.space_id = $1 AND i.holds AND tstzrange(i.start_at, i.end_at, '[)') && tstzrange($2, $3, '[)')`,
          [item.spaceId, item.start, item.end], db)
        throw new BookingConflictError(c)
      }
      if (isPgError(e, '23514')) throw new Error('A room or space line needs a start and an end, with the end after the start.')
      throw e
    }
    await recalcBooking(bookingId, db)
    await logActivity({ userId, customerId: b.customer_id, bookingId, action: 'booking_item_added', detail: `${b.ref}: ${item.description}` }, db)
  })
}

export async function removeBookingItem(itemId: string, userId?: string | null) {
  await tx(async (db) => {
    const it = await q1<{ booking_id: string; description: string; status: string; customer_id: string }>(
      `SELECT i.booking_id, i.description, b.status, b.customer_id FROM crm.booking_items i JOIN crm.bookings b ON b.id = i.booking_id WHERE i.id = $1 FOR UPDATE OF b`, [itemId], db)
    if (!it) throw new Error('Item not found.')
    if (['completed', 'cancelled'].includes(it.status)) throw new Error('Completed or cancelled bookings cannot be changed.')
    await q(`DELETE FROM crm.booking_items WHERE id = $1`, [itemId], db)
    await recalcBooking(it.booking_id, db)
    await logActivity({ userId, customerId: it.customer_id, bookingId: it.booking_id, action: 'booking_item_removed', detail: it.description }, db)
  })
}

export async function updateBookingDetails(id: string, d: { eventType?: string | null; guests?: number | null; foodRequirements?: string | null; notes?: string | null; discount?: number; assignedTo?: string | null }, userId?: string | null) {
  await tx(async (db) => {
    const b = await q1<{ status: string; customer_id: string }>(`SELECT status, customer_id FROM crm.bookings WHERE id = $1 FOR UPDATE`, [id], db)
    if (!b) throw new Error('Booking not found.')
    if (['completed', 'cancelled'].includes(b.status) && d.discount !== undefined) throw new Error('Completed or cancelled bookings cannot be repriced.')
    await q(`UPDATE crm.bookings SET event_type = $2, guests = $3, food_requirements = $4, notes = $5, discount = COALESCE($6, discount),
       assigned_to = CASE WHEN $7 THEN $8::uuid ELSE assigned_to END, updated_at = now() WHERE id = $1`,
      [id, d.eventType || null, d.guests ?? null, d.foodRequirements || null, d.notes || null, d.discount ?? null, d.assignedTo !== undefined, d.assignedTo || null], db)
    await recalcBooking(id, db)
    await logActivity({ userId, customerId: b.customer_id, bookingId: id, action: 'booking_updated' }, db)
  })
}

export async function getBooking(id: string) {
  const b = await q1<any>(
    `SELECT b.*, c.name AS customer_name, c.phone AS customer_phone, c.whatsapp AS customer_whatsapp, c.email AS customer_email,
       p.name AS property_name, pk.name AS package_name, au.name AS assigned_name, bb.received, bb.refunded, bb.net_paid, bb.balance
     FROM crm.bookings b JOIN crm.customers c ON c.id = b.customer_id
     LEFT JOIN crm.properties p ON p.id = b.property_id LEFT JOIN crm.packages pk ON pk.id = b.package_id LEFT JOIN crm.app_users au ON au.id = b.assigned_to
     JOIN crm.booking_balances bb ON bb.booking_id = b.id WHERE b.id = $1`, [id])
  if (!b) return null
  const [items, payments, documents] = await Promise.all([
    q<any>(`SELECT i.*, s.kind AS space_kind FROM crm.booking_items i LEFT JOIN crm.spaces s ON s.id = i.space_id WHERE i.booking_id = $1 ORDER BY i.sort_order, i.start_at`, [id]),
    q<any>(`SELECT p.*, d.id AS doc_id, d.number AS doc_number FROM crm.payments p
            LEFT JOIN crm.documents d ON d.payment_id = p.id AND d.status = 'issued' WHERE p.booking_id = $1 ORDER BY p.created_at`, [id]),
    q<any>(`SELECT * FROM crm.documents WHERE booking_id = $1 ORDER BY issued_at`, [id]),
  ])
  return { ...b, items, payments, documents }
}

export async function listBookings(f: { status?: string; from?: string; to?: string; term?: string; limit?: number } = {}) {
  return q<any>(
    `SELECT b.*, c.name AS customer_name, c.phone AS customer_phone, bb.balance, bb.net_paid,
       (SELECT name FROM crm.app_users WHERE id = b.assigned_to) AS assigned_name,
       (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM crm.booking_items i JOIN crm.spaces s ON s.id = i.space_id WHERE i.booking_id = b.id) AS spaces
     FROM crm.bookings b JOIN crm.customers c ON c.id = b.customer_id JOIN crm.booking_balances bb ON bb.booking_id = b.id
     WHERE ($1::text IS NULL OR b.status = $1)
       AND ($2::date IS NULL OR b.end_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata'))
       AND ($3::date IS NULL OR b.start_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
       AND ($4::text IS NULL OR b.ref ILIKE '%'||$4||'%' OR c.name ILIKE '%'||$4||'%' OR c.phone LIKE '%'||$4||'%')
     ORDER BY b.start_at DESC LIMIT $5`,
    [f.status || null, f.from || null, f.to || null, f.term?.trim() || null, f.limit ?? 200])
}

/** Space lines (with booking info) overlapping a date window, for the calendar. */
export async function calendarItems(from: Date, to: Date) {
  return q<{ space_id: string; booking_id: string; ref: string; status: string; customer: string; start_at: string; end_at: string; holds: boolean; booking_type: string; event_type: string | null }>(
    `SELECT i.space_id, b.id AS booking_id, b.ref, b.status, c.name AS customer, i.start_at, i.end_at, i.holds, b.booking_type, b.event_type
     FROM crm.booking_items i JOIN crm.bookings b ON b.id = i.booking_id JOIN crm.customers c ON c.id = b.customer_id
     WHERE i.space_id IS NOT NULL AND b.status <> 'cancelled' AND tstzrange(i.start_at, i.end_at, '[)') && tstzrange($1, $2, '[)')
     ORDER BY i.start_at`, [from, to])
}
