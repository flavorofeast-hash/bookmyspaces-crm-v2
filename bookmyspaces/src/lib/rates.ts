import { q, q1, tx, isPgError, type Db } from './db'

export type Actor = { id: string; name: string; email: string }
export const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** ISO weekday of a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (d: string) => ((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1

type SpaceRow = { id: string; name: string; property: string | null; price: string | null; min_price: string | null; max_price: string | null; price_unit: string | null }
const money = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : String(Number(v)))

async function spaceRow(db: Db, id: string, lock = false) {
  const s = await q1<SpaceRow>(`SELECT s.id, s.name, p.name AS property, s.price, s.min_price, s.max_price, s.price_unit
    FROM crm.spaces s LEFT JOIN crm.properties p ON p.id = s.property_id WHERE s.id = $1 ${lock ? 'FOR UPDATE OF s' : ''}`, [id], db)
  if (!s) throw new Error('Room or space not found.')
  return s
}

export async function writePriceAudit(db: Db, actor: Actor, s: { id: string; name: string; property: string | null },
  rateType: 'standard' | 'weekday' | 'date' | 'range' | 'unit', oldV: string | null, newV: string | null, key: { weekday?: number | null; onDate?: string | null } = {}) {
  if (oldV === newV) return
  await q(`INSERT INTO crm.price_audit (user_id, user_name, user_login, property, space_id, space, rate_type, weekday, on_date, old_value, new_value)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [actor.id, actor.name, actor.email, s.property, s.id, s.name, rateType, key.weekday ?? null, key.onDate ?? null, oldV, newV], db)
}

function checkInRange(s: SpaceRow, price: number) {
  if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid rate.')
  if (s.min_price === null || s.max_price === null) throw new Error(`The owner has not set a minimum and maximum price for ${s.name} yet (Settings → Rooms & spaces).`)
  if (price < Number(s.min_price) || price > Number(s.max_price))
    throw new Error(`₹${price} is outside the allowed range for ${s.name} (₹${Number(s.min_price)} – ₹${Number(s.max_price)}).`)
}

/** Sets (or clears, with price = null) the standard, a weekday or a date-specific rate. Any signed-in user; range enforced here and in the database. */
export async function setRate(actor: Actor, spaceId: string, kind: 'standard' | 'weekday' | 'date', price: number | null, key: { weekday?: number; onDate?: string } = {}) {
  if (kind === 'weekday' && !(key.weekday && key.weekday >= 1 && key.weekday <= 7)) throw new Error('Choose a weekday.')
  if (kind === 'date' && !(key.onDate && /^\d{4}-\d{2}-\d{2}$/.test(key.onDate))) throw new Error('Choose a date.')
  await tx(async (db) => {
    const s = await spaceRow(db, spaceId, true)
    if (price !== null) checkInRange(s, price)
    try {
      if (kind === 'standard') {
        await q(`UPDATE crm.spaces SET price = $2 WHERE id = $1`, [spaceId, price], db)
        await writePriceAudit(db, actor, s, 'standard', money(s.price), money(price))
        return
      }
      const where = kind === 'weekday' ? 'weekday = $2' : 'on_date = $2::date'
      const k = kind === 'weekday' ? key.weekday! : key.onDate!
      const old = await q1<{ price: string }>(`SELECT price FROM crm.space_rates WHERE space_id = $1 AND ${where} FOR UPDATE`, [spaceId, k], db)
      if (price === null) await q(`DELETE FROM crm.space_rates WHERE space_id = $1 AND ${where}`, [spaceId, k], db)
      else if (old) await q(`UPDATE crm.space_rates SET price = $3, updated_at = now(), updated_by = $4 WHERE space_id = $1 AND ${where}`, [spaceId, k, price, actor.id], db)
      else await q(`INSERT INTO crm.space_rates (space_id, ${kind === 'weekday' ? 'weekday' : 'on_date'}, price, updated_by) VALUES ($1,$2,$3,$4)`, [spaceId, k, price, actor.id], db)
      await writePriceAudit(db, actor, s, kind, money(old?.price), money(price), kind === 'weekday' ? { weekday: key.weekday } : { onDate: key.onDate })
    } catch (e) {
      if (isPgError(e, '23514') || isPgError(e, 'P0001')) throw new Error(`₹${price} is outside the allowed range for ${s.name}.`)
      throw e
    }
  })
}

/** Rate per space per date: date-specific, else weekday, else standard (null = not configured). */
export async function ratesFor(db: Db | undefined, spaces: { id: string; price: string | null }[], dates: string[]) {
  const rows = spaces.length ? await q<{ space_id: string; weekday: number | null; on_date: string | null; price: string }>(
    `SELECT space_id, weekday, to_char(on_date, 'YYYY-MM-DD') AS on_date, price FROM crm.space_rates
     WHERE space_id = ANY($1::uuid[]) AND (weekday IS NOT NULL OR on_date = ANY($2::date[]))`, [spaces.map((s) => s.id), dates], db) : []
  return (space: { id: string; price: string | null }, date: string): number | null => {
    const mine = rows.filter((r) => r.space_id === space.id)
    const d = mine.find((r) => r.on_date === date) ?? mine.find((r) => r.weekday === isoWeekday(date))
    return d ? Number(d.price) : space.price === null ? null : Number(space.price)
  }
}

export async function priceHistory(spaceId?: string | null, limit = 200) {
  return q<any>(`SELECT * FROM crm.price_audit WHERE ($1::uuid IS NULL OR space_id = $1) ORDER BY at DESC, id DESC LIMIT $2`, [spaceId || null, limit])
}
