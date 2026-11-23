import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { databaseUrl, crmEnv } from './env'

// Server-only database access. The CRM talks to Postgres directly (Supabase's
// Postgres in production) through CRM_DATABASE_URL. Nothing here is ever sent
// to the browser.

declare global {
  // eslint-disable-next-line no-var
  var __crmPool: Pool | undefined
}

export function isDbConfigured(): boolean {
  return Boolean(databaseUrl())
}

function makePool(): Pool {
  const url = databaseUrl()
  if (!url) throw new Error('CRM_DATABASE_URL is not set')
  const local = /localhost|127\.0\.0\.1|host=\/tmp|@\/|%2Ftmp/.test(url)
  return new Pool({
    connectionString: url,
    max: Number(process.env.CRM_DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    // All SQL in this app is schema-qualified (crm.*) and converts to India time
    // explicitly, so no connection startup options are needed (pooler-safe).
    ssl: local || process.env.CRM_DB_SSL === 'off' ? undefined : { rejectUnauthorized: false },
  })
}

export function pool(): Pool {
  if (!global.__crmPool) global.__crmPool = makePool()
  return global.__crmPool
}

export type Db = Pick<PoolClient, 'query'>

export async function q<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], db?: Db): Promise<T[]> {
  const res = await (db ?? pool()).query<T>(sql, params as any[])
  return res.rows
}

export async function q1<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], db?: Db): Promise<T | null> {
  const rows = await q<T>(sql, params, db)
  return rows[0] ?? null
}

export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** 'missing-config' | 'missing-schema' | 'no-users' | 'ready' */
let upgraded = false
/** Once the CRM exists, newer additive migrations (004+) are applied automatically, once per server instance. */
async function ensureUpgrades() {
  if (upgraded) return
  const { applyMigrations } = await import('./migrate')
  await applyMigrations(pool())
  upgraded = true
}

export async function setupState(): Promise<'missing-config' | 'missing-schema' | 'no-users' | 'ready'> {
  if (!isDbConfigured()) return 'missing-config'
  if (crmEnv() !== 'production') {
    // Safety net: a test copy must never run against the live database (which has the old CRM's tables).
    const live = await q1<{ live: boolean }>(`SELECT to_regclass('public.proposals') IS NOT NULL AS live`)
    if (live?.live) throw new Error('Refusing to start: this test copy is connected to a database that contains the live CRM tables. Use the separate test database.')
  }
  // crm.app_secrets comes from the newest migration (003); if it is missing the tables need creating/updating.
  const s = await q1<{ ok: boolean }>(`SELECT to_regclass('crm.app_users') IS NOT NULL AND to_regclass('crm.app_secrets') IS NOT NULL AS ok`)
  if (!s?.ok) return 'missing-schema'
  await ensureUpgrades()
  const u = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.app_users`)
  return u && u.n > 0 ? 'ready' : 'no-users'
}

export function isPgError(err: unknown, code: string): err is { code: string; detail?: string; constraint?: string; message: string } {
  return typeof err === 'object' && err !== null && (err as any).code === code
}
