import { Client } from 'pg'
import { pool, q, q1 } from '@/lib/db'
import { applyMigrations } from '@/lib/migrate'

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/crm_vitest?host=/tmp'

process.env.CRM_DATABASE_URL = TEST_DB
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123456'

export async function resetDb() {
  const admin = new Client({ connectionString: TEST_DB.replace('/crm_vitest', '/postgres') })
  await admin.connect()
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'crm_vitest'`)
  if (!exists.rowCount) await admin.query(`CREATE DATABASE crm_vitest`)
  await admin.end()
  await q(`DROP SCHEMA IF EXISTS crm CASCADE`)
  await q(`DROP TABLE IF EXISTS public.leads`)
  await applyMigrations(pool())
}

export async function seedSpaces() {
  const p1 = (await q1<{ id: string }>(`INSERT INTO crm.properties (name, sort_order) VALUES ('Skyline Serenity', 1) RETURNING id`))!.id
  const p2 = (await q1<{ id: string }>(`INSERT INTO crm.properties (name, sort_order) VALUES ('MonuRama Homestay', 2) RETURNING id`))!.id
  const ins = async (prop: string, name: string, kind: string, price: number, unit: string, cap = 2) =>
    (await q1<{ id: string }>(`INSERT INTO crm.spaces (property_id, name, kind, price, price_unit, capacity) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [prop, name, kind, price, unit, cap]))!.id
  return {
    p1, p2,
    room101: await ins(p1, 'Room 101', 'room', 2500, 'night'),
    room102: await ins(p1, 'Room 102', 'room', 2500, 'night'),
    room103: await ins(p1, 'Room 103', 'room', 3000, 'night'),
    hall: await ins(p1, 'Celebration Hall', 'hall', 15000, 'slot', 120),
    rooftop: await ins(p2, 'Rooftop Terrace', 'rooftop', 12000, 'slot', 80),
    mroom: await ins(p2, 'Family Room', 'room', 3500, 'night', 4),
  }
}

export async function newCustomer(name = 'Test Customer', phone = '9830012345') {
  return (await q1<{ id: string }>(`INSERT INTO crm.customers (name, phone, whatsapp) VALUES ($1, $2, $2) RETURNING id`, [name, phone ? '91' + phone.slice(-10) : null]))!.id
}

export const ist = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`)

export async function closePool() {
  await pool().end()
  ;(global as any).__crmPool = undefined
}
