import { q, q1, tx, isPgError } from './db'
import { logActivity } from './activity'
import { addBookingItem } from './bookings'
import type { Actor } from './rates'

const s = (v: FormDataEntryValue | null) => { const t = String(v ?? '').trim(); return t ? t : null }
const n = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === '' ? null : Number(v))
const lines = (v: FormDataEntryValue | null) => String(v ?? '').split('\n').map((x) => x.trim()).filter(Boolean)
const money = (v: any) => (v === null || v === undefined ? 'NOT CONFIGURED' : `₹${Number(v)}`)

export const REVIEW_LABEL: Record<string, string> = { approved: 'Approved', owner_review: 'OWNER REVIEW REQUIRED', historical: 'Historical (not offered)' }

/** Owner: create or edit a package (event / food / dining). Every change is written to the activity log. */
export async function savePackage(f: FormData, actor?: Actor) {
  const id = s(f.get('id')), name = s(f.get('name'))
  if (!name) throw new Error('Package name is required.')
  const kind = s(f.get('kind')) ?? 'food'
  const review = s(f.get('review_status')) ?? (id ? null : 'owner_review')
  const vals = {
    name, kind, description: s(f.get('description')), price: n(f.get('price')), price_basis: s(f.get('price_basis')) ?? (kind === 'event' ? 'flat' : 'per_person'),
    active: f.get('active') === 'on', property_id: s(f.get('property_id')), min_guests: n(f.get('min_guests')), max_guests: n(f.get('max_guests')),
    add_ons: s(f.get('add_ons')), inclusions: lines(f.get('inclusions')), duration: s(f.get('duration')), food_type: s(f.get('food_type')), kitchen_notes: s(f.get('kitchen_notes')),
  }
  if (vals.active && vals.price === null) throw new Error('A package without a price cannot be made available.')
  try {
    await tx(async (db) => {
      const old = id ? await q1<any>(`SELECT * FROM crm.packages WHERE id = $1 FOR UPDATE`, [id], db) : null
      const status = review ?? old?.review_status ?? 'owner_review'
      if (vals.active && status !== 'approved') throw new Error('Approve the package (Status: Approved) before making it available for quotations.')
      const cols = ['name', 'kind', 'description', 'price', 'price_basis', 'active', 'property_id', 'min_guests', 'max_guests', 'add_ons', 'inclusions', 'duration', 'food_type', 'kitchen_notes']
      const args = cols.map((c) => (vals as any)[c])
      if (old) await q(`UPDATE crm.packages SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, review_status=$${cols.length + 2}, updated_at=now(), updated_by=$${cols.length + 3} WHERE id=$1`, [id, ...args, status, actor?.id ?? null], db)
      else await q(`INSERT INTO crm.packages (${cols.join(', ')}, review_status, updated_by, source) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}, $${cols.length + 2}, 'Added in CRM')`, [...args, status, actor?.id ?? null], db)
      const detail = old ? `${name}: price ${money(old.price)} → ${money(vals.price)}, ${old.active ? 'available' : 'not available'} → ${vals.active ? 'available' : 'not available'}, status ${REVIEW_LABEL[old.review_status]} → ${REVIEW_LABEL[status]}` : `${name} added (${money(vals.price)})`
      await logActivity({ userId: actor?.id, action: old ? 'package_updated' : 'package_added', detail }, db)
    })
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error(`A package named “${name}” already exists.`)
    if (isPgError(e, '23514')) throw new Error('Check the values (type, food type, prices and guest numbers).')
    throw e
  }
}

/** Owner: create or edit a decoration / add-on. */
export async function saveAddon(f: FormData, actor?: Actor) {
  const id = s(f.get('id')), name = s(f.get('name'))
  if (!name) throw new Error('Name is required.')
  const v = {
    name, category: s(f.get('category')) ?? 'other', description: s(f.get('description')), price_min: n(f.get('price_min')), price_max: n(f.get('price_max')),
    unit: s(f.get('unit')) ?? 'fixed', property_id: s(f.get('property_id')), package_id: s(f.get('package_id')), active: f.get('active') === 'on',
  }
  if (v.price_min !== null && v.price_max === null) v.price_max = v.price_min
  if (v.active && v.price_min === null) throw new Error('An add-on without a price cannot be made available.')
  try {
    await tx(async (db) => {
      const old = id ? await q1<any>(`SELECT * FROM crm.addons WHERE id = $1 FOR UPDATE`, [id], db) : null
      const status = s(f.get('review_status')) ?? old?.review_status ?? 'owner_review'
      if (v.active && status !== 'approved') throw new Error('Approve the add-on (Status: Approved) before making it available for quotations.')
      const cols = Object.keys(v), args = Object.values(v)
      if (old) await q(`UPDATE crm.addons SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, review_status=$${cols.length + 2}, updated_at=now(), updated_by=$${cols.length + 3} WHERE id=$1`, [id, ...args, status, actor?.id ?? null], db)
      else await q(`INSERT INTO crm.addons (${cols.join(', ')}, review_status, updated_by, source) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}, $${cols.length + 2}, 'Added in CRM')`, [...args, status, actor?.id ?? null], db)
      const rng = (a: any, b: any) => (a === null || a === undefined ? 'NOT CONFIGURED' : Number(a) === Number(b) ? `₹${Number(a)}` : `₹${Number(a)}–₹${Number(b)}`)
      await logActivity({ userId: actor?.id, action: old ? 'addon_updated' : 'addon_added', detail: old ? `${name}: ${rng(old.price_min, old.price_max)} → ${rng(v.price_min, v.price_max)}, status ${REVIEW_LABEL[old.review_status]} → ${REVIEW_LABEL[status]}, ${v.active ? 'available' : 'not available'}` : `${name} added` }, db)
    })
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error(`An add-on named “${name}” already exists.`)
    if (isPgError(e, '23514')) throw new Error('Check the prices: the minimum must not exceed the maximum.')
    throw e
  }
}

