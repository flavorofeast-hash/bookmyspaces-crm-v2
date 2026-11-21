export const TZ = 'Asia/Kolkata'

export function inr(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })
}

const dFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' })
const dtFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const tFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })

export const fmtDate = (d: Date | string | null | undefined) => (d ? dFmt.format(new Date(d)) : '')
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? dtFmt.format(new Date(d)) : '')
export const fmtTime = (d: Date | string | null | undefined) => (d ? tFmt.format(new Date(d)) : '')
export const fmtDay = (d: Date | string | null | undefined) => (d ? dayFmt.format(new Date(d)) : '')

/** YYYY-MM-DD for "today" (or a given instant) in India time. */
export function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Combine an India-time date and time ("2026-12-05", "16:00") into a Date. */
export function istToDate(date: string, time: string): Date {
  const t = time.length === 5 ? `${time}:00` : time
  return new Date(`${date}T${t}+05:30`)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00+05:30`)
  d.setUTCDate(d.getUTCDate() + days)
  return istDate(d)
}

export function nightsBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000)
}

export const STATUS_LABEL: Record<string, string> = {
  enquiry: 'Enquiry', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled',
}

export const BOOKING_TYPE_LABEL: Record<string, string> = {
  room_stay: 'Room stay', event: 'Event', event_with_stay: 'Event + rooms',
}

export const SOURCE_LABEL: Record<string, string> = {
  walk_in: 'Walk-in', phone_call: 'Phone call', whatsapp: 'WhatsApp', website: 'Website', facebook: 'Facebook',
  instagram: 'Instagram', google: 'Google', referral: 'Referral', justdial: 'JustDial', campaign: 'Campaign',
  import: 'Imported', other: 'Other',
}

export const EVENT_TYPES = [
  'Family gathering', "Friends' reunion", 'Haldi', 'Mehendi', 'Pre-wedding', 'Wedding guest stay', 'Birthday',
  'Anniversary', 'Corporate', 'Kitty party', 'Other',
]

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', card: 'Card', cheque: 'Cheque', other: 'Other',
}

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  advance: 'Advance', balance: 'Balance payment', payment: 'Payment', refund: 'Refund',
}

export const DOC_LABEL: Record<string, string> = {
  quotation: 'Quotation', bill: 'Bill', receipt: 'Receipt', refund: 'Refund note',
}
