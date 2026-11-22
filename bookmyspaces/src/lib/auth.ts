import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { q, q1 } from './db'
import { hashPassword, verifyPassword } from './password'
import { isProduction, passwordProblem } from './env'
export { hashPassword, verifyPassword }

export const SESSION_COOKIE = 'bms_session'
const SESSION_DAYS = 30

export type User = { id: string; email: string; name: string; role: 'owner' | 'staff'; uses_default_password?: boolean }

let cachedSecret: string | null = null

/**
 * Session-signing key. Uses SESSION_SECRET when set (32+ characters); otherwise a
 * random 48-byte key is generated once and kept in crm.app_secrets, readable only
 * by the server's database connection. Never sent to the browser.
 */
async function secret(): Promise<string> {
  const env = process.env.SESSION_SECRET
  if (env) {
    if (env.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
    return env
  }
  if (cachedSecret) return cachedSecret
  await q(`INSERT INTO crm.app_secrets (name, value) VALUES ('session_secret', $1) ON CONFLICT (name) DO NOTHING`, [randomBytes(48).toString('base64url')])
  cachedSecret = (await q1<{ value: string }>(`SELECT value FROM crm.app_secrets WHERE name = 'session_secret'`))!.value
  return cachedSecret
}

/** For tests only. */
export function _resetSecretCache() { cachedSecret = null }

async function sign(payload: string): Promise<string> {
  return createHmac('sha256', await secret()).update(payload).digest('base64url')
}

export async function makeSessionToken(userId: string, version: number, now = Date.now()): Promise<string> {
  const body = Buffer.from(JSON.stringify({ u: userId, v: version, e: now + SESSION_DAYS * 86_400_000 })).toString('base64url')
  return `${body}.${await sign(body)}`
}

export async function readSessionToken(token: string | undefined, now = Date.now()): Promise<{ u: string; v: number } | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = await sign(body)
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (typeof data.e !== 'number' || data.e < now) return null
    return { u: String(data.u), v: Number(data.v) }
  } catch {
    return null
  }
}

export async function getCurrentUser(): Promise<User | null> {
  const s = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value)
  if (!s) return null
  return q1<User>(
    `SELECT id, email, name, role, uses_default_password FROM crm.app_users WHERE id = $1 AND active AND session_version = $2`,
    [s.u, s.v],
  )
}

export async function requireUser(): Promise<User> {
  const u = await getCurrentUser()
  if (!u) redirect('/login')
  return u
}

export async function requireOwner(): Promise<User> {
  const u = await requireUser()
  if (u.role !== 'owner') redirect('/today?err=' + encodeURIComponent('Only the owner can do that.'))
  return u
}

export async function setSessionCookie(userId: string, version: number) {
  ;(await cookies()).set(SESSION_COOKIE, await makeSessionToken(userId, version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
}

export async function clearSessionCookie() {
  ;(await cookies()).delete(SESSION_COOKIE)
}

/** Returns the user on success, or an error message. Locks an email after 10 failures in 15 minutes. */
export async function attemptLogin(emailRaw: string, password: string): Promise<User | string> {
  const email = emailRaw.trim().toLowerCase()
  const recent = await q1<{ n: number }>(
    `SELECT count(*)::int AS n FROM crm.login_failures WHERE email = $1 AND at > now() - interval '15 minutes'`, [email])
  if ((recent?.n ?? 0) >= 10) return 'Too many failed attempts. Please wait 15 minutes and try again.'
  const row = await q1<User & { password_hash: string; session_version: number; active: boolean; uses_default_password: boolean }>(
    `SELECT id, email, name, role, password_hash, session_version, active, uses_default_password FROM crm.app_users WHERE email = $1`, [email])
  const ok = row && row.active && (await verifyPassword(password, row.password_hash))
  if (!ok || !row) {
    await q(`INSERT INTO crm.login_failures (email) VALUES ($1)`, [email])
    return 'Username or password is incorrect.'
  }
  if (isProduction() && (row.uses_default_password || passwordProblem(password, row.email))) {
    return 'This password is only allowed on the test copy. The live CRM needs a strong password — set it with “npm run db:set-password” or on the test copy before going live.'
  }
  await q(`UPDATE crm.app_users SET last_login_at = now() WHERE id = $1`, [row.id])
  await q(`DELETE FROM crm.login_failures WHERE email = $1`, [email])
  await setSessionCookie(row.id, row.session_version)
  return { id: row.id, email: row.email, name: row.name, role: row.role }
}