/** Adds an approved, available package or add-on to a booking. Price/quantity are decided here, not by the browser. */
export async function addCatalogueItem(bookingId: string, item: { type: 'package' | 'addon'; id: string; price?: number | null; qty?: number | null }, userId?: string | null) {
  const b = await q1<{ guests: number | null }>(`SELECT guests FROM crm.bookings WHERE id = $1`, [bookingId])
  if (!b) throw new Error('Booking not found.')
  const guests = Math.max(0, Number(b.guests ?? 0))
  if (item.type === 'package') {
    const p = await q1<any>(`SELECT * FROM crm.packages WHERE id = $1`, [item.id])
    if (!p || !p.active || p.review_status !== 'approved' || p.price === null) throw new Error('That package is not approved and available yet.')
    const perPerson = p.price_basis === 'per_person'
    if (perPerson && !guests) throw new Error('Enter the number of guests in the booking Details first.')
    const qty = perPerson ? Math.max(guests, Number(p.min_guests ?? 0)) : 1
    const inc = p.inclusions?.length ? ` — includes: ${p.inclusions.join(', ')}` : p.description ? ` — ${p.description}` : ''
    await addBookingItem(bookingId, { lineType: p.kind === 'event' ? 'extra' : 'food', description: `${p.name}${perPerson ? ` (${qty} guests${qty > guests ? `, minimum ${p.min_guests}` : ''})` : ' package'}${inc}${p.max_guests && !perPerson ? ` (up to ${p.max_guests} guests)` : ''}`, qty, unitPrice: Number(p.price), packageId: p.id }, userId)
    return
  }
  const a = await q1<any>(`SELECT * FROM crm.addons WHERE id = $1`, [item.id])
  if (!a || !a.active || a.review_status !== 'approved' || a.price_min === null) throw new Error('That add-on is not approved and available yet.')
  const min = Number(a.price_min), max = Number(a.price_max ?? a.price_min)
  const price = item.price === null || item.price === undefined || Number.isNaN(item.price) ? min : item.price
  if (price < min || price > max) throw new Error(`₹${price} is outside the approved price for ${a.name} (₹${min}${max !== min ? ` – ₹${max}` : ''}).`)
  let qty = a.unit === 'per_person' ? Math.max(1, Number(item.qty ?? guests) || 0) : Math.max(1, Number(item.qty ?? 1) || 1)
  let note = ''
  if (a.category === 'guests' && (item.qty === null || item.qty === undefined || Number.isNaN(item.qty))) {
    // Extra guests = booking guests above the event package's guest limit.
    const lim = await q1<{ max_guests: number | null; name: string }>(`SELECT p.max_guests, p.name FROM crm.booking_items i JOIN crm.packages p ON p.id = i.package_id
      WHERE i.booking_id = $1 AND p.kind = 'event' AND p.max_guests IS NOT NULL ORDER BY p.max_guests DESC LIMIT 1`, [bookingId])
    if (!lim) throw new Error('No package with a guest limit on this booking — type the number of extra guests.')
    const extra = guests - Number(lim.max_guests)
    if (extra <= 0) throw new Error(`${guests} guests is within the ${lim.name} limit of ${lim.max_guests}; no extra guests to charge.`)
    qty = extra; note = ` above the ${lim.name} limit of ${lim.max_guests}`
  }
  await addBookingItem(bookingId, { lineType: a.category === 'food' ? 'food' : 'extra', description: a.unit === 'per_person' ? `${a.name} (${qty} guests${note})` : a.name, qty, unitPrice: price, addonId: a.id }, userId)
}
