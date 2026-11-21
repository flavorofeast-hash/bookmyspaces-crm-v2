import { q, q1, tx, isPgError, type Db } from './db'
import { normalizePhone } from './phone'
import { logActivity } from './activity'

export type Customer = {
  id: string; name: string; phone: string | null; whatsapp: string | null; email: string | null
  source: string; campaign_id: string | null; requirements: string | null; notes: string | null
  created_at: string; updated_at: string; import_flags: string[]; legacy_data: any
}

export type CustomerInput = {
  name: string; phone?: string | null; whatsapp?: string | null; email?: string | null
  source?: string | null; campaignId?: string | null; requirements?: string | null; notes?: string | null
}

export class DuplicateCustomerError extends Error {
  constructor(public existingId: string, public existingName: string) {
    super(`A customer with this phone number already exists: ${existingName}`)
  }
}

export async function findCustomerByPhone(raw: string | null | undefined, db?: Db): Promise<Customer | null> {
  const phone = normalizePhone(raw)
  if (!phone) return null
  return q1<Customer>(`SELECT * FROM crm.customers WHERE phone = $1 OR whatsapp = $1 ORDER BY (phone = $1) DESC LIMIT 1`, [phone], db)
}

function clean(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t ? t : null
}

export async function createCustomer(input: CustomerInput, userId?: string | null, db?: Db): Promise<Customer> {
  const name = clean(input.name)
  if (!name) throw new Error('Customer name is required.')
  const phone = normalizePhone(input.phone)
  if (input.phone && clean(input.phone) && !phone) throw new Error('That mobile number does not look valid.')
  const whatsapp = normalizePhone(input.whatsapp) ?? phone
  const existing = phone ? await findCustomerByPhone(phone, db) : null
  if (existing) throw new DuplicateCustomerError(existing.id, existing.name)
  try {
    const c = await q1<Customer>(
      `INSERT INTO crm.customers (name, phone, whatsapp, email, source, campaign_id, requirements, notes)
       VALUES ($1,$2,$3,$4,COALESCE($5,'walk_in'),$6,$7,$8) RETURNING *`,
      [name, phone, whatsapp, clean(input.email)?.toLowerCase() ?? null, clean(input.source), input.campaignId || null,
        clean(input.requirements), clean(input.notes)],
      db,
    )
    await logActivity({ userId, customerId: c!.id, action: 'customer_created', detail: name }, db)
    return c!
  } catch (e) {
    if (isPgError(e, '23505')) {
      const ex = await findCustomerByPhone(phone, db)
      if (ex) throw new DuplicateCustomerError(ex.id, ex.name)
    }
    throw e
  }
}

export async function updateCustomer(id: string, input: CustomerInput, userId?: string | null): Promise<Customer> {
  const name = clean(input.name)
  if (!name) throw new Error('Customer name is required.')
  const phone = normalizePhone(input.phone)
  if (input.phone && clean(input.phone) && !phone) throw new Error('That mobile number does not look valid.')
  if (phone) {
    const other = await q1<{ id: string; name: string }>(`SELECT id, name FROM crm.customers WHERE phone = $1 AND id <> $2`, [phone, id])
    if (other) throw new DuplicateCustomerError(other.id, other.name)
  }
  const c = await q1<Customer>(
    `UPDATE crm.customers SET name=$2, phone=$3, whatsapp=$4, email=$5, source=COALESCE($6, source), campaign_id=$7,
       requirements=$8, notes=$9, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, name, phone, normalizePhone(input.whatsapp) ?? phone, clean(input.email)?.toLowerCase() ?? null,
      clean(input.source), input.campaignId || null, clean(input.requirements), clean(input.notes)],
  )
  if (!c) throw new Error('Customer not found.')
  await logActivity({ userId, customerId: id, action: 'customer_updated', detail: name })
  return c
}

export async function searchCustomers(term: string, limit = 50) {
  const t = term.trim()
  const digits = t.replace(/\D/g, '')
  return q<Customer & { bookings: number; last_activity: string | null; next_follow_up: string | null; balance: string }>(
    `SELECT c.*,
       (SELECT count(*)::int FROM crm.bookings b WHERE b.customer_id = c.id) AS bookings,
       (SELECT min(f.due_on) FROM crm.follow_ups f WHERE f.customer_id = c.id AND f.done_at IS NULL) AS next_follow_up,
       COALESCE((SELECT sum(bb.balance) FROM crm.booking_balances bb JOIN crm.bookings b ON b.id = bb.booking_id
                 WHERE b.customer_id = c.id AND b.status IN ('confirmed','completed')), 0) AS balance
     FROM crm.customers c
     WHERE $1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.email ILIKE '%' || $1 || '%'
        OR ($2 <> '' AND length($2) >= 3 AND (c.phone LIKE '%' || $2 || '%' OR c.whatsapp LIKE '%' || $2 || '%'))
     ORDER BY c.updated_at DESC
     LIMIT $3`,
    [t, digits, limit],
  )
}

export async function getCustomer(id: string) {
  return q1<Customer & { campaign_name: string | null; campaign_code: string | null }>(
    `SELECT c.*, cp.name AS campaign_name, cp.code AS campaign_code
     FROM crm.customers c LEFT JOIN crm.campaigns cp ON cp.id = c.campaign_id WHERE c.id = $1`, [id])
}

export async function addFollowUp(customerId: string, dueOn: string, note: string, userId?: string | null, bookingId?: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new Error('Choose a follow-up date.')
  if (!note.trim()) throw new Error('Write what the follow-up is about.')
  await tx(async (db) => {
    await q(`INSERT INTO crm.follow_ups (customer_id, booking_id, due_on, note, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [customerId, bookingId ?? null, dueOn, note.trim(), userId ?? null], db)
    await logActivity({ userId, customerId, bookingId, action: 'follow_up_added', detail: `${dueOn}: ${note.trim()}` }, db)
  })
}

