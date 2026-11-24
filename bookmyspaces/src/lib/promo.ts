import { createHash, randomBytes } from 'crypto'
import { q, q1, tx } from './db'
import { logActivity } from './activity'

// ── Promotion types ────────────────────────────────────────────────────────────
// Copy is deliberately generic: facilities, prices and offers come only from the property's own settings
// and the owner-approved catalogue, never from these templates.

export type PromoType = 'rooms' | 'rooftop' | 'celebrations' | 'dining' | 'hall' | 'cafe' | 'seasonal'
type Copy = { en: string[]; bn: string[]; bodyEn: string; bodyBn: string; tags: string[]; cats: string[]; needs?: 'room' | 'rooftop' | 'hall' | 'hall_or_rooftop' | 'food' }

export const PROMO_TYPES: Record<PromoType, { label: string } & Copy> = {
  rooms: { label: 'Room accommodation', needs: 'room', cats: ['rooms', 'exterior'],
    en: ['Comfortable rooms in Kolkata', 'Your clean, comfortable stay in Kolkata', 'Stay with us in Kolkata'],
    bn: ['কলকাতায় আরামদায়ক রুম', 'পরিষ্কার, আরামদায়ক থাকা — কলকাতায়', 'কলকাতায় থাকুন আমাদের সঙ্গে'],
    bodyEn: 'Clean, comfortable, couple-friendly rooms for couples, families and travellers.',
    bodyBn: 'দম্পতি, পরিবার ও ভ্রমণকারীদের জন্য পরিষ্কার ও আরামদায়ক রুম।',
    tags: ['#KolkataHomestay', '#KolkataStay', '#CoupleFriendly', '#RoomsInKolkata'] },
  rooftop: { label: 'Rooftop events', needs: 'rooftop', cats: ['rooftop', 'events', 'cafe'],
    en: ['Celebrate under the open sky', 'Rooftop evenings in Kolkata', 'Your party, on our rooftop'],
    bn: ['খোলা আকাশের নিচে উদযাপন', 'কলকাতার রুফটপে সন্ধ্যা', 'আপনার পার্টি, আমাদের রুফটপে'],
    bodyEn: 'Book our rooftop for birthdays, get-togethers and special evenings.',
    bodyBn: 'জন্মদিন, আড্ডা আর বিশেষ সন্ধ্যার জন্য আমাদের রুফটপ বুক করুন।',
    tags: ['#RooftopParty', '#KolkataRooftop', '#KolkataEvents', '#PartyVenueKolkata'] },
  celebrations: { label: 'Birthday & anniversary celebrations', needs: 'hall_or_rooftop', cats: ['decoration', 'events', 'halls', 'rooftop'],
    en: ['Birthdays & anniversaries, made special', 'Make your celebration memorable', 'Celebrate with the people you love'],
    bn: ['জন্মদিন ও বিবাহবার্ষিকী — আরও বিশেষ', 'আপনার উদযাপন হোক স্মরণীয়', 'প্রিয়জনদের সঙ্গে উদযাপন করুন'],
    bodyEn: 'Space, decoration and food for your birthday or anniversary — ask us for the options.',
    bodyBn: 'জন্মদিন বা বিবাহবার্ষিকীর জন্য জায়গা, সাজসজ্জা ও খাবার — বিস্তারিত জানতে যোগাযোগ করুন।',
    tags: ['#BirthdayParty', '#AnniversaryCelebration', '#KolkataCelebrations', '#PartyVenueKolkata'] },
  dining: { label: 'Private dining', needs: 'food', cats: ['food', 'rooftop', 'cafe', 'decoration'],
    en: ['A private dinner for two', 'Dinner, just the two of you', 'An evening to remember'],
    bn: ['দু’জনের জন্য একান্ত ডিনার', 'শুধু আপনারা দু’জন — একটি বিশেষ সন্ধ্যা', 'মনে রাখার মতো একটি সন্ধ্যা'],
    bodyEn: 'Plan a private dinner for a date night or an anniversary.',
    bodyBn: 'ডেট নাইট বা বিবাহবার্ষিকীর জন্য একান্ত ডিনারের পরিকল্পনা করুন।',
    tags: ['#PrivateDining', '#DateNightKolkata', '#CandlelightDinner', '#KolkataFood'] },
  hall: { label: 'Hall bookings', needs: 'hall', cats: ['halls', 'events', 'decoration'],
    en: ['A hall for your next celebration', 'Book our celebration hall', 'Space for your family function'],
    bn: ['আপনার অনুষ্ঠানের জন্য হল', 'আমাদের সেলিব্রেশন হল বুক করুন', 'পারিবারিক অনুষ্ঠানের জন্য উপযুক্ত জায়গা'],
    bodyEn: 'For birthdays, family gatherings and small functions.',
    bodyBn: 'জন্মদিন, পারিবারিক আড্ডা ও ছোট অনুষ্ঠানের জন্য।',
    tags: ['#PartyHallKolkata', '#BanquetKolkata', '#KolkataEvents', '#FamilyFunction'] },
  cafe: { label: 'Café & food', needs: 'food', cats: ['cafe', 'food'],
    en: ['Coffee, food and rooftop air', 'Your café on the rooftop', 'Good food, good company'],
    bn: ['কফি, খাবার আর রুফটপের হাওয়া', 'রুফটপে আপনার প্রিয় ক্যাফে', 'ভালো খাবার, ভালো আড্ডা'],
    bodyEn: 'Drop in for coffee and a bite with friends.',
    bodyBn: 'বন্ধুদের সঙ্গে কফি আর হালকা খাবারের জন্য চলে আসুন।',
    tags: ['#KolkataCafe', '#RooftopCafe', '#KolkataFood', '#CafeHopping'] },
  seasonal: { label: 'Seasonal / festival', cats: ['rooftop', 'events', 'decoration', 'halls', 'rooms', 'cafe', 'food', 'exterior'],
    en: ['Celebrate {occasion} with us', '{occasion} plans? We have the space', 'This {occasion}, celebrate here'],
    bn: ['{occasion} উদযাপন করুন আমাদের সঙ্গে', '{occasion}-এর পরিকল্পনা? জায়গা আমাদের কাছে', 'এবারের {occasion} কাটান আমাদের সঙ্গে'],
    bodyEn: 'Plan your stay, party or dinner with us this season.',
    bodyBn: 'এই উৎসবে থাকা, পার্টি বা ডিনারের পরিকল্পনা করুন আমাদের সঙ্গে।',
    tags: ['#KolkataFestivals', '#FestiveSeason', '#KolkataEvents'] },
}

