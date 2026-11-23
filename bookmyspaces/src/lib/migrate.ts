import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import type { Pool } from 'pg'

// Applies db/migrations/*.sql in order, each in its own transaction, recording
// what was applied in crm.schema_migrations. Only ever creates objects inside
// the "crm" schema; legacy tables in "public" are never modified.

export function migrationsDir(): string {
  return path.join(process.cwd(), 'db', 'migrations')
}

export function migrationFiles(dir = migrationsDir()): string[] {
  return readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
}

export async function applyMigrations(pool: Pool, dir = migrationsDir()): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS crm`)
    await client.query(`CREATE TABLE IF NOT EXISTS crm.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
    const done = new Set((await client.query(`SELECT version FROM crm.schema_migrations`)).rows.map((r) => r.version))
    for (const f of files) {
      if (done.has(f)) continue
      const sql = readFileSync(path.join(dir, f), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(`INSERT INTO crm.schema_migrations (version) VALUES ($1)`, [f])
        await client.query('COMMIT')
        applied.push(f)
      } catch (e) {
        await client.query('ROLLBACK')
        // Another server instance applied the same migration at the same moment: that is fine.
        if ((await client.query(`SELECT 1 FROM crm.schema_migrations WHERE version = $1`, [f])).rowCount) continue
        throw new Error(`Migration ${f} failed and was rolled back: ${(e as Error).message}`)
      }
    }
  } finally {
    client.release()
  }
  return applied
}
