import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resetDb, closePool } from './helpers'
import { q, q1 } from '@/lib/db'
import { createCustomer, updateCustomer, searchCustomers, DuplicateCustomerError, importLegacyLeads, addFollowUp, completeFollowUp } from '@/lib/customers'
import { normalizePhone } from '@/lib/phone'

beforeAll(resetDb)
afterAll(closePool)

describe('phone normalisation', () => {
  it('normalises Indian numbers in every common format to 91XXXXXXXXXX', () => {
    for (const v of ['+91 98300 12345', '098300 12345', '9830012345', '919830012345', '91-98300-12345', '0091 9830012345'])
      expect(normalizePhone(v)).toBe('919830012345')
    expect(normalizePhone('+1 555 130 2285')).toBe('15551302285')
    expect(normalizePhone('12')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})

describe('customers', () => {
  let id: string
  it('creates a customer with normalised phone and WhatsApp defaulting to phone', async () => {
    const c = await createCustomer({ name: 'Priya Sharma', phone: '98300 12345', email: 'Priya@Example.com', source: 'phone_call', requirements: 'Haldi for 60 guests' })
    id = c.id
    expect(c.phone).toBe('919830012345')
    expect(c.whatsapp).toBe('919830012345')
    expect(c.email).toBe('priya@example.com')
  })
  it('detects a duplicate typed in a different format', async () => {
    await expect(createCustomer({ name: 'Priya S', phone: '+91-9830012345' })).rejects.toBeInstanceOf(DuplicateCustomerError)
    const n = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.customers`)
    expect(n!.n).toBe(1)
  })
  it('rejects an invalid number and a missing name', async () => {
    await expect(createCustomer({ name: 'X', phone: '123' })).rejects.toThrow(/does not look valid/)
    await expect(createCustomer({ name: '  ', phone: '9830099999' })).rejects.toThrow(/name is required/)
  })
  it('edits a customer and blocks changing to another customer’s number', async () => {
    const other = await createCustomer({ name: 'Rahul Das', phone: '9831100000' })
    const u = await updateCustomer(id, { name: 'Priya Sharma', phone: '9830012345', email: 'priya@example.com', notes: 'Prefers evening calls', requirements: 'Haldi, 60 guests, veg' })
    expect(u.notes).toBe('Prefers evening calls')
    await expect(updateCustomer(other.id, { name: 'Rahul Das', phone: '09830012345' })).rejects.toBeInstanceOf(DuplicateCustomerError)
  })
  it('searches by name, partial mobile and email', async () => {
    expect((await searchCustomers('priya')).map((c) => c.name)).toEqual(['Priya Sharma'])
    expect((await searchCustomers('12345')).map((c) => c.name)).toEqual(['Priya Sharma'])
    expect((await searchCustomers('+91 98311')).map((c) => c.name)).toEqual(['Rahul Das'])
    expect((await searchCustomers('example.com')).length).toBe(1)
  })
  it('adds and completes a follow-up', async () => {
    await addFollowUp(id, '2026-11-22', 'Call about menu')
    const f = await q1<{ id: string }>(`SELECT id FROM crm.follow_ups WHERE customer_id = $1`, [id])
    await completeFollowUp(f!.id)
    expect((await q1<any>(`SELECT done_at FROM crm.follow_ups WHERE id = $1`, [f!.id]))!.done_at).not.toBeNull()
  })
})

describe('legacy lead import (82 leads)', () => {
  beforeAll(async () => {
    // Same shape as the old CRM's public.leads table.
    await q(`CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), name text, phone text, email text,
      event_type text, event_date date, guest_count int, budget text, special_requirements text, venue text, status text, source text, notes text,
      followup_date timestamptz, inquiry_summary text, lead_score int, tags text[])`)
    const rows: string[] = []
    for (let i = 1; i <= 82; i++) {
      // leads 1-4 duplicate earlier phones in other formats; 5-7 have no phone; 8 has no name; 9 matches an existing CRM customer
      const phone = i <= 4 ? `+91 9000000${String(i + 10).padStart(3, '0')}` : i <= 7 ? null : i === 9 ? '9830012345' : `9000000${String(i).padStart(3, '0')}`
      const name = i === 8 ? null : `Lead ${i}`
      rows.push(`(${name ? `'${name}'` : 'NULL'}, ${phone ? `'${phone}'` : 'NULL'}, 'lead${i}@mail.com', 'Birthday', '2026-12-${String((i % 28) + 1).padStart(2, '0')}', ${20 + i}, '50k', 'Veg food', 'skyline', 'new_inquiry', '${i % 3 ? 'whatsapp' : 'website'}', 'note ${i}', ${i === 10 ? `'2026-11-25 10:00+05:30'` : 'NULL'}, 'summary ${i}', 5, '{}')`)
    }
    await q(`INSERT INTO public.leads (name, phone, email, event_type, event_date, guest_count, budget, special_requirements, venue, status, source, notes, followup_date, inquiry_summary, lead_score, tags) VALUES ${rows.join(',')}`)
  })

  it('imports all 82, merges duplicates by phone, keeps incomplete records and preserves originals', async () => {
    const before = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.customers`))!.n
    const r = await importLegacyLeads()
    expect(r.found).toBe(82)
    expect(r.created + r.merged).toBe(82)
    expect(r.merged).toBe(5) // 4 duplicate phones + 1 matching an existing customer
    expect(r.noPhone).toBe(3)
    const after = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.customers`))!.n
    expect(after - before).toBe(r.created)
    const totalLegacyIds = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT unnest(legacy_lead_ids) FROM crm.customers) x`))!.n
    expect(totalLegacyIds).toBe(82) // every original lead accounted for
    const noName = await q1<any>(`SELECT name, import_flags, legacy_data FROM crm.customers WHERE 'no_name' = ANY(import_flags)`)
    expect(noName.name).toMatch(/^Lead \+/)
    expect(noName.legacy_data[0].email).toBe('lead8@mail.com')
    const merged = await q1<any>(`SELECT legacy_data, requirements FROM crm.customers WHERE phone = '919830012345'`)
    expect(merged.legacy_data[0].name).toBe('Lead 9')
    expect(merged.requirements).toContain('Haldi, 60 guests, veg') // existing details kept
    expect(merged.requirements).toContain('Event: Birthday')
    const fu = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.follow_ups WHERE note LIKE '%old CRM%'`)
    expect(fu!.n).toBe(1)
  })

  it('is safe to run twice (nothing duplicated)', async () => {
    const r = await importLegacyLeads()
    expect(r.skipped).toBe(82)
    expect(r.created + r.merged).toBe(0)
  })
})