export const MEDIA_CATEGORIES = ['rooms', 'rooftop', 'halls', 'food', 'cafe', 'decoration', 'events', 'exterior', 'other'] as const

export type Property = { id: string; name: string; promo_phones: string | null; promo_whatsapp: string | null; promo_location: string | null; promo_highlights: string | null; promo_contacts_confirmed: boolean }

/** Which promotion types a property can honestly offer, based on its real rooms/spaces and settings. */
export async function availableTypes(propertyId: string): Promise<PromoType[]> {
  const r = await q1<{ room: boolean; rooftop: boolean; hall: boolean; food: boolean }>(
    `SELECT bool_or(s.kind = 'room') AS room, bool_or(s.kind = 'rooftop') AS rooftop, bool_or(s.kind = 'hall') AS hall,
            (SELECT p.food_packages_enabled OR COALESCE(p.promo_highlights,'') ~* '(caf|dining|food)' FROM crm.properties p WHERE p.id = $1) AS food
     FROM crm.spaces s WHERE s.property_id = $1 AND s.active`, [propertyId])
  return (Object.keys(PROMO_TYPES) as PromoType[]).filter((t) => {
    const n = PROMO_TYPES[t].needs
    if (!n) return true
    if (n === 'hall_or_rooftop') return !!(r?.hall || r?.rooftop)
    return !!(r as any)?.[n]
  })
}

const fill = (s: string, occasion: string) => s.replaceAll('{occasion}', occasion || 'the festive season')
const digits = (s: string | null) => (s ?? '').replace(/\D/g, '')
const spaced = (n: string) => n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : n

export type Captions = {
  headlineEn: string; headlineBn: string; social: string; whatsapp: string; group: string; classified: string; hashtags: string
  contactLine: string; offerLine: string | null; code: string; waLink: string | null
}

export function buildCaptions(o: { type: PromoType; variant: number; language: 'en' | 'bn' | 'both'; occasion?: string; property: Property; offerLine: string | null; code: string; link: string | null }): Captions {
  const T = PROMO_TYPES[o.type], v = o.variant % 3, p = o.property
  const hEn = fill(T.en[v], o.occasion ?? ''), hBn = fill(T.bn[v], o.occasion ?? '')
  const wa = digits(p.promo_whatsapp)
  const waLink = wa ? `https://wa.me/91${wa.slice(-10)}?text=${encodeURIComponent(`Hi! I saw your ${p.name} post (${o.code}). Please share details.`)}` : null
  const contactLine = [p.promo_phones ? `📞 ${p.promo_phones}` : null, wa ? `WhatsApp ${spaced(wa.slice(-10))}` : null].filter(Boolean).join(' · ')
  const loc = p.promo_location ? `📍 ${p.name}, ${p.promo_location}` : `📍 ${p.name}`
  const hi = p.promo_highlights ? `✨ ${p.promo_highlights}` : null
  const offerEn = o.offerLine ? `🎁 ${o.offerLine}` : 'Ask us for current rates and availability.'
  const offerBn = o.offerLine ? `🎁 ${o.offerLine}` : 'বর্তমান রেট ও ফাঁকা তারিখ জানতে যোগাযোগ করুন।'
  const ctaEn = `Message us on WhatsApp to check dates and book. Mention code ${o.code}.`
  const ctaBn = `তারিখ জানতে ও বুক করতে হোয়াটসঅ্যাপে মেসেজ করুন। কোড ${o.code} লিখুন।`
  const placeTags = [/mukundapur/i.test(p.promo_location ?? '') ? '#Mukundapur' : null, /bypass/i.test(p.promo_location ?? '') ? '#EMBypass' : null,
    /airport/i.test(p.promo_location ?? '') ? '#KolkataAirport' : null, /jessore/i.test(p.promo_location ?? '') ? '#JessoreRoad' : null].filter(Boolean)
  const hashtags = ['#Kolkata', `#${p.name.replace(/[^A-Za-z0-9]/g, '')}`, '#BookMySpaces', ...T.tags, ...placeTags].join(' ')
  const en = [hEn, T.bodyEn, loc, hi, offerEn, ctaEn, contactLine, o.link].filter(Boolean).join('\n')
  const bn = [hBn, T.bodyBn, loc, hi, offerBn, ctaBn, contactLine, o.link].filter(Boolean).join('\n')
  const pick = (a: string, b: string) => o.language === 'en' ? a : o.language === 'bn' ? b : `${a}\n\n${b}`
  const social = `${pick(en, bn)}\n\n${hashtags}`
  const whatsapp = pick(
    `Hello! 🙏 ${hEn} at ${p.name}.\n${T.bodyEn}\n${offerEn}\n${waLink ? `Reply here or tap: ${waLink}` : contactLine}`,
    `নমস্কার! 🙏 ${hBn} — ${p.name}।\n${T.bodyBn}\n${offerBn}\n${waLink ? `উত্তর দিন অথবা ট্যাপ করুন: ${waLink}` : contactLine}`)
  const group = pick(
    `Hello everyone 🙏 Sharing for anyone looking for ${T.label.toLowerCase()} in Kolkata.\n${p.name} — ${T.bodyEn}\n${loc}\n${hi ?? ''}\n${offerEn}\n${contactLine}\n(Admins, please remove if this is not allowed here.)`,
    `সবাইকে নমস্কার 🙏 কলকাতায় যাঁরা খুঁজছেন তাঁদের জন্য — ${p.name}।\n${T.bodyBn}\n${loc}\n${hi ?? ''}\n${offerBn}\n${contactLine}\n(এখানে অনুমতি না থাকলে অ্যাডমিনরা পোস্টটি সরিয়ে দিন।)`).replace(/\n{2,}/g, '\n')
  const classified = [`Title: ${p.name} — ${hEn}${p.promo_location ? ` | ${p.promo_location}` : ''}`,
    `Description: ${T.bodyEn}${p.promo_highlights ? ` Highlights: ${p.promo_highlights}.` : ''} ${o.offerLine ?? 'Rates on request.'}`,
    `Contact: ${contactLine || 'see profile'}`, o.link ? `Website: ${o.link}` : null, `Reference: ${o.code}`].filter(Boolean).join('\n')
  return { headlineEn: hEn, headlineBn: hBn, social, whatsapp, group, classified, hashtags, contactLine, offerLine: o.offerLine, code: o.code, waLink }
}