export async function completeFollowUp(id: string, userId?: string | null) {
  const f = await q1<{ customer_id: string; note: string }>(
    `UPDATE crm.follow_ups SET done_at = now() WHERE id = $1 AND done_at IS NULL RETURNING customer_id, note`, [id])
  if (f) await logActivity({ userId, customerId: f.customer_id, action: 'follow_up_done', detail: f.note })
}

/**
 * Imports rows from the legacy CRM's public.leads table. Every original
 * column is preserved verbatim in legacy_data. Leads sharing a phone number
 * are merged into one customer (all originals kept). Leads without a usable
 * phone are still imported, flagged "no_phone". Re-running is safe: leads
 * already imported (by legacy id) are skipped.
 */
export async function importLegacyLeads(userId?: string | null): Promise<{ found: number; created: number; merged: number; skipped: number; noPhone: number }> {
  const exists = await q1<{ ok: boolean }>(`SELECT to_regclass('public.leads') IS NOT NULL AS ok`)
  if (!exists?.ok) throw new Error('No legacy leads table (public.leads) was found in this database.')
  return tx(async (db) => {
    const leads = await q<{ id: string; row: any }>(`SELECT id::text AS id, to_jsonb(l) AS row FROM public.leads l ORDER BY l.created_at NULLS LAST, l.id`, [], db)
    const already = new Set((await q<{ id: string }>(`SELECT unnest(legacy_lead_ids) AS id FROM crm.customers`, [], db)).map((r) => r.id))
    let created = 0, merged = 0, skipped = 0, noPhone = 0
    for (const { id, row } of leads) {
      if (already.has(id)) { skipped++; continue }
      const phone = normalizePhone(row.phone)
      const name = clean(row.name) ?? (phone ? `Lead +${phone}` : `Unnamed lead ${id.slice(0, 8)}`)
      const reqParts = [
        row.event_type && `Event: ${row.event_type}`,
        row.event_date && `Date: ${row.event_date}`,
        row.event_time && `Time: ${row.event_time}`,
        row.guest_count && `Guests: ${row.guest_count}`,
        row.venue && `Venue: ${row.venue}`,
        row.budget && `Budget: ${row.budget}`,
        row.special_requirements && `Notes: ${row.special_requirements}`,
      ].filter(Boolean)
      const notesParts = [row.notes, row.inquiry_summary && `Summary: ${row.inquiry_summary}`, row.status && `Old CRM status: ${row.status}`]
        .filter(Boolean)
      const src = ['website', 'whatsapp', 'instagram', 'justdial', 'referral', 'facebook', 'google'].includes(row.source) ? row.source : 'import'
      const flags = ['imported_from_old_crm', ...(phone ? [] : ['no_phone']), ...(row.name ? [] : ['no_name'])]
      const existing = phone ? await q1<{ id: string }>(`SELECT id FROM crm.customers WHERE phone = $1`, [phone], db) : null
      if (existing) {
        await q(
          `UPDATE crm.customers SET legacy_lead_ids = array_append(legacy_lead_ids, $2),
             legacy_data = COALESCE(legacy_data, '[]'::jsonb) || jsonb_build_array($3::jsonb),
             requirements = concat_ws(E'\n', requirements, NULLIF($4, '')),
             notes = concat_ws(E'\n', notes, NULLIF($5, '')),
             import_flags = (SELECT array_agg(DISTINCT f) FROM unnest(import_flags || ARRAY['merged_duplicate_leads']) f),
             updated_at = now()
           WHERE id = $1`,
          [existing.id, id, JSON.stringify(row), reqParts.join('\n'), notesParts.join('\n')], db)
        merged++
      } else {
        const c = await q1<{ id: string }>(
          `INSERT INTO crm.customers (name, phone, whatsapp, email, source, requirements, notes, created_at, legacy_lead_ids, legacy_data, import_flags)
           VALUES ($1,$2,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),ARRAY[$8],jsonb_build_array($9::jsonb),$10) RETURNING id`,
          [name, phone, clean(row.email)?.toLowerCase() ?? null, src, reqParts.join('\n') || null, notesParts.join('\n') || null,
            row.created_at ?? null, id, JSON.stringify(row), flags], db)
        if (row.followup_date) {
          await q(`INSERT INTO crm.follow_ups (customer_id, due_on, note, created_by) VALUES ($1, ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date, 'Follow-up carried over from old CRM', $3)`,
            [c!.id, row.followup_date, userId ?? null], db)
        }
        created++
      }
      if (!phone) noPhone++
    }
    await logActivity({ userId, action: 'legacy_import', detail: `found ${leads.length}, created ${created}, merged ${merged}, skipped ${skipped}` }, db)
    return { found: leads.length, created, merged, skipped, noPhone }
  })
}
