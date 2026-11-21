import { q, type Db } from './db'

export async function logActivity(
  a: { userId?: string | null; customerId?: string | null; bookingId?: string | null; action: string; detail?: string },
  db?: Db,
) {
  await q(
    `INSERT INTO crm.activity (user_id, customer_id, booking_id, action, detail) VALUES ($1,$2,$3,$4,$5)`,
    [a.userId ?? null, a.customerId ?? null, a.bookingId ?? null, a.action, a.detail ?? null],
    db,
  )
}