// ── Offers come only from the approved catalogue or set room rates ─────────────

export type OfferChoice = { key: string; label: string; line: string }

export async function offerChoices(propertyId: string): Promise<OfferChoice[]> {
  const out: OfferChoice[] = []
  const rate = await q1<{ from: string | null }>(`SELECT min(price)::text AS from FROM crm.spaces WHERE property_id = $1 AND active AND kind = 'room' AND price IS NOT NULL AND price_unit IS NOT NULL`, [propertyId])
  if (rate?.from) out.push({ key: 'rate', label: `Rooms from ₹${Number(rate.from).toLocaleString('en-IN')} (current standard rate)`, line: `Rooms from ₹${Number(rate.from).toLocaleString('en-IN')} per night` })
  const pk = await q<any>(`SELECT id, name, price, price_basis, inclusions FROM crm.packages WHERE active AND review_status = 'approved' AND (property_id = $1 OR property_id IS NULL) ORDER BY name`, [propertyId])
  for (const p of pk) {
    const price = `₹${Number(p.price).toLocaleString('en-IN')}${p.price_basis === 'per_person' ? ' per guest' : ''}`
    const inc = (p.inclusions ?? []).slice(0, 3).join(', ')
    out.push({ key: `package:${p.id}`, label: `${p.name} — ${price}`, line: `${p.name}: ${price}${inc ? ` (includes ${inc})` : ''}` })
  }
  const ad = await q<any>(`SELECT id, name, price_min, price_max, unit FROM crm.addons WHERE active AND review_status = 'approved' AND (property_id = $1 OR property_id IS NULL) ORDER BY name`, [propertyId])
  for (const a of ad) {
    const pr = Number(a.price_min) === Number(a.price_max) ? `₹${Number(a.price_min).toLocaleString('en-IN')}` : `from ₹${Number(a.price_min).toLocaleString('en-IN')}`
    out.push({ key: `addon:${a.id}`, label: `${a.name} — ${pr}`, line: `${a.name}: ${pr}${a.unit === 'per_person' ? ' per guest' : ''}` })
  }
  return out
}

// ── Promotions ─────────────────────────────────────────────────────────────────

async function pickPhotos(propertyId: string, type: PromoType, n = 8): Promise<string[]> {
  const cats = PROMO_TYPES[type].cats
  const rows = await q<{ id: string }>(
    `SELECT id FROM crm.media WHERE approved AND archived_at IS NULL AND NOT has_text_overlay AND (property_id = $1 OR property_id IS NULL)
     ORDER BY (category = ANY($2::text[])) DESC, (property_id = $1) DESC, last_used_at NULLS FIRST, created_at LIMIT $3`, [propertyId, cats, n])
  return rows.map((r) => r.id)
}

function makeCode(propertyName: string, type: PromoType): string {
  const p = propertyName.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2) || 'BM'
  const t = { rooms: 'RM', rooftop: 'RT', celebrations: 'CB', dining: 'DN', hall: 'HL', cafe: 'CF', seasonal: 'SN' }[type]
  return `${p}${t}${randomBytes(3).toString('hex').toUpperCase().slice(0, 4)}`
}

