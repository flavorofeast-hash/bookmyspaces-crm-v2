/**
 * Canonical phone format used everywhere in the CRM: digits only, Indian
 * numbers as 91XXXXXXXXXX. Returns null when the input has no usable number.
 *   "+91 98300 12345" -> "919830012345"
 *   "098300 12345"    -> "919830012345"
 *   "9830012345"      -> "919830012345"
 *   "919830012345"    -> "919830012345"
 *   "+1 555 123 4567" -> "15551234567"   (non-Indian numbers kept as given)
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  const hadPlus = input.trim().startsWith('+')
  let d = input.replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10 && /^[6-9]/.test(d) && !hadPlus) return '91' + d
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length >= 8 && d.length <= 15) return d
  return null
}

export function formatPhone(p: string | null | undefined): string {
  if (!p) return ''
  if (p.length === 12 && p.startsWith('91')) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`
  return '+' + p
}

export function waLink(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null
  return `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}
