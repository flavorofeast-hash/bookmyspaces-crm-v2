import { q, q1, isPgError } from './db'
import { hashPassword } from './password'

const n = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v))
const s = (v: FormDataEntryValue | null) => { const t = String(v ?? '').trim(); return t ? t : null }

export async function getSettings() {
  return (await q1<any>(`SELECT *, checkin_time::text AS checkin, checkout_time::text AS checkout,
    business_hours_start::text AS hours_start, business_hours_end::text AS hours_end FROM crm.business_settings WHERE id = 1`))!
}

export async function saveSettings(f: FormData) {
  const wa = s(f.get('whatsapp_number'))?.replace(/\D/g, '') || null
  await q(
    `UPDATE crm.business_settings SET business_name=$1, address=$2, phone=$3, email=$4, whatsapp_number=$5, upi_id=$6, bank_details=$7,
       document_footer=$8, checkin_time=$9, checkout_time=$10, business_hours_start=$11, business_hours_end=$12,
       auto_reply_enabled=$13, auto_reply_text=$14, updated_at=now() WHERE id = 1`,
    [s(f.get('business_name')) ?? 'BookMySpaces', s(f.get('address')), s(f.get('phone')), s(f.get('email')), wa, s(f.get('upi_id')),
      s(f.get('bank_details')), s(f.get('document_footer')), s(f.get('checkin_time')) ?? '14:00', s(f.get('checkout_time')) ?? '11:00',
      s(f.get('hours_start')) ?? '09:00', s(f.get('hours_end')) ?? '21:00', f.get('auto_reply_enabled') === 'on',
      s(f.get('auto_reply_text')) ?? 'Thank you for contacting us. We will reply shortly.'])
}

export async function saveProperty(f: FormData) {
  const id = s(f.get('id')), name = s(f.get('name'))
  if (!name) throw new Error('Property name is required.')
  try {
    if (id) await q(`UPDATE crm.properties SET name=$2, address=$3, phone=$4, notes=$5, active=$6, sort_order=COALESCE($7, sort_order) WHERE id=$1`,
      [id, name, s(f.get('address')), s(f.get('phone')), s(f.get('notes')), f.get('active') !== 'off', n(f.get('sort_order'))])
    else await q(`INSERT INTO crm.properties (name, address, phone, notes, sort_order) VALUES ($1,$2,$3,$4,COALESCE($5,0))`,
      [name, s(f.get('address')), s(f.get('phone')), s(f.get('notes')), n(f.get('sort_order'))])
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error(`A property named “${name}” already exists.`)
    throw e
  }
}

/** Adds one space, or several rooms at once ("Room" + numbers 101..105). */
export async function addSpaces(f: FormData): Promise<number> {
  const propertyId = s(f.get('property_id')), kind = s(f.get('kind')) ?? 'room', base = s(f.get('name'))
  if (!propertyId) throw new Error('Choose a property.')
  if (!base) throw new Error('Name is required.')
  const count = Math.min(50, Math.max(1, Number(f.get('count') ?? 1) || 1))
  const start = n(f.get('start_number'))
  const unit = s(f.get('price_unit')) ?? (kind === 'room' ? 'night' : 'slot')
  const names = count === 1 && start === null ? [base] : Array.from({ length: count }, (_, i) => `${base} ${(start ?? 1) + i}`)
  let added = 0
  for (const name of names) {
    try {
      await q(`INSERT INTO crm.spaces (property_id, name, kind, room_type, capacity, facilities, price, price_unit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [propertyId, name, kind, s(f.get('room_type')), n(f.get('capacity')), s(f.get('facilities')), n(f.get('price')) ?? 0, unit])
      added++
    } catch (e) {
      if (isPgError(e, '23505')) throw new Error(`“${name}” already exists in this property${added ? ` (added ${added} before it)` : ''}.`)
      throw e
    }
  }
  return added
}

export async function updateSpace(f: FormData) {
  const id = s(f.get('id')), name = s(f.get('name'))
  if (!id || !name) throw new Error('Name is required.')
  try {
    await q(`UPDATE crm.spaces SET name=$2, kind=$3, room_type=$4, capacity=$5, facilities=$6, price=$7, price_unit=$8, active=$9 WHERE id=$1`,
      [id, name, s(f.get('kind')) ?? 'room', s(f.get('room_type')), n(f.get('capacity')), s(f.get('facilities')), n(f.get('price')) ?? 0,
        s(f.get('price_unit')) ?? 'night', f.get('active') === 'on'])
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error(`Another space in this property is already called “${name}”.`)
    throw e
  }
}

export async function savePackage(f: FormData) {
  const id = s(f.get('id')), name = s(f.get('name'))
  if (!name) throw new Error('Package name is required.')
  const vals = [name, s(f.get('description')), n(f.get('price')) ?? 0, s(f.get('price_basis')) ?? 'per_person', f.get('active') !== 'off']
  try {
    if (id) await q(`UPDATE crm.packages SET name=$2, description=$3, price=$4, price_basis=$5, active=$6 WHERE id=$1`, [id, ...vals])
    else await q(`INSERT INTO crm.packages (name, description, price, price_basis, active) VALUES ($1,$2,$3,$4,$5)`, vals)
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error(`A package named “${name}” already exists.`)
    throw e
  }
}

export async function saveSlot(f: FormData) {
  const id = s(f.get('id')), name = s(f.get('name')), st = s(f.get('start_time')), en = s(f.get('end_time'))
  if (!name || !st || !en) throw new Error('Slot name, start and end are required.')
  if (en <= st) throw new Error('Slot end must be after its start.')
  if (id) await q(`UPDATE crm.event_slots SET name=$2, start_time=$3, end_time=$4 WHERE id=$1`, [id, name, st, en])
  else await q(`INSERT INTO crm.event_slots (name, start_time, end_time, sort_order) VALUES ($1,$2,$3,(SELECT COALESCE(max(sort_order),0)+1 FROM crm.event_slots))`, [name, st, en])
}

export async function createUser(f: FormData, roleOverride?: 'owner') {
  const email = s(f.get('email'))?.toLowerCase(), name = s(f.get('name')), pw = String(f.get('password') ?? '')
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.')
  if (!name) throw new Error('Enter the person’s name.')
  if (pw.length < 8) throw new Error('Password must be at least 8 characters.')
  const role = roleOverride ?? (f.get('role') === 'owner' ? 'owner' : 'staff')
  try {
    return (await q1<{ id: string; session_version: number }>(
      `INSERT INTO crm.app_users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, session_version`,
      [email, name, role, await hashPassword(pw)]))!
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error('A user with that email already exists.')
    throw e
  }
}

export async function setUserPassword(userId: string, pw: string) {
  if (pw.length < 8) throw new Error('Password must be at least 8 characters.')
  await q(`UPDATE crm.app_users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1`, [userId, await hashPassword(pw)])
}

export async function setUserActive(userId: string, active: boolean, actingUserId: string) {
  if (userId === actingUserId && !active) throw new Error('You cannot deactivate your own account.')
  if (!active) {
    const owners = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.app_users WHERE role = 'owner' AND active AND id <> $1`, [userId])
    const target = await q1<{ role: string }>(`SELECT role FROM crm.app_users WHERE id = $1`, [userId])
    if (target?.role === 'owner' && !owners?.n) throw new Error('At least one active owner is required.')
  }
  await q(`UPDATE crm.app_users SET active = $2, session_version = session_version + 1 WHERE id = $1`, [userId, active])
}
