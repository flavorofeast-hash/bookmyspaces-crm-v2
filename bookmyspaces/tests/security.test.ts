import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { resetDb, closePool } from './helpers'
import { q, q1, pool } from '@/lib/db'
import { applyMigrations } from '@/lib/migrate'

// next/headers only works inside a request; give the auth module a fake cookie jar.
const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => { jar.set(k, v) },
    delete: (k: string) => { jar.delete(k) },
  }),
}))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error('REDIRECT:' + to) } }))

import { attemptLogin, getCurrentUser, requireOwner, makeSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { createUser, setUserPassword, setUserActive } from '@/lib/setup'

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
let ownerId = '', staffId = ''

beforeAll(async () => {
  await resetDb()
  ownerId = (await createUser(form({ name: 'Owner', email: 'owner@test.in', password: 'Owner@12345' }), 'owner')).id
  staffId = (await createUser(form({ name: 'Staff', email: 'staff@test.in', password: 'Staff@12345', role: 'staff' }))).id
})
afterAll(closePool)

describe('login and sessions', () => {
  it('logs in with the right password and sets a signed, httpOnly-style session cookie', async () => {
    jar.clear()
    const r = await attemptLogin('Owner@Test.in ', 'Owner@12345') // email case/spaces tolerated
    expect(typeof r).toBe('object')
    expect(jar.get(SESSION_COOKIE)).toMatch(/^[\w-]+\.[\w-]+$/)
    expect((await getCurrentUser())?.id).toBe(ownerId)
  })

  it('refuses a wrong password with a message that does not reveal whether the email exists', async () => {
    expect(await attemptLogin('owner@test.in', 'nope')).toBe('Email or password is incorrect.')
    expect(await attemptLogin('nobody@test.in', 'nope')).toBe('Email or password is incorrect.')
  })

  it('locks an email after 10 failures in 15 minutes, even if the 11th password is right', async () => {
    await q(`DELETE FROM crm.login_failures`)
    for (let i = 0; i < 10; i++) await attemptLogin('staff@test.in', 'wrong-' + i)
    expect(await attemptLogin('staff@test.in', 'Staff@12345')).toMatch(/Too many failed attempts/)
    await q(`UPDATE crm.login_failures SET at = now() - interval '16 minutes'`)
    expect(typeof (await attemptLogin('staff@test.in', 'Staff@12345'))).toBe('object')
  })

  it('a forged or tampered cookie is not accepted', async () => {
    const good = makeSessionToken(staffId, 1)
    const [, sig] = good.split('.')
    jar.set(SESSION_COOKIE, Buffer.from(JSON.stringify({ u: ownerId, v: 1, e: Date.now() + 1e9 })).toString('base64url') + '.' + sig)
    expect(await getCurrentUser()).toBeNull()
    jar.set(SESSION_COOKIE, 'garbage')
    expect(await getCurrentUser()).toBeNull()
  })

  it('changing a password signs out existing sessions', async () => {
    jar.clear()
    await attemptLogin('owner@test.in', 'Owner@12345')
    const old = jar.get(SESSION_COOKIE)!
    await setUserPassword(ownerId, 'NewOwner@123')
    jar.set(SESSION_COOKIE, old)
    expect(await getCurrentUser()).toBeNull()
    expect(await attemptLogin('owner@test.in', 'Owner@12345')).toBe('Email or password is incorrect.')
    expect(typeof (await attemptLogin('owner@test.in', 'NewOwner@123'))).toBe('object')
  })

  it('a deactivated user is signed out and cannot log in; the last owner cannot be deactivated', async () => {
    jar.clear()
    await attemptLogin('staff@test.in', 'Staff@12345')
    const staffCookie = jar.get(SESSION_COOKIE)!
    await setUserActive(staffId, false, ownerId)
    jar.set(SESSION_COOKIE, staffCookie)
    expect(await getCurrentUser()).toBeNull()
    expect(await attemptLogin('staff@test.in', 'Staff@12345')).toBe('Email or password is incorrect.')
    await expect(setUserActive(ownerId, false, staffId)).rejects.toThrow(/At least one active owner/)
    await expect(setUserActive(ownerId, false, ownerId)).rejects.toThrow(/your own account/)
  })

  it('staff are refused owner-only actions on the server', async () => {
    await setUserActive(staffId, true, ownerId)
    jar.clear()
    await attemptLogin('staff@test.in', 'Staff@12345')
    await expect(requireOwner()).rejects.toThrow(/REDIRECT:\/today\?err=/)
  })

  it('passwords are stored only as salted scrypt hashes', async () => {
    const rows = await q<{ password_hash: string }>(`SELECT password_hash FROM crm.app_users`)
    for (const r of rows) { expect(r.password_hash.startsWith('scrypt$')).toBe(true); expect(r.password_hash).not.toContain('Staff@12345') }
    expect(new Set(rows.map((r) => r.password_hash.split('$')[1])).size).toBe(rows.length) // unique salts
  })
})

describe('database permissions (Supabase roles)', () => {
  it('anon and authenticated roles cannot read or write any CRM table, even with Supabase-style default grants', async () => {
    for (const r of ['anon', 'authenticated']) {
      const ex = await q1(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [r])
      if (!ex) await q(`CREATE ROLE ${r} NOLOGIN`)
      await q(`GRANT USAGE ON SCHEMA public TO ${r}`)
    }
    // Simulate a dangerous broad default (as some Supabase projects have for public) and re-run the migrations.
    await q(`ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated`)
    await q(`DROP SCHEMA crm CASCADE`)
    await applyMigrations(pool())
    const client = await pool().connect()
    try {
      for (const role of ['anon', 'authenticated']) {
        await client.query(`SET ROLE ${role}`)
        for (const sql of [`SELECT * FROM crm.customers`, `SELECT * FROM crm.payments`, `INSERT INTO crm.customers (name) VALUES ('x')`, `SELECT crm.next_number('receipt','RCP')`]) {
          await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' }) // permission denied
        }
        await client.query(`RESET ROLE`)
      }
    } finally {
      await client.query(`RESET ROLE`).catch(() => {})
      client.release()
      await q(`ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM anon, authenticated`)
    }
    const noRls = await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'crm' AND NOT rowsecurity`)
    expect(noRls).toEqual([])
  })

  it('the server connection (table owner) still works normally', async () => {
    const id = (await createUser(form({ name: 'Owner2', email: 'o2@test.in', password: 'Owner2@1234' }), 'owner')).id
    expect(id).toBeTruthy()
  })
})