export async function createPromotion(input: { propertyId: string; type: PromoType; language: 'en' | 'bn' | 'both'; offerKey?: string | null; occasion?: string | null; mediaIds?: string[]; plannedFor?: string | null }, userId?: string | null): Promise<string> {
  const prop = await q1<Property>(`SELECT * FROM crm.properties WHERE id = $1 AND active`, [input.propertyId])
  if (!prop) throw new Error('Choose a property.')
  if (!PROMO_TYPES[input.type]) throw new Error('Choose a promotion type.')
  if (!(await availableTypes(prop.id)).includes(input.type)) throw new Error(`${prop.name} has no ${PROMO_TYPES[input.type].label.toLowerCase()} set up, so this promotion would not be true.`)
  if (input.type === 'seasonal' && !input.occasion?.trim()) throw new Error('Type the occasion (e.g. Christmas).')
  let offerLine: string | null = null, packageId: string | null = null, addonId: string | null = null
  if (input.offerKey) {
    const c = (await offerChoices(prop.id)).find((x) => x.key === input.offerKey)
    if (!c) throw new Error('That offer is no longer approved in the catalogue.')
    offerLine = c.line
    if (c.key.startsWith('package:')) packageId = c.key.slice(8)
    if (c.key.startsWith('addon:')) addonId = c.key.slice(6)
  }
  const media = input.mediaIds?.length ? input.mediaIds : await pickPhotos(prop.id, input.type)
  if (!media.length) throw new Error(`There are no approved photos for ${prop.name} yet. Approve some in Marketing → Gallery first.`)
  const ok = await q<{ id: string }>(`SELECT id FROM crm.media WHERE id = ANY($1::uuid[]) AND approved AND archived_at IS NULL AND NOT has_text_overlay`, [media])
  if (ok.length !== media.length) throw new Error('Only photos approved for promotion can be used.')
  const prev = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM crm.promotions WHERE property_id = $1 AND promo_type = $2`, [prop.id, input.type])
  const variant = prev?.n ?? 0
  const link = 'https://www.bookmyspaces.in'
  return tx(async (db) => {
    let code = makeCode(prop.name, input.type)
    while (await q1(`SELECT 1 FROM crm.campaigns WHERE code = $1`, [code], db)) code = makeCode(prop.name, input.type)
    const caps = buildCaptions({ type: input.type, variant, language: input.language, occasion: input.occasion ?? '', property: prop, offerLine, code, link })
    const camp = await q1<{ id: string }>(`INSERT INTO crm.campaigns (name, code, channel, starts_on, notes) VALUES ($1,$2,'Promotion',$3,$4) RETURNING id`,
      [`${prop.name} — ${PROMO_TYPES[input.type].label}${input.occasion ? ` (${input.occasion})` : ''}`, code, input.plannedFor || null, 'Created by Promotion Studio'], db)
    const r = await q1<{ id: string }>(
      `INSERT INTO crm.promotions (property_id, promo_type, language, headline, offer_line, package_id, addon_id, media_ids, captions, variant, campaign_id, link, platforms, planned_for, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [prop.id, input.type, input.language, caps.headlineEn, offerLine, packageId, addonId, media, JSON.stringify({ ...caps, occasion: input.occasion ?? null }), variant, camp!.id, link,
        ['facebook', 'instagram', 'whatsapp', 'facebook_group', 'classified'], input.plannedFor || null, userId ?? null], db)
    await q(`UPDATE crm.media SET last_used_at = now() WHERE id = ANY($1::uuid[])`, [media], db)
    await q(`INSERT INTO crm.promotion_events (promotion_id, kind, user_id) VALUES ($1,'created',$2)`, [r!.id, userId ?? null], db)
    await logActivity({ userId, action: 'promotion_created', detail: `${prop.name}: ${PROMO_TYPES[input.type].label} (${code})` }, db)
    return r!.id
  })
}

