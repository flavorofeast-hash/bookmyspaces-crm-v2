import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resetDb, closePool, seedSpaces, newCustomer, ist } from './helpers'
import { q, q1 } from '@/lib/db'
import { savePackage, saveAddon, addCatalogueItem } from '@/lib/catalogue'
import { createBooking, getBooking, updateBookingDetails } from '@/lib/bookings'
import { issueStatement } from '@/lib/billing'

let S: Awaited<ReturnType<typeof seedSpaces>>
let c1: string
const owner = { id: '', name: 'Owner Cat', email: 'owner-cat' }
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
const pid = async (name: string) => (await q1<{ id: string }>(`SELECT id FROM crm.packages WHERE name = $1`, [name]))!.id
const aid = async (name: string) => (await q1<{ id: string }>(`SELECT id FROM crm.addons WHERE name = $1`, [name]))!.id

beforeAll(async () => {
  await resetDb(); S = await seedSpaces(); c1 = await newCustomer('Catalogue Test', '9830000031')
  owner.id = (await q1<{ id: string }>(`INSERT INTO crm.app_users (email, name, role, password_hash) VALUES ('owner-cat','Owner Cat','owner','x') RETURNING id`))!.id
})
afterAll(closePool)

describe('packages, food and add-ons', () => {
  it('historical items start as OWNER REVIEW and cannot be offered until approved', async () => {
    await savePackage(form({ name: 'Rooftop Gold', kind: 'event', price: '50000', price_basis: 'flat', max_guests: '60', inclusions: 'Rooftop venue (4 hours)\nPremium decoration\nCake table setup' }), owner)
    const p = await q1<any>(`SELECT * FROM crm.packages WHERE name = 'Rooftop Gold'`)
    expect(p).toMatchObject({ review_status: 'owner_review', active: false, inclusions: ['Rooftop venue (4 hours)', 'Premium decoration', 'Cake table setup'] })
    await expect(savePackage(form({ id: p.id, name: 'Rooftop Gold', kind: 'event', price: '50000', price_basis: 'flat', active: 'on' }), owner)).rejects.toThrow(/Approve the package/)
    const e = { spaceIds: [S.rooftop], start: ist('2027-07-03', '16:00'), end: ist('2027-07-03', '23:00'), hours: 0 }
    const b = await createBooking({ customerId: c1, bookingType: 'event', guests: 40, event: e, start: e.start, end: e.end })
    await expect(addCatalogueItem(b.id, { type: 'package', id: p.id })).rejects.toThrow(/not approved/)
    await expect(createBooking({ customerId: c1, bookingType: 'event', guests: 40, event: e, start: e.start, end: e.end, packageId: p.id })).rejects.toThrow(/not approved/)
    const log = await q<any>(`SELECT * FROM crm.activity WHERE action = 'package_added' AND user_id = $1`, [owner.id])
    expect(log).toHaveLength(1)
  })

  it('a complete quotation: venue + package (inclusions shown) + per-guest food with minimum + add-ons within range − discount', async () => {
    await savePackage(form({ id: await pid('Rooftop Gold'), name: 'Rooftop Gold', kind: 'event', price: '50000', price_basis: 'flat', review_status: 'approved', active: 'on', inclusions: 'Rooftop venue (4 hours)\nPremium decoration' }), owner)
    await savePackage(form({ name: 'Veg Buffet', kind: 'food', food_type: 'veg', price: '600', price_basis: 'per_person', min_guests: '50', review_status: 'approved', active: 'on', description: 'Paneer, dal, rice' }), owner)
    await saveAddon(form({ name: 'Photography', category: 'photography', price_min: '8000', review_status: 'approved', active: 'on' }), owner)
    await saveAddon(form({ name: 'Theme decoration', category: 'decoration', price_min: '5000', price_max: '12000', review_status: 'approved', active: 'on' }), owner)
    await saveAddon(form({ name: 'Extra guest', category: 'guests', price_min: '750', unit: 'per_person', review_status: 'approved', active: 'on' }), owner)
    const e = { spaceIds: [S.hall], start: ist('2027-07-10', '16:00'), end: ist('2027-07-10', '23:00'), hours: 0 } // hall 15000
    const b = await createBooking({ customerId: c1, bookingType: 'event', guests: 40, event: e, start: e.start, end: e.end })
    await addCatalogueItem(b.id, { type: 'package', id: await pid('Rooftop Gold') })
    await addCatalogueItem(b.id, { type: 'package', id: await pid('Veg Buffet') }) // 40 guests → charged for minimum 50
    await addCatalogueItem(b.id, { type: 'addon', id: await aid('Photography') })
    await addCatalogueItem(b.id, { type: 'addon', id: await aid('Theme decoration'), price: 9000 })
    await addCatalogueItem(b.id, { type: 'addon', id: await aid('Extra guest'), qty: 5 })
    await expect(addCatalogueItem(b.id, { type: 'addon', id: await aid('Theme decoration'), price: 15000 })).rejects.toThrow(/outside the approved price/)
    await expect(addCatalogueItem(b.id, { type: 'addon', id: await aid('Photography'), price: 100 })).rejects.toThrow(/outside the approved price/)
    await updateBookingDetails(b.id, { guests: 40, discount: 2500 })
    const full = await getBooking(b.id)
    const gold = full.items.find((i: any) => i.description.startsWith('Rooftop Gold'))
    expect(gold.description).toContain('includes: Rooftop venue (4 hours), Premium decoration')
    expect(full.items.find((i: any) => i.description.startsWith('Veg Buffet'))).toMatchObject({ qty: '50.00', unit_price: '600.00' })
    expect(Number(full.subtotal)).toBe(15000 + 50000 + 50 * 600 + 8000 + 9000 + 5 * 750)
    expect(Number(full.total)).toBe(15000 + 50000 + 30000 + 8000 + 9000 + 3750 - 2500)
    // issued quotation is frozen even if the catalogue price changes later
    await issueStatement(b.id, 'quotation')
    const before = await q1<any>(`SELECT amount, content FROM crm.documents WHERE booking_id = $1`, [b.id])
    await savePackage(form({ id: await pid('Veg Buffet'), name: 'Veg Buffet', kind: 'food', price: '700', price_basis: 'per_person', min_guests: '50', review_status: 'approved', active: 'on' }), owner)
    expect(await q1<any>(`SELECT amount, content FROM crm.documents WHERE booking_id = $1`, [b.id])).toEqual(before)
    expect(Number(before.amount)).toBe(113250)
    const log = await q1<any>(`SELECT detail FROM crm.activity WHERE action = 'package_updated' ORDER BY id DESC LIMIT 1`)
    expect(log.detail).toContain('₹600 → ₹700')
  })

  it('old-CRM archive records are read-only', async () => {
    const r = await q1<any>(`INSERT INTO crm.legacy_records (source, record_type, legacy_id, number, amount, data) VALUES ('V3','proposal','x1','BMS-1',1000,'{}') RETURNING id`)
    await expect(q(`UPDATE crm.legacy_records SET amount = 1 WHERE id = $1`, [r.id])).rejects.toThrow(/read-only/)
    await expect(q(`DELETE FROM crm.legacy_records WHERE id = $1`, [r.id])).rejects.toThrow(/read-only/)
  })
})
