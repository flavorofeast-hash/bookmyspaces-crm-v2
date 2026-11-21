import { redirect } from 'next/navigation'
import { BookingConflictError } from './bookings'
import { DuplicateCustomerError } from './customers'
import { fmtDateTime } from './format'

export function withParam(url: string, key: string, value: string): string {
  const [beforeHash, hash] = url.split('#')
  const [path, query = ''] = beforeHash.split('?')
  const p = new URLSearchParams(query)
  p.delete('ok'); p.delete('err')
  p.set(key, value)
  return `${path}?${p.toString()}${hash ? `#${hash}` : ''}`
}

export function errorMessage(e: unknown): string {
  if (e instanceof BookingConflictError) {
    return 'Double booking prevented. ' + e.conflicts.map((c) => `${c.space} is already booked by ${c.ref} (${c.customer}, ${fmtDateTime(c.start_at)} – ${fmtDateTime(c.end_at)})`).join('; ') + '.'
  }
  if (e instanceof DuplicateCustomerError) return e.message
  if (e instanceof Error) {
    // Hide raw database internals; keep our own plain-language messages.
    if ((e as any).code && /^[0-9A-Z]{5}$/.test((e as any).code)) return 'The change could not be saved because it breaks a data rule. Please check the values and try again.'
    return e.message
  }
  return 'Something went wrong.'
}

/**
 * Runs a server-action body and redirects back with ?ok= or ?err=.
 * fn may return a different destination (e.g. the new record's page).
 */
export async function run(back: string, okMessage: string, fn: () => Promise<string | void>): Promise<never> {
  let dest: string
  try {
    const to = await fn()
    dest = withParam(to || back, 'ok', okMessage)
  } catch (e) {
    console.error('[action]', e)
    dest = withParam(back, 'err', errorMessage(e))
    if (e instanceof DuplicateCustomerError) dest = withParam(`/customers/${e.existingId}`, 'err', `${e.message}. You are now on their record.`)
  }
  redirect(dest)
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
export const num = (f: FormData, k: string) => { const v = str(f, k); return v === '' ? null : Number(v) }
export const safeBack = (f: FormData, fallback: string) => { const b = str(f, 'back'); return b.startsWith('/') && !b.startsWith('//') ? b : fallback }
