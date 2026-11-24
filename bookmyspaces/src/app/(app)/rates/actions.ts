'use server'

import { requireUser } from '@/lib/auth'
import { setRate } from '@/lib/rates'
import { q } from '@/lib/db'
import { run, str } from '@/lib/action'

const B = '/rates'
const num = (v: string) => (v === '' ? null : Number(v))

/** Standard + Mon–Sun rates for one room/space. Every value is checked against the range before anything is saved. */
export async function saveWeekRatesAction(f: FormData) {
  const u = await requireUser()
  const spaceId = str(f, 'space_id')
  await run(`${B}#s-${spaceId}`, 'Rates saved.', async () => {
    const sp = (await q<{ name: string; price: string | null; min_price: string | null; max_price: string | null }>(`SELECT name, price, min_price, max_price FROM crm.spaces WHERE id = $1`, [spaceId]))[0]
    if (!sp) throw new Error('Room or space not found.')
    const cur = await q<{ weekday: number; price: string }>(`SELECT weekday, price FROM crm.space_rates WHERE space_id = $1 AND weekday IS NOT NULL`, [spaceId])
    const wanted: { kind: 'standard' | 'weekday'; weekday?: number; price: number | null; old: number | null }[] = [
      { kind: 'standard', price: num(str(f, 'standard')), old: sp.price === null ? null : Number(sp.price) },
      ...[1, 2, 3, 4, 5, 6, 7].map((w) => ({ kind: 'weekday' as const, weekday: w, price: num(str(f, `w${w}`)), old: (() => { const r = cur.find((c) => c.weekday === w); return r ? Number(r.price) : null })() })),
    ]
    const changes = wanted.filter((w) => w.price !== w.old)
    if (!changes.length) return
    if (sp.min_price === null || sp.max_price === null) throw new Error(`The owner has not set a minimum and maximum price for ${sp.name} yet (Settings → Rooms & spaces).`)
    for (const c of changes) if (c.price !== null && (!Number.isFinite(c.price) || c.price < Number(sp.min_price) || c.price > Number(sp.max_price)))
      throw new Error(`₹${c.price} is outside the allowed range for ${sp.name} (₹${Number(sp.min_price)} – ₹${Number(sp.max_price)}). Nothing was saved.`)
    for (const c of changes) await setRate(u, spaceId, c.kind, c.price, { weekday: c.weekday })
  })
}

export async function saveDateRateAction(f: FormData) {
  const u = await requireUser()
  await run(`${B}#dates`, 'Date rate saved.', async () => {
    const price = num(str(f, 'price'))
    if (price === null) throw new Error('Enter a rate.')
    await setRate(u, str(f, 'space_id'), 'date', price, { onDate: str(f, 'on_date') })
  })
}

export async function removeDateRateAction(f: FormData) {
  const u = await requireUser()
  await run(`${B}#dates`, 'Date rate removed.', async () => { await setRate(u, str(f, 'space_id'), 'date', null, { onDate: str(f, 'on_date') }) })
}
