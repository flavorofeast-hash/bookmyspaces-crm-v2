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