/** Plans 7 drafts (one per day) rotating properties and types, preferring combinations used least recently. */
export async function generateWeek(startOn: string, userId?: string | null): Promise<string[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn)) throw new Error('Choose the first day of the week.')
  const props = await q<{ id: string; name: string }>(`SELECT p.id, p.name FROM crm.properties p WHERE p.active AND EXISTS (SELECT 1 FROM crm.media m WHERE m.approved AND m.archived_at IS NULL AND (m.property_id = p.id OR m.property_id IS NULL)) ORDER BY p.sort_order, p.name`)
  if (!props.length) throw new Error('No property has approved photos yet. Approve photos in Marketing → Gallery first.')
  const combos: { propertyId: string; type: PromoType; last: number }[] = []
  for (const p of props) for (const t of await availableTypes(p.id)) {
    if (t === 'seasonal') continue
    const l = await q1<{ t: string | null }>(`SELECT max(created_at)::text AS t FROM crm.promotions WHERE property_id = $1 AND promo_type = $2`, [p.id, t])
    combos.push({ propertyId: p.id, type: t, last: l?.t ? Date.parse(l.t) : 0 })
  }
  combos.sort((a, b) => a.last - b.last)
  const ids: string[] = [], langs: ('en' | 'bn' | 'both')[] = ['both', 'en', 'bn']
  for (let i = 0; i < 7; i++) {
    const c = combos[i % combos.length]
    const d = new Date(`${startOn}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i)
    ids.push(await createPromotion({ propertyId: c.propertyId, type: c.type, language: langs[i % 3], plannedFor: d.toISOString().slice(0, 10) }, userId))
  }
  return ids
}

export async function getPromotion(id: string) {
  const p = await q1<any>(
    `SELECT pr.*, p.name AS property_name, p.promo_contacts_confirmed, cp.code, u.name AS created_by_name, a.name AS approved_by_name
     FROM crm.promotions pr JOIN crm.properties p ON p.id = pr.property_id LEFT JOIN crm.campaigns cp ON cp.id = pr.campaign_id
     LEFT JOIN crm.app_users u ON u.id = pr.created_by LEFT JOIN crm.app_users a ON a.id = pr.approved_by WHERE pr.id = $1`, [id])
  if (!p) return null
  const media = await q<any>(`SELECT id, public_token, title, ai_mark FROM crm.media WHERE id = ANY($1::uuid[])`, [p.media_ids])
  const order = new Map<string, number>((p.media_ids as string[]).map((m, i) => [m, i]))
  media.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  const events = await q<any>(`SELECT e.*, u.name AS user_name, o.name AS opportunity_name FROM crm.promotion_events e LEFT JOIN crm.app_users u ON u.id = e.user_id
    LEFT JOIN crm.promo_opportunities o ON o.id = e.opportunity_id WHERE e.promotion_id = $1 ORDER BY e.at DESC`, [id])
  const results = await q1<any>(
    `SELECT (SELECT count(*)::int FROM crm.customers c WHERE c.campaign_id = $1) AS enquiries,
            (SELECT count(*)::int FROM crm.bookings b WHERE b.campaign_id = $1 AND b.status IN ('confirmed','completed')) AS bookings,
            (SELECT COALESCE(sum(b.total),0) FROM crm.bookings b WHERE b.campaign_id = $1 AND b.status IN ('confirmed','completed')) AS value`, [p.campaign_id])
  return { ...p, media, events, results }
}

export async function listPromotions(limit = 60) {
  return q<any>(
    `SELECT pr.id, pr.promo_type, pr.headline, pr.status, pr.planned_for::text AS planned_for, pr.language, pr.created_at, p.name AS property_name, cp.code,
       (SELECT public_token FROM crm.media m WHERE m.id = pr.media_ids[1]) AS thumb,
       (SELECT count(*)::int FROM crm.promotion_events e WHERE e.promotion_id = pr.id AND e.kind = 'posted') AS posts
     FROM crm.promotions pr JOIN crm.properties p ON p.id = pr.property_id LEFT JOIN crm.campaigns cp ON cp.id = pr.campaign_id
     WHERE pr.status <> 'archived' ORDER BY pr.planned_for NULLS LAST, pr.created_at DESC LIMIT $1`, [limit])
}

export async function setPromotionStatus(id: string, status: 'approved' | 'archived' | 'draft', userId: string) {
  const r = await q1<{ headline: string }>(
    `UPDATE crm.promotions SET status = $2, approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE approved_by END,
       approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END, updated_at = now() WHERE id = $1 RETURNING headline`, [id, status, userId])
  if (!r) throw new Error('Promotion not found.')
  if (status === 'approved') await q(`INSERT INTO crm.promotion_events (promotion_id, kind, user_id) VALUES ($1,'approved',$2)`, [id, userId])
  await logActivity({ userId, action: `promotion_${status}`, detail: r.headline })
}

export async function updateCaptions(id: string, c: Record<string, string>, userId: string) {
  const cur = await q1<{ captions: any; status: string }>(`SELECT captions, status FROM crm.promotions WHERE id = $1`, [id])
  if (!cur) throw new Error('Promotion not found.')
  const keys = ['social', 'whatsapp', 'group', 'classified', 'hashtags']
  const next = { ...cur.captions }
  for (const k of keys) if (typeof c[k] === 'string') next[k] = c[k]
  await q(`UPDATE crm.promotions SET captions = $2, status = CASE WHEN status = 'approved' THEN 'draft' ELSE status END, updated_at = now() WHERE id = $1`, [id, JSON.stringify(next)])
  await logActivity({ userId, action: 'promotion_edited', detail: `Captions edited${cur.status === 'approved' ? ' — needs owner approval again' : ''}` })
}

const EVENT_KINDS = ['downloaded_image', 'downloaded_video', 'copied_caption', 'copied_whatsapp', 'opened_destination'] as const
export async function recordPromoEvent(id: string, kind: string, detail: string | null, userId: string) {
  if (!(EVENT_KINDS as readonly string[]).includes(kind)) throw new Error('Unknown event.')
  await q(`INSERT INTO crm.promotion_events (promotion_id, kind, detail, user_id) VALUES ($1,$2,$3,$4)`, [id, kind, detail?.slice(0, 200) ?? null, userId])
}

export async function markPromotionPosted(id: string, o: { opportunityId?: string | null; destination?: string | null; url?: string | null; postedOn?: string | null }, userId: string) {
  const p = await q1<{ status: string }>(`SELECT status FROM crm.promotions WHERE id = $1`, [id])
  if (!p) throw new Error('Promotion not found.')
  if (p.status === 'draft') throw new Error('The owner must approve this promotion before it is posted.')
  if (!o.opportunityId && !o.destination?.trim()) throw new Error('Say where it was posted.')
  if (o.url && !/^https?:\/\//i.test(o.url)) throw new Error('The post link must start with http:// or https://')
  await tx(async (db) => {
    await q(`INSERT INTO crm.promotion_events (promotion_id, kind, detail, opportunity_id, url, posted_on, user_id) VALUES ($1,'posted',$2,$3,$4,COALESCE($5::date, (now() AT TIME ZONE 'Asia/Kolkata')::date),$6)`,
      [id, o.destination?.trim() || null, o.opportunityId || null, o.url || null, o.postedOn || null, userId], db)
    await q(`UPDATE crm.promotions SET status = 'posted', updated_at = now() WHERE id = $1`, [id], db)
    if (o.opportunityId) await q(`UPDATE crm.promo_opportunities SET status = 'posted', updated_at = now() WHERE id = $1 AND status IN ('new','reviewed','approved')`, [o.opportunityId], db)
    await logActivity({ userId, action: 'promotion_posted', detail: o.destination || o.url || undefined }, db)
  })
}

/** Enquiries, bookings and value per property and promotion type. Only counts what the CRM actually recorded. */
export async function promotionPerformance() {
  return q<any>(
    `SELECT p.name AS property, pr.promo_type,
       count(DISTINCT pr.id)::int AS promotions,
       count(DISTINCT e.id) FILTER (WHERE e.kind IN ('downloaded_image','downloaded_video'))::int AS downloads,
       count(DISTINCT e.id) FILTER (WHERE e.kind = 'posted')::int AS posted,
       (SELECT count(*)::int FROM crm.customers c WHERE c.campaign_id IN (SELECT campaign_id FROM crm.promotions x WHERE x.property_id = p.id AND x.promo_type = pr.promo_type AND x.status <> 'archived')) AS enquiries,
       (SELECT count(*)::int FROM crm.bookings b WHERE b.status IN ('confirmed','completed') AND b.campaign_id IN (SELECT campaign_id FROM crm.promotions x WHERE x.property_id = p.id AND x.promo_type = pr.promo_type AND x.status <> 'archived')) AS bookings,
       (SELECT COALESCE(sum(b.total),0) FROM crm.bookings b WHERE b.status IN ('confirmed','completed') AND b.campaign_id IN (SELECT campaign_id FROM crm.promotions x WHERE x.property_id = p.id AND x.promo_type = pr.promo_type AND x.status <> 'archived')) AS value
     FROM crm.promotions pr JOIN crm.properties p ON p.id = pr.property_id LEFT JOIN crm.promotion_events e ON e.promotion_id = pr.id
     WHERE pr.status <> 'archived'
     GROUP BY p.id, p.name, pr.promo_type ORDER BY p.name, pr.promo_type`)
}

// ── Media gallery ──────────────────────────────────────────────────────────────

const MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export async function addMedia(bytes: Buffer, o: { filename: string; mime: string; propertyId?: string | null; category?: string | null; title?: string | null; description?: string | null; sourceUrl?: string | null; hasTextOverlay?: boolean; aiMark?: boolean }, userId?: string | null): Promise<{ id: string; duplicate: boolean }> {
  if (!MIME[o.mime]) throw new Error('Upload a JPG, PNG or WebP image.')
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Each image must be 5 MB or smaller.')
  if (o.category && !(MEDIA_CATEGORIES as readonly string[]).includes(o.category)) throw new Error('Choose a valid category.')
  const sha = createHash('sha256').update(bytes).digest('hex')
  const dup = await q1<{ id: string }>(`SELECT id FROM crm.media WHERE sha256 = $1`, [sha])
  if (dup) return { id: dup.id, duplicate: true }
  const r = await q1<{ id: string }>(
    `INSERT INTO crm.media (filename, mime, bytes, size, public_token, property_id, category, title, description, source_url, sha256, uploaded_by, has_text_overlay, ai_mark)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (sha256) WHERE sha256 IS NOT NULL DO NOTHING RETURNING id`,
    [o.filename.slice(0, 200), o.mime, bytes, bytes.length, randomBytes(18).toString('base64url'), o.propertyId || null, o.category || null,
      o.title?.slice(0, 120) || null, o.description?.slice(0, 500) || null, o.sourceUrl || null, sha, userId ?? null, !!o.hasTextOverlay, !!o.aiMark])
  if (!r) return { id: (await q1<{ id: string }>(`SELECT id FROM crm.media WHERE sha256 = $1`, [sha]))!.id, duplicate: true }
  await logActivity({ userId, action: 'media_added', detail: o.title || o.filename })
  return { id: r.id, duplicate: false }
}

export async function listMedia(f: { propertyId?: string; category?: string; approved?: string; search?: string; archived?: boolean }) {
  const where = [f.archived ? 'm.archived_at IS NOT NULL' : 'm.archived_at IS NULL'], args: unknown[] = []
  if (f.propertyId === 'none') where.push('m.property_id IS NULL')
  else if (f.propertyId) { args.push(f.propertyId); where.push(`m.property_id = $${args.length}`) }
  if (f.category) { args.push(f.category); where.push(`m.category = $${args.length}`) }
  if (f.approved === 'yes') where.push('m.approved'); if (f.approved === 'no') where.push('NOT m.approved')
  if (f.search) { args.push(`%${f.search}%`); where.push(`(m.title ILIKE $${args.length} OR m.description ILIKE $${args.length} OR m.filename ILIKE $${args.length})`) }
  return q<any>(`SELECT m.id, m.filename, m.mime, m.size, m.public_token, m.property_id, m.category, m.title, m.description, m.approved, m.has_text_overlay, m.ai_mark, m.source_url, m.created_at, m.last_used_at, p.name AS property_name
    FROM crm.media m LEFT JOIN crm.properties p ON p.id = m.property_id WHERE ${where.join(' AND ')} ORDER BY p.name NULLS LAST, m.category, m.created_at`, args)
}

export async function updateMedia(id: string, o: { propertyId: string | null; category: string | null; title: string | null; description: string | null; approved?: boolean }, user: { id: string; role: string }) {
  if (o.category && !(MEDIA_CATEGORIES as readonly string[]).includes(o.category)) throw new Error('Choose a valid category.')
  const cur = await q1<{ approved: boolean; has_text_overlay: boolean }>(`SELECT approved, has_text_overlay FROM crm.media WHERE id = $1`, [id])
  if (!cur) throw new Error('Image not found.')
  let approved = cur.approved
  if (o.approved !== undefined && o.approved !== cur.approved) {
    if (user.role !== 'owner') throw new Error('Only the owner can approve photos for promotion.')
    if (o.approved && cur.has_text_overlay) throw new Error('This image has an old price printed on it, so it cannot be used in promotions.')
    approved = o.approved
  }
  await q(`UPDATE crm.media SET property_id=$2, category=$3, title=$4, description=$5, approved=$6 WHERE id=$1`, [id, o.propertyId, o.category, o.title, o.description, approved])
  await logActivity({ userId: user.id, action: 'media_updated', detail: `${o.title ?? 'image'}${approved !== cur.approved ? (approved ? ' — approved for promotion' : ' — approval removed') : ''}` })
}

/** Owner only. Images used by a promotion or post are archived (kept), others are deleted. */
export async function removeMedia(id: string, userId: string): Promise<'deleted' | 'archived'> {
  const used = await q1(`SELECT 1 FROM crm.promotions WHERE $1 = ANY(media_ids) UNION ALL SELECT 1 FROM crm.posts WHERE media_id = $1 LIMIT 1`, [id])
  const m = await q1<{ title: string | null; filename: string }>(`SELECT title, filename FROM crm.media WHERE id = $1`, [id])
  if (!m) throw new Error('Image not found.')
  if (used) { await q(`UPDATE crm.media SET archived_at = now(), approved = false WHERE id = $1`, [id]) }
  else await q(`DELETE FROM crm.media WHERE id = $1`, [id])
  await logActivity({ userId, action: used ? 'media_archived' : 'media_deleted', detail: m.title || m.filename })
  return used ? 'archived' : 'deleted'
}

// Photos found on the old public website (www.bookmyspaces.in/images). Descriptions record what each shows,
// based on the website's own alt text and a visual check. Nothing is approved automatically.
const SITE = 'https://www.bookmyspaces.in/images/'
const AI_MARKED = new Set(['cafe-main.webp', 'cafe-rooftop.webp', 'gallery-1.webp', 'gallery-2.webp', 'gallery-4.webp', 'room-decor.webp', 'rooftop-dining.webp', 'hall-event.webp', 'rooftop-evening.webp', 'room-deluxe-1.webp', 'room-deluxe-2.webp', 'room-deluxe-3.webp', 'skyline-serenity.webp', 'hero-main.webp'])
const SITE_PHOTOS: { f: string; prop: string | null; cat: string; title: string; note?: string; overlay?: boolean }[] = [
  { f: 'monurama-exterior.webp', prop: 'MonuRama Homestay', cat: 'exterior', title: 'MonuRama building front' },
  { f: 'rooftop-evening.webp', prop: 'MonuRama Homestay', cat: 'rooftop', title: 'Rooftop terrace with evening lights' },
  { f: 'cafe-main.webp', prop: 'MonuRama Homestay', cat: 'cafe', title: 'Rooftop café with guests' },
  { f: 'cafe-rooftop.webp', prop: 'MonuRama Homestay', cat: 'cafe', title: 'Rooftop café seating with umbrellas' },
  { f: 'hall-event.webp', prop: 'MonuRama Homestay', cat: 'halls', title: 'Celebration hall — family event' },
  { f: 'gallery-2.webp', prop: 'MonuRama Homestay', cat: 'halls', title: 'Celebration hall — dining set-up' },
  { f: 'gallery-1.webp', prop: 'MonuRama Homestay', cat: 'decoration', title: 'Decorated table in the hall' },
  { f: 'room-decor.webp', prop: 'MonuRama Homestay', cat: 'decoration', title: 'Birthday room decoration' },
  { f: 'monurama-interior.webp', prop: 'MonuRama Homestay', cat: 'other', title: 'Corridor' },
  { f: 'monurama-main.webp', prop: 'MonuRama Homestay', cat: 'other', title: 'Meeting table (corporate)' },
  { f: 'rooftop-dining.webp', prop: 'MonuRama Homestay', cat: 'events', title: 'Group celebration', note: 'Please confirm this is a real photo taken at the property before approving.' },
  { f: 'cafe-02.webp', prop: 'MonuRama Homestay', cat: 'food', title: 'Candlelight dinner for two', note: 'Please confirm this is a real photo taken at the property before approving.' },
  { f: 'dining-romance.webp', prop: 'MonuRama Homestay', cat: 'food', title: 'Private dining with waiter', note: 'Please confirm this is a real photo taken at the property before approving.' },
  { f: 'room-deluxe-1.webp', prop: 'MonuRama Homestay', cat: 'rooms', title: 'Room banner “Rooms available from ₹999”', overlay: true, note: 'Old banner with ₹999 price printed on it — do not approve unless that price is still valid.' },
  { f: 'room-deluxe-2.webp', prop: 'MonuRama Homestay', cat: 'rooms', title: 'Room banner “Stay comfortable at ₹999”', overlay: true, note: 'Old banner with ₹999 price printed on it — do not approve unless that price is still valid.' },
  { f: 'room-deluxe-3.webp', prop: 'MonuRama Homestay', cat: 'rooms', title: 'Room banner “Book now — rooms from ₹999”', overlay: true, note: 'Old banner with ₹999 price printed on it — do not approve unless that price is still valid.' },
  { f: 'skyline-serenity.webp', prop: 'Skyline Serenity', cat: 'rooms', title: 'Skyline Serenity — lounge' },
  { f: 'hero-main.webp', prop: null, cat: 'rooms', title: 'Lounge (website home page)', note: 'The website does not say which property this is. Choose the property.' },
  { f: 'gallery-4.webp', prop: null, cat: 'other', title: 'Website gallery photo 4', note: 'The website does not describe this photo. Check it and set the property and category.' },
  // cafe-01, gallery-3 and gallery-5 on the website are byte-for-byte copies of cafe-main, cafe-rooftop and dining-romance, so they are not imported twice.
]

export async function importWebsitePhotos(userId: string): Promise<{ added: number; duplicates: number; failed: string[] }> {
  const props = new Map((await q<{ id: string; name: string }>(`SELECT id, name FROM crm.properties`)).map((p) => [p.name, p.id]))
  let added = 0, duplicates = 0
  const failed: string[] = []
  for (const s of SITE_PHOTOS) {
    try {
      const res = await fetch(SITE + s.f, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
      const type = res.headers.get('content-type')?.split(';')[0] ?? ''
      if (!res.ok || !MIME[type]) { failed.push(`${s.f} (${res.status})`); continue }
      const r = await addMedia(Buffer.from(await res.arrayBuffer()), { filename: s.f, mime: type, propertyId: s.prop ? props.get(s.prop) ?? null : null, category: s.cat, title: s.title,
        description: ['Recovered from www.bookmyspaces.in.', s.note, AI_MARKED.has(s.f) ? 'Shows the Google Gemini AI sparkle mark (bottom-right): this image was made or edited with AI. Approve only if it truly shows the property as it is.' : null].filter(Boolean).join(' '), sourceUrl: SITE + s.f, hasTextOverlay: s.overlay, aiMark: AI_MARKED.has(s.f) }, userId)
      if (r.duplicate) duplicates++; else added++
    } catch (e) { failed.push(`${s.f} (${(e as Error).message})`) }
  }
  await logActivity({ userId, action: 'media_import', detail: `Website photos: ${added} added, ${duplicates} already present${failed.length ? `, ${failed.length} failed` : ''}` })
  return { added, duplicates, failed }
}

// ── Free promotion directory ───────────────────────────────────────────────────

export const OPP_STATUS = ['new', 'reviewed', 'approved', 'posted', 'rejected', 'paid'] as const

export async function saveOpportunity(id: string | null, o: { platform: string; name: string; url: string; audience?: string | null; category?: string | null; freePosting: string; membership: string; rules?: string | null; lastChecked?: string | null; status: string; notes?: string | null }, userId: string) {
  if (!o.platform.trim() || !o.name.trim()) throw new Error('Platform and name are required.')
  if (!/^https?:\/\/[^\s]+$/i.test(o.url.trim())) throw new Error('Enter the full web address (starting with https://).')
  if (!['yes', 'no', 'unknown'].includes(o.freePosting) || !['yes', 'no', 'unknown'].includes(o.membership)) throw new Error('Choose yes, no or unknown.')
  if (!(OPP_STATUS as readonly string[]).includes(o.status)) throw new Error('Choose a status.')
  if (o.status === 'approved' && o.freePosting !== 'yes') throw new Error('Only mark it Approved once free posting is confirmed (set “Free posting” to Yes after checking the rules).')
  const args = [o.platform.trim(), o.name.trim(), o.url.trim(), o.audience || null, o.category || null, o.freePosting, o.membership, o.rules || null, o.lastChecked || null, o.status, o.notes || null]
  try {
    if (id) await q(`UPDATE crm.promo_opportunities SET platform=$2, name=$3, url=$4, audience=$5, category=$6, free_posting=$7, membership_required=$8, rules=$9, last_checked=$10, status=$11, notes=$12, updated_at=now() WHERE id=$1`, [id, ...args])
    else await q(`INSERT INTO crm.promo_opportunities (platform, name, url, audience, category, free_posting, membership_required, rules, last_checked, status, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [...args, userId])
  } catch (e) {
    if ((e as any).code === '23505') throw new Error('That web address is already in the list.')
    throw e
  }
  await logActivity({ userId, action: id ? 'opportunity_updated' : 'opportunity_added', detail: `${o.name} (${o.status})` })
}

export async function listOpportunities(status?: string) {
  return q<any>(`SELECT * FROM crm.promo_opportunities ${status ? 'WHERE status = $1' : ''} ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'posted' THEN 1 WHEN 'reviewed' THEN 2 WHEN 'new' THEN 3 ELSE 4 END, platform, name`, status ? [status] : [])
}

/** A reply staff can send on WhatsApp, built only from approved catalogue items, set rates and confirmed property details. */
export async function approvedInfoReply(propertyId: string): Promise<{ id: string; title: string; body: string } | null> {
  const p = await q1<Property>(`SELECT * FROM crm.properties WHERE id = $1`, [propertyId])
  if (!p) return null
  const offers = await offerChoices(p.id)
  const lines = [`Thank you for your interest in ${p.name}${p.promo_location ? ` (${p.promo_location})` : ''}.`]
  if (offers.length) lines.push('Current options:', ...offers.slice(0, 6).map((o) => `• ${o.line}`))
  lines.push('Please tell us your date, timing and number of guests, and we will confirm availability and the final price.')
  if (p.promo_phones) lines.push(`Call: ${p.promo_phones}`)
  return { id: `approved-${p.id}`, title: `${p.name}: rates & packages`, body: lines.join('\n') }
}
