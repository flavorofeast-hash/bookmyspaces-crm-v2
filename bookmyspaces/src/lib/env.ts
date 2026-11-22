// Where is this copy of the CRM running? Vercel sets VERCEL_ENV automatically
// (production / preview / development). CRM_ENV can override it (e.g. in tests).
export type CrmEnv = 'production' | 'preview' | 'development'

export function crmEnv(): CrmEnv {
  const v = (process.env.CRM_ENV || process.env.VERCEL_ENV || '').toLowerCase()
  if (v === 'preview') return 'preview'
  if (v === 'development') return 'development'
  if (v === 'production') return 'production'
  return process.env.NODE_ENV === 'production' ? 'production' : 'development'
}

export const isProduction = () => crmEnv() === 'production'

/** The one-click admin/admin login is only for test copies (Preview / local). */
export const allowsDefaultAdmin = () => !isProduction()

const WEAK = new Set(['admin', 'password', 'password1', '12345678', '123456789', '1234567890', 'admin123', 'admin@123', 'bookmyspaces', 'qwerty123'])

/** Production passwords: at least 10 characters and not a common/default password. */
export function passwordProblem(pw: string, username = ''): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.'
  if (WEAK.has(pw.toLowerCase()) || pw.toLowerCase() === username.toLowerCase()) return 'That password is too easy to guess.'
  return null
}

/** True only on a Vercel Preview deployment. */
export const onVercelPreview = () => (process.env.VERCEL_ENV || '').toLowerCase() === 'preview'

/**
 * WhatsApp/Meta settings. On a Vercel Preview the normal (live) variables are IGNORED, even if
 * they are set for "All Environments" — only PREVIEW_-prefixed test values are used. This makes
 * it impossible for a Preview to send through, or accept webhooks for, the live number.
 */
export function metaEnv(name: string): string | undefined {
  const v = onVercelPreview() ? process.env['PREVIEW_' + name] : process.env[name]
  return v ? v : undefined
}

/** Removes connection-string options node-postgres does not understand (Supabase/Vercel add them). */
function cleanUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const k of ['sslmode', 'supa', 'pgbouncer', 'sslrootcert', 'uselibpqcompat']) u.searchParams.delete(k)
    return u.toString()
  } catch { return url }
}

/**
 * Database address. CRM_DATABASE_URL always wins. Otherwise:
 *  - Preview: only the test database created through Vercel's Supabase integration (prefix CRMTEST).
 *  - Production: POSTGRES_URL from the production Supabase project's Vercel integration.
 * A Preview never reads POSTGRES_URL, so it can never reach the production database by accident.
 */
export function databaseUrl(): string | undefined {
  const raw = process.env.CRM_DATABASE_URL
    || (onVercelPreview() ? process.env.CRMTEST_POSTGRES_URL : undefined)
    || (crmEnv() === 'production' && !onVercelPreview() ? process.env.POSTGRES_URL : undefined)
  return raw ? cleanUrl(raw) : undefined
}

/** This site's public address: APP_PUBLIC_URL, else the address Vercel provides. */
export function appPublicUrl(): string | undefined {
  const v = process.env.APP_PUBLIC_URL
    || (onVercelPreview() ? process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL : process.env.VERCEL_PROJECT_PRODUCTION_URL)
  if (!v) return undefined
  return (/^https?:\/\//.test(v) ? v : 'https://' + v).replace(/\/$/, '')
}
