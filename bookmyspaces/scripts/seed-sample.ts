// Fills a TEST database with realistic SAMPLE data. Refuses to run on a database
// that already has real customers, so it can never mix sample and real records.
// Usage: CRM_DATABASE_URL=<test db> npm run db:seed-sample
import { pool, q, q1 } from '../src/lib/db'
import { applyMigrations } from '../src/lib/migrate'
import { createUser } from '../src/lib/setup'
import { createCustomer, addFollowUp, importLegacyLeads } from '../src/lib/customers'
import { createBooking, setBookingStatus } from '../src/lib/bookings'
import { issueStatement, recordPayment, recordRefund } from '../src/lib/billing'
import { createCampaign, savePost } from '../src/lib/marketing'
import { istDate, addDays, istToDate } from '../src/lib/format'

const SAMPLE = 'SAMPLE DATA — test environment only'

async function main() {
  if (process.env.ALLOW_SAMPLE_SEED !== 'yes') throw new Error('Set ALLOW_SAMPLE_SEED=yes to confirm this is a TEST database.')
  await applyMigrations(pool())
  const existing = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.customers WHERE NOT ('sample' = ANY(import_flags))`)
  if (existing!.n > 0) throw new Error('This database already has non-sample customers. Refusing to add sample data.')

  await q(`UPDATE crm.business_settings SET business_name='BookMySpaces', address='Salt Lake, Kolkata, West Bengal', phone='+91 90514 59463',
           email='hello@bookmyspaces.in', whatsapp_number='919051459463', upi_id='bookmyspaces@upi', bank_details='Sample Bank · A/C 000000000000 · IFSC SAMP0000001',
           document_footer='Thank you for choosing BookMySpaces! (sample document)' WHERE id = 1`)

  const of = new FormData(); of.set('name', 'Demo Owner'); of.set('email', 'owner@demo.test'); of.set('password', 'Demo@12345')
  const owner = await createUser(of, 'owner')
  { const f = new FormData(); f.set('name', 'Demo Reception'); f.set('email', 'staff@demo.test'); f.set('password', 'Demo@12345'); f.set('role', 'staff'); await createUser(f) }
  const uid = owner.id

  const prop = async (name: string, address: string, sort: number) => (await q1<{ id: string }>(`INSERT INTO crm.properties (name, address, sort_order) VALUES ($1,$2,$3) RETURNING id`, [name, address, sort]))!.id
  const sp = async (p: string, name: string, kind: string, type: string | null, cap: number, price: number, unit: string, fac: string) =>
    (await q1<{ id: string }>(`INSERT INTO crm.spaces (property_id, name, kind, room_type, capacity, price, price_unit, facilities) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [p, name, kind, type, cap, price, unit, fac]))!.id
  const sky = await prop('Skyline Serenity', 'Salt Lake Sector V, Kolkata', 1)
  const monu = await prop('MonuRama Homestay', 'New Town, Kolkata', 2)
  const R: Record<string, string> = {}
  for (const n of [101, 102, 103, 104]) R[`S${n}`] = await sp(sky, `Room ${n}`, 'room', 'Deluxe AC', 2, 2800, 'night', 'AC, TV, Wi-Fi')
  for (const n of [201, 202]) R[`S${n}`] = await sp(sky, `Room ${n}`, 'room', 'Premium AC', 3, 3500, 'night', 'AC, TV, Wi-Fi, balcony')
  R.hall = await sp(sky, 'Celebration Hall', 'hall', 'Banquet hall', 120, 18000, 'slot', 'AC, sound system, stage')
  R.roof = await sp(sky, 'Skyline Rooftop', 'rooftop', 'Open-air rooftop', 80, 15000, 'slot', 'Fairy lights, city view')
  for (const n of [1, 2, 3]) R[`M${n}`] = await sp(monu, `Family Room ${n}`, 'room', 'Family room', 4, 3200, 'night', 'AC, 2 beds')
  R.cafe = await sp(monu, 'MonuRama Café Terrace', 'rooftop', 'Café terrace', 40, 8000, 'slot', 'Café seating')

  const pk = async (n: string, d: string, p: number) => (await q1<{ id: string }>(`INSERT INTO crm.packages (name, description, price, price_basis) VALUES ($1,$2,$3,'per_person') RETURNING id`, [n, d, p]))!.id
  const silver = await pk('Silver', 'Veg buffet: 2 starters, 4 mains, 1 dessert', 550)
  const gold = await pk('Gold', 'Veg + non-veg buffet, welcome drink', 750)
  await pk('Platinum', 'Premium buffet, live counter, mocktails', 1050)
  await q(`INSERT INTO crm.wa_templates (name, language, description, uses_name_param) VALUES ('booking_followup','en','Follow-up after enquiry (sample — must exist in WhatsApp Manager)', true)`)

  const diwali = (await createCampaign({ name: 'Winter rooftop parties', code: 'WINTER26', channel: 'Instagram', startsOn: addDays(istDate(), -20), endsOn: addDays(istDate(), 40) }))!.id
  await createCampaign({ name: 'Wedding season stays', code: 'WEDSTAY', channel: 'Facebook', startsOn: addDays(istDate(), -10) })

  const people = [
    ['Ananya Chatterjee', '9830011101', 'whatsapp', 'Haldi for 60 guests, prefers rooftop'],
    ['Rohit Banerjee', '9830011102', 'phone_call', "Friends' reunion, 35 people, evening"],
    ['Sneha Gupta', '9830011103', 'instagram', 'Birthday party, 40 guests, veg'],
    ['Arjun Mehta', '9830011104', 'referral', 'Wedding guests: 6 rooms, 2 nights'],
    ['Priyanka Das', '9830011105', 'walk_in', 'Family gathering, 25 people, lunch'],
    ['Kunal Sen', '9830011106', 'website', 'Anniversary dinner, 20 guests'],
    ['Moumita Roy', '9830011107', 'facebook', 'Pre-wedding shoot + small party'],
    ['Sourav Ghosh', '9830011108', 'whatsapp', 'Room for 3 nights, business trip'],
    ['Ritika Agarwal', '9830011109', 'google', 'Mehendi, 50 guests'],
    ['Debashis Mukherjee', '9830011110', 'phone_call', 'Kitty party, 15 ladies'],
    ['Tanvi Shah', '9830011111', 'campaign', 'Rooftop party enquiry (WINTER26)'],
    ['Nikhil Jain', '9830011112', 'walk_in', 'Corporate team dinner, 30'],
    ['Pooja Sharma', '9830011113', 'instagram', 'Engagement ceremony, 80 guests'],
    ['Aritra Bose', '9830011114', 'whatsapp', 'Family stay, 2 family rooms'],
    ['Shreya Kapoor', '9830011115', 'referral', 'Baby shower, 30 guests'],
  ]
  const C: Record<string, string> = {}
  for (const [name, phone, source, req] of people) {
    const c = await createCustomer({ name, phone, source, requirements: req, notes: SAMPLE, campaignId: source === 'campaign' ? diwali : null }, uid)
    await q(`UPDATE crm.customers SET import_flags = array_append(import_flags, 'sample') WHERE id = $1`, [c.id])
    C[name.split(' ')[0]] = c.id
  }

  const today = istDate()
  const D = (n: number) => addDays(today, n)
  const ev = (ids: string[], day: string, s: string, e: string) => ({ spaceIds: ids, start: istToDate(day, s), end: istToDate(day, e), hours: 0 })
  const rm = (ids: string[], a: string, b: string) => ({ spaceIds: ids, start: istToDate(a, '14:00'), end: istToDate(b, '11:00'), nights: Math.round((+new Date(b) - +new Date(a)) / 864e5) })
  const bk = async (o: any) => (await createBooking({ ...o, notes: SAMPLE, start: (o.event ?? o.rooms).start, end: (o.rooms ?? o.event).end }, uid)).id

  // Event today on the rooftop, fully paid
  const b1 = await bk({ customerId: C.Ananya, bookingType: 'event', eventType: 'Haldi', guests: 60, event: ev([R.roof], today, '16:00', '22:00'), packageId: gold, confirm: true })
  await recordPayment(b1, { kind: 'advance', amount: 20000, method: 'upi', reference: 'UPI-SAMPLE-1' }, uid)
  await issueStatement(b1, 'bill', uid)
  // Room check-in today (2 rooms), advance paid
  const b2 = await bk({ customerId: C.Arjun, bookingType: 'room_stay', eventType: 'Wedding guest stay', guests: 4, rooms: rm([R.S101, R.S102], today, D(2)), confirm: true })
  await recordPayment(b2, { kind: 'advance', amount: 5000, method: 'bank_transfer', reference: 'NEFT-SAMPLE' }, uid)
  // Check-out today
  const b3 = await bk({ customerId: C.Sourav, bookingType: 'room_stay', guests: 1, rooms: rm([R.S201], D(-3), today), confirm: true })
  await recordPayment(b3, { kind: 'advance', amount: 10500, method: 'cash' }, uid)
  // Upcoming event with stay, advance + balance due
  const b4 = await bk({ customerId: C.Pooja, bookingType: 'event_with_stay', eventType: 'Pre-wedding', guests: 80, event: ev([R.hall], D(3), '16:00', '23:00'), rooms: rm([R.S103, R.S104], D(3), D(4)), packageId: silver, confirm: true })
  await issueStatement(b4, 'quotation', uid)
  await recordPayment(b4, { kind: 'advance', amount: 25000, method: 'upi', reference: 'UPI-SAMPLE-4' }, uid)
  // Upcoming reunion, quoted (tentative)
  const b5 = await bk({ customerId: C.Rohit, bookingType: 'event', eventType: "Friends' reunion", guests: 35, event: ev([R.cafe], D(5), '18:00', '23:00') })
  await issueStatement(b5, 'quotation', uid)
  // Family gathering next week, confirmed, no payment yet
  await bk({ customerId: C.Priyanka, bookingType: 'event', eventType: 'Family gathering', guests: 25, event: ev([R.hall], D(6), '08:00', '14:00'), packageId: silver, confirm: true })
  // Family rooms
  const b7 = await bk({ customerId: C.Aritra, bookingType: 'room_stay', eventType: 'Family gathering', guests: 7, rooms: rm([R.M1, R.M2], D(1), D(3)), confirm: true })
  await recordPayment(b7, { kind: 'advance', amount: 4000, method: 'upi' }, uid)
  // Past completed booking, fully paid
  const b8 = await bk({ customerId: C.Kunal, bookingType: 'event', eventType: 'Anniversary', guests: 20, event: ev([R.cafe], D(-10), '19:00', '23:00'), confirm: true })
  await recordPayment(b8, { kind: 'advance', amount: 3000, method: 'upi' }, uid)
  await recordPayment(b8, { kind: 'balance', amount: 5000, method: 'cash' }, uid)
  await issueStatement(b8, 'bill', uid)
  await setBookingStatus(b8, 'completed', uid)
  // Cancelled with partial refund
  const b9 = await bk({ customerId: C.Moumita, bookingType: 'event', eventType: 'Pre-wedding', guests: 30, event: ev([R.roof], D(9), '16:00', '22:00'), confirm: true })
  await recordPayment(b9, { kind: 'advance', amount: 6000, method: 'upi' }, uid)
  await setBookingStatus(b9, 'cancelled', uid, 'Date changed by family')
  await recordRefund(b9, { amount: 4000, method: 'upi', note: 'Cancellation refund, ₹2,000 retained as per policy' }, uid)
  // Open enquiries
  await bk({ customerId: C.Sneha, bookingType: 'event', eventType: 'Birthday', guests: 40, event: ev([R.roof], D(12), '18:00', '23:00') })
  await bk({ customerId: C.Tanvi, bookingType: 'event', eventType: 'Birthday', guests: 30, event: ev([R.roof], D(14), '18:00', '23:00'), campaignId: diwali })

  await addFollowUp(C.Rohit, today, 'Call to confirm reunion menu and take advance', uid)
  await addFollowUp(C.Sneha, D(-1), 'Send revised quotation with decoration', uid)
  await addFollowUp(C.Ritika, today, 'Share Mehendi package options', uid)
  await addFollowUp(C.Pooja, D(2), 'Collect balance before event', uid)

  const msg = async (cid: string, dir: 'in' | 'out', body: string, minsAgo: number, status = dir === 'in' ? 'received' : 'read') =>
    q(`INSERT INTO crm.messages (customer_id, direction, body, status, wa_message_id, created_at, read_by_staff) VALUES ($1,$2,$3,$4,$5, now() - ($6 || ' minutes')::interval, $7)`,
      [cid, dir, body, status, `sample.${cid.slice(0, 6)}.${minsAgo}`, String(minsAgo), dir === 'out' || minsAgo > 120])
  await msg(C.Tanvi, 'in', 'Hi BookMySpaces! I saw your offer (WINTER26). Please share details.', 300)
  await msg(C.Tanvi, 'out', 'Thank you for contacting BookMySpaces! Please share your dates and number of guests.', 299)
  await msg(C.Tanvi, 'in', 'Birthday on the rooftop, about 30 people, evening', 45)
  await msg(C.Rohit, 'in', 'Can we add a DJ for the reunion?', 30)
  await msg(C.Ananya, 'in', 'We will reach by 3:30 pm for decoration', 600)
  await msg(C.Ananya, 'out', 'Sure, the rooftop will be ready by 3 pm.', 590)

  await savePost(null, { title: 'Winter rooftop parties', caption: 'Celebrate under the stars at Skyline Rooftop! Birthdays, reunions and haldi for up to 80 guests. Message us with code WINTER26 for a free welcome drink. 🌃', platforms: ['facebook', 'instagram', 'google'], plannedFor: D(2), campaignId: diwali }, uid)
  await savePost(null, { title: 'Wedding guest stays', caption: 'Wedding in the family? Book 4+ rooms at Skyline Serenity and get breakfast included. Code WEDSTAY.', platforms: ['facebook', 'google'], plannedFor: D(7) }, uid)

  // Synthetic old-CRM leads table (same columns as the real one) to demonstrate the import screen.
  if (!(await q1<{ ok: boolean }>(`SELECT to_regclass('public.leads') IS NOT NULL AS ok`))!.ok) {
    await q(`CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), name text, phone text, email text,
      event_type text, event_date date, guest_count int, budget text, special_requirements text, venue text, status text, source text, notes text, followup_date timestamptz, inquiry_summary text)`)
    for (let i = 1; i <= 82; i++) {
      const phone = i % 17 === 0 ? null : i % 11 === 0 ? '9830011101' : `97000${String(10000 + i)}`
      await q(`INSERT INTO public.leads (name, phone, email, event_type, event_date, guest_count, budget, venue, status, source, notes, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new_inquiry',$9,$10, now() - ($11 || ' days')::interval)`,
        [i % 23 === 0 ? null : `Sample Lead ${i}`, phone, i % 5 ? `lead${i}@example.test` : null, ['Birthday', 'Haldi', 'Reunion', 'Wedding guests'][i % 4], D(10 + (i % 60)), 15 + (i % 70), `${20 + i}k`, i % 2 ? 'skyline' : 'monurama', i % 3 ? 'whatsapp' : 'website', SAMPLE, String(100 - i)])
    }
  }
  await importLegacyLeads(uid)
  await q(`UPDATE crm.customers SET import_flags = array_append(import_flags, 'sample') WHERE NOT ('sample' = ANY(import_flags))`)
  console.log('Sample data loaded. Logins: owner@demo.test / Demo@12345 (owner), staff@demo.test / Demo@12345 (staff)')
}

main().then(() => pool().end()).catch(async (e) => { console.error(e.message); await pool().end(); process.exit(1) })
