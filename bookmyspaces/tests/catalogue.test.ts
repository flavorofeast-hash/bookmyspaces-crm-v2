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

  it('never charges twice: same item, food or decoration already included in the package', async () => {
    await savePackage(form({ name: 'Rooftop Silver', kind: 'event', food_type: 'both', price: '42000', price_basis: 'flat', max_guests: '60', review_status: 'approved', active: 'on', inclusions: 'Rooftop venue\nBasic decoration\nBuffet' }), owner)
    await saveAddon(form({ name: 'Standard decor', category: 'decoration', price_min: '3000', review_status: 'approved', active: 'on', package_id: await pid('Rooftop Silver') }), owner)
    const e = { spaceIds: [S.rooftop], start: ist('2027-08-07', '16:00'), end: ist('2027-08-07', '23:00'), hours: 0 }
    const b = await createBooking({ customerId: c1, bookingType: 'event', guests: 70, event: e, start: e.start, end: e.end, packageId: await pid('Rooftop Silver') })
    await expect(addCatalogueItem(b.id, { type: 'package', id: await pid('Rooftop Silver') })).rejects.toThrow(/already on this booking/)
    await expect(addCatalogueItem(b.id, { type: 'package', id: await pid('Veg Buffet') })).rejects.toThrow(/already includes the food/)
    await expect(addCatalogueItem(b.id, { type: 'addon', id: await aid('Standard decor') })).rejects.toThrow(/already included in Rooftop Silver/)
    // extra guests are worked out from the package limit: 70 guests − 60 = 10
    await addCatalogueItem(b.id, { type: 'addon', id: await aid('Extra guest') })
    const full = await getBooking(b.id)
    const extra = full.items.find((i: any) => i.description.startsWith('Extra guest'))
    expect(extra).toMatchObject({ qty: '10.00', unit_price: '750.00' })
    expect(extra.description).toContain('above the Rooftop Silver limit of 60')
    await expect(addCatalogueItem(b.id, { type: 'addon', id: await aid('Extra guest') })).rejects.toThrow(/already on this booking/)
    expect(Number(full.total)).toBe(42000 + 7500 + 12000) // package + extra guests + rooftop rental (separate line)
    // the other way round: food first, then a package that includes food
    const b2 = await createBooking({ customerId: c1, bookingType: 'event', guests: 50, event: { ...e, start: ist('2027-08-08', '16:00'), end: ist('2027-08-08', '23:00') }, start: ist('2027-08-08', '16:00'), end: ist('2027-08-08', '23:00') })
    await addCatalogueItem(b2.id, { type: 'package', id: await pid('Veg Buffet') })
    await expect(addCatalogueItem(b2.id, { type: 'package', id: await pid('Rooftop Silver') })).rejects.toThrow(/already includes food. Remove Veg Buffet/)
    // guests within the limit: nothing extra to charge
    const b3 = await createBooking({ customerId: c1, bookingType: 'event', guests: 40, event: { ...e, start: ist('2027-08-09', '16:00'), end: ist('2027-08-09', '23:00') }, start: ist('2027-08-09', '16:00'), end: ist('2027-08-09', '23:00'), packageId: await pid('Rooftop Silver') })
    await expect(addCatalogueItem(b3.id, { type: 'addon', id: await aid('Extra guest') })).rejects.toThrow(/within the Rooftop Silver limit/)
  })
})

