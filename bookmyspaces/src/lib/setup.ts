import { allowsDefaultAdmin, isProduction, passwordProblem } from './env'
import { q, q1, tx, isPgError } from './db'
import { hashPassword } from './password'
import { writePriceAudit, type Actor } from './rates'

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
    if (id) await q(`UPDATE crm.properties SET name=$2, address=$3, phone=$4, notes=$5, active=$6, sort_order=COALESCE($7, sort_order),
        food_packages_enabled=$8, booking_rules=$9 WHERE id=$1`,
      [id, name, s(f.get('address')), s(f.get('phone')), s(f.get('notes')), f.get('active') !== 'off', n(f.get('sort_order')),
        f.get('food_packages_enabled') === 'on', s(f.get('booking_rules'))])
    else await q(`INSERT INTO crm.properties (name, address, phone, notes, sort_order) VALUES ($1,$2,$3,$4,COALESCE($5,0))`,
      [name, s(f.get('address')), s(f.get('phone')), s(f.get('notes')), n(f.get('sort_order'))])
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error(`A property named “${name}” already exists.`)
    throw e
  }
}

/** Adds one space, or several rooms at once ("Room" + numbers 101..105). */
export async function addSpaces(f: FormData, actor?: Actor): Promise<number> {
  const propertyId = s(f.get('property_id')), kind = s(f.get('kind')) ?? 'room', base = s(f.get('name'))
  if (!propertyId) throw new Error('Choose a property.')
  if (!base) throw new Error('Name is required.')
  const count = Math.min(50, Math.max(1, Number(f.get('count') ?? 1) || 1))
  const start = n(f.get('start_number'))
  const unit = f.has('price_unit') ? s(f.get('price_unit')) : (kind === 'room' ? 'night' : 'slot')
  const minP = n(f.get('min_price')), maxP = n(f.get('max_price')), price = n(f.get('price'))
  const names = count === 1 && start === null ? [base] : Array.from({ length: count }, (_, i) => `${base} ${(start ?? 1) + i}`)
  let added = 0
  for (const name of names) {
    try {
      await tx(async (db) => {
        const r = await q1<{ id: string; property: string }>(`INSERT INTO crm.spaces (property_id, name, kind, room_type, capacity, facilities, price, price_unit, description, max_occupancy, booking_rules, min_price, max_price)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, (SELECT name FROM crm.properties WHERE id = $1) AS property`,
          [propertyId, name, kind, s(f.get('room_type')), n(f.get('capacity')), s(f.get('facilities')), price, unit,
            s(f.get('description')), n(f.get('max_occupancy')), s(f.get('booking_rules')), minP, maxP], db)
        if (actor && r) {
          const sp = { id: r.id, name, property: r.property }
          await writePriceAudit(db, actor, sp, 'range', null, minP === null && maxP === null ? null : `${minP ?? '—'} – ${maxP ?? '—'}`)
          await writePriceAudit(db, actor, sp, 'standard', null, price === null ? null : String(price))
          await writePriceAudit(db, actor, sp, 'unit', null, unit)
        }
      })
      added++
    } catch (e) {
      if (isPgError(e, '23505')) throw new Error(`“${name}” already exists in this property${added ? ` (added ${added} before it)` : ''}.`)
      if (isPgError(e, '23514')) throw new Error('Check the prices: the minimum must not exceed the maximum, and the standard rate must be inside the range.')
      throw e
    }
  }
  return added
}

export async function updateSpace(f: FormData, actor?: Actor) {
  const id = s(f.get('id')), name = s(f.get('name'))
  if (!id || !name) throw new Error('Name is required.')
  const price = n(f.get('price')), minP = n(f.get('min_price')), maxP = n(f.get('max_price'))
  const unit = f.has('price_unit') ? s(f.get('price_unit')) : 'night'
  try {
    await tx(async (db) => {
      const old = await q1<any>(`SELECT s.id, s.name, s.price, s.min_price, s.max_price, s.price_unit, p.name AS property FROM crm.spaces s LEFT JOIN crm.properties p ON p.id = s.property_id WHERE s.id = $1 FOR UPDATE OF s`, [id], db)
      if (!old) throw new Error('Room or space not found.')
      await q(`UPDATE crm.spaces SET name=$2, kind=$3, room_type=$4, capacity=$5, facilities=$6, price=$7, price_unit=$8, active=$9,
          description=$10, max_occupancy=$11, booking_rules=$12, min_price=$13, max_price=$14 WHERE id=$1`,
        [id, name, s(f.get('kind')) ?? 'room', s(f.get('room_type')), n(f.get('capacity')), s(f.get('facilities')), price,
          unit, f.get('active') === 'on', s(f.get('description')), n(f.get('max_occupancy')), s(f.get('booking_rules')), minP, maxP], db)
      if (actor) {
        const sp = { id, name, property: old.property }
        const m = (v: any) => (v === null || v === undefined ? null : String(Number(v)))
        const rng = (a: any, b: any) => (a === null && b === null ? null : `${m(a) ?? '—'} – ${m(b) ?? '—'}`)
        await writePriceAudit(db, actor, sp, 'range', rng(old.min_price, old.max_price), rng(minP, maxP))
        await writePriceAudit(db, actor, sp, 'standard', m(old.price), m(price))
        await writePriceAudit(db, actor, sp, 'unit', old.price_unit, unit)
      }
    })
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error(`Another space in this property is already called “${name}”.`)
    if (isPgError(e, '23514')) throw new Error('Check the prices: the minimum must not exceed the maximum, and the standard rate must be inside the range.')
    if (isPgError(e, 'P0001')) throw new Error(e.message)
    throw e
  }
}

export { savePackage } from './catalogue'

export async function saveSlot(f: FormData) {
  const id = s(f.get('id')), name = s(f.get('name')), st = s(f.get('start_time')), en = s(f.get('end_time'))
  if (!name || !st || !en) throw new Error('Slot name, start and end are required.')
  if (en <= st) throw new Error('Slot end must be after its start.')
  if (id) await q(`UPDATE crm.event_slots SET name=$2, start_time=$3, end_time=$4 WHERE id=$1`, [id, name, st, en])
  else await q(`INSERT INTO crm.event_slots (name, start_time, end_time, sort_order) VALUES ($1,$2,$3,(SELECT COALESCE(max(sort_order),0)+1 FROM crm.event_slots))`, [name, st, en])
}

export const DEFAULT_USERNAME = 'admin'
export const DEFAULT_PASSWORD = 'admin'

/** Username: letters, numbers, dot, dash, underscore or @ (an email also works). */
function cleanUsername(raw: unknown): string {
  const u = s(raw as FormDataEntryValue | null)?.toLowerCase() ?? ''
  if (!/^[a-z0-9._@-]{3,64}$/.test(u)) throw new Error('Username: 3–64 letters, numbers, dots, dashes or underscores.')
  return u
}

/** Production needs a strong password; the test copy also accepts the default admin/admin. */
function checkPassword(pw: string, username: string) {
  if (isProduction()) { const p = passwordProblem(pw, username); if (p) throw new Error(p); return }
  if (pw !== DEFAULT_PASSWORD && pw.length < 8) throw new Error('Password must be at least 8 characters.')
}

export async function createUser(f: FormData, roleOverride?: 'owner') {
  const username = cleanUsername(f.get('username') ?? f.get('email')), name = s(f.get('name')) ?? 'Team', pw = String(f.get('password') ?? '')
  checkPassword(pw, username)
  const role = roleOverride ?? (f.get('role') === 'owner' ? 'owner' : 'staff')
  try {
    return (await q1<{ id: string; session_version: number }>(
      `INSERT INTO crm.app_users (email, name, role, password_hash, uses_default_password) VALUES ($1,$2,$3,$4,$5) RETURNING id, session_version`,
      [username, name, role, await hashPassword(pw), pw === DEFAULT_PASSWORD]))!
  } catch (e) {
    if (isPgError(e, '23505')) throw new Error('That username is already taken.')
    throw e
  }
}

/** Test copy only: creates the shared admin/admin login. */
export async function createDefaultAdmin() {
  if (!allowsDefaultAdmin()) throw new Error('The default admin/admin login is only allowed on the test copy.')
  const f = new FormData(); f.set('username', DEFAULT_USERNAME); f.set('password', DEFAULT_PASSWORD); f.set('name', 'Team')
  return createUser(f, 'owner')
}

/** Changing the password signs out every device (session_version bump). */
export async function setUserPassword(userId: string, pw: string) {
  const u = await q1<{ email: string }>(`SELECT email FROM crm.app_users WHERE id = $1`, [userId])
  if (!u) throw new Error('User not found.')
  if (pw === DEFAULT_PASSWORD) throw new Error('Choose a new password, not the default one.')
  checkPassword(pw, u.email)
  await q(`UPDATE crm.app_users SET password_hash = $2, uses_default_password = false, session_version = session_version + 1 WHERE id = $1`, [userId, await hashPassword(pw)])
}

export async function setUsername(userId: string, raw: string) {
  const username = cleanUsername(raw)
  try { await q(`UPDATE crm.app_users SET email = $2 WHERE id = $1`, [userId, username]) }
  catch (e) { if (isPgError(e, '23505')) throw new Error('That username is already taken.'); throw e }
}

export async function signOutEverywhere(userId: string) {
  await q(`UPDATE crm.app_users SET session_version = session_version + 1 WHERE id = $1`, [userId])
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

/** Owner changes someone's access. The last active owner cannot be made staff. Signs that login out everywhere. */
export async function setUserRole(userId: string, role: 'owner' | 'staff', actor: { id: string }) {
  if (userId === actor.id) throw new Error('You cannot change your own access.')
  if (role === 'staff') {
    const owners = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.app_users WHERE role = 'owner' AND active AND id <> $1`, [userId])
    if (!owners?.n) throw new Error('At least one active owner is required.')
  }
  const u = await q1<{ name: string; role: string }>(`SELECT name, role FROM crm.app_users WHERE id = $1`, [userId])
  if (!u) throw new Error('User not found.')
  await q(`UPDATE crm.app_users SET role = $2, session_version = session_version + 1 WHERE id = $1`, [userId, role])
  await q(`INSERT INTO crm.activity (user_id, action, detail) VALUES ($1, 'user_access_changed', $2)`, [actor.id, `${u.name}: ${u.role} → ${role}`])
}
