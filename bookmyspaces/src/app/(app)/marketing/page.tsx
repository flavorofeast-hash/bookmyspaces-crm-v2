import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { q1 } from '@/lib/db'
import { campaignStats, listPosts, trackingLink } from '@/lib/marketing'
import { promotionPerformance, PROMO_TYPES, type PromoType } from '@/lib/promo'
import { createCampaignAction } from './actions'
import { PageHeader, Card, Flash, Empty, Field, Badge, Reveal } from '@/components/ui'
import { SubmitButton, CopyButton } from '@/components/client'
import { inr, fmtDate } from '@/lib/format'

const PL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google Business' }

export default async function MarketingPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser() // every page checks the session itself; the layout check alone can be skipped by client navigations
  const searchParams = await props.searchParams
  const [campaigns, posts, s, perf] = await Promise.all([campaignStats(), listPosts(), q1<any>(`SELECT whatsapp_number, business_name FROM crm.business_settings WHERE id = 1`), promotionPerformance()])
  const byMonth = posts.reduce<Record<string, any[]>>((a, p) => { const k = p.planned_for ? fmtDate(p.planned_for).replace(/^\d+ /, '') : 'Not scheduled'; (a[k] ??= []).push(p); return a }, {})
  return (
    <>
      <PageHeader title="Marketing" subtitle="Plan posts, publish to Facebook & Instagram, track which campaigns bring enquiries" actions={<><Link href="/marketing/studio" className="btn-primary">Promotion Studio</Link><Link href="/marketing/gallery" className="btn-secondary">Photo gallery</Link><Link href="/marketing/opportunities" className="btn-secondary">Free places to post</Link><Link href="/marketing/posts/new" className="btn-secondary">+ New post</Link></>} />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      <Card title="Which promotions bring business" className="mb-4" pad={false}>
        {perf.length === 0 ? <div className="card-pad"><Empty>No promotions yet. Start in the <Link href="/marketing/studio" className="link">Promotion Studio</Link>.</Empty></div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs muted"><th className="px-4 py-2">Property</th><th className="px-2">Type</th><th className="px-2 text-right">Promotions</th><th className="px-2 text-right">Downloads</th><th className="px-2 text-right">Posted</th><th className="px-2 text-right">Enquiries</th><th className="px-2 text-right">Bookings</th><th className="px-4 text-right">Booked value</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{perf.map((r) => (
              <tr key={r.property + r.promo_type}><td className="px-4 py-2">{r.property}</td><td className="px-2">{PROMO_TYPES[r.promo_type as PromoType]?.label ?? r.promo_type}</td><td className="px-2 text-right">{r.promotions}</td><td className="px-2 text-right">{r.downloads}</td><td className="px-2 text-right">{r.posted}</td><td className="px-2 text-right">{r.enquiries}</td><td className="px-2 text-right">{r.bookings}</td><td className="px-4 text-right">{inr(r.value)}</td></tr>))}</tbody></table>
            <p className="text-xs muted px-4 py-2">Enquiries and bookings are counted from customers who used a promotion&apos;s code or WhatsApp link, or were tagged by staff. Reach, views and likes are not shown — that data is not available here.</p></div>)}
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title="Content calendar" pad={false}>
            {posts.length === 0 ? <div className="card-pad"><Empty>No posts yet. <Link href="/marketing/posts/new" className="link">Create the first one</Link>.</Empty></div> : (
              Object.entries(byMonth).map(([month, list]) => (
                <div key={month}>
                  <div className="px-4 py-2 text-xs font-semibold muted bg-slate-50 border-y border-slate-100">{month}</div>
                  <ul className="divide-y divide-slate-100">{list.map((p) => (
                    <li key={p.id}><Link href={`/marketing/posts/${p.id}`} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
                      {p.media_token ? <img src={`/api/media/${p.media_token}`} alt="" className="w-14 h-14 rounded object-cover bg-slate-100" /> : <div className="w-14 h-14 rounded bg-slate-100" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{p.title} {p.campaign_code && <span className="text-xs muted">· {p.campaign_code}</span>}</div>
                        <div className="text-xs muted truncate">{p.caption}</div>
                        <div className="flex flex-wrap gap-1 mt-1">{p.platforms.map((pl: string) => {
                          const st = (p.latest ?? []).find((x: any) => x.platform === pl)
                          return <Badge key={pl} value={st?.status ?? 'draft'} label={`${PL[pl]}: ${st ? st.status.replace('_', ' ') : 'not posted'}`} />
                        })}</div>
                      </div>
                      <div className="text-xs muted whitespace-nowrap">{p.planned_for ? fmtDate(p.planned_for) : ''}</div>
                    </Link></li>))}</ul>
                </div>
              ))
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Campaigns">
            {!s?.whatsapp_number && <p className="text-xs text-amber-700 mb-2">Add your business WhatsApp number in <Link href="/settings" className="link">Settings</Link> to get campaign WhatsApp links.</p>}
            {campaigns.length === 0 ? <Empty>No campaigns yet.</Empty> : (
              <ul className="space-y-3">{campaigns.map((c) => {
                const link = trackingLink(s?.whatsapp_number, c.code, s?.business_name)
                return (
                  <li key={c.id} className="text-sm border-b border-slate-100 pb-3">
                    <div className="font-medium">{c.name} <span className="font-mono text-xs">{c.code}</span></div>
                    <div className="text-xs muted">{c.channel ?? ''}{c.starts_on ? ` · ${fmtDate(c.starts_on)}` : ''}{c.ends_on ? ` – ${fmtDate(c.ends_on)}` : ''}</div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                      <div className="rounded bg-slate-50 p-1.5"><div className="font-semibold">{c.enquiries}</div><div className="text-[11px] muted">enquiries</div></div>
                      <div className="rounded bg-slate-50 p-1.5"><div className="font-semibold">{c.bookings}</div><div className="text-[11px] muted">bookings</div></div>
                      <div className="rounded bg-slate-50 p-1.5"><div className="font-semibold">{inr(c.booking_value)}</div><div className="text-[11px] muted">value</div></div>
                    </div>
                    {link && <div className="mt-2 flex items-center gap-2"><CopyButton text={link} label="Copy WhatsApp link" /><span className="text-[11px] muted truncate">{link.slice(0, 40)}…</span></div>}
                  </li>)
              })}</ul>
            )}
            <div className="mt-3"><Reveal label="+ New campaign">
              <form action={createCampaignAction} className="space-y-2">
                <Field label="Name"><input name="name" required className="input" placeholder="Christmas rooftop offer" /></Field>
                <Field label="Code (letters/numbers, shown to customers)"><input name="code" required className="input uppercase" placeholder="XMAS26" /></Field>
                <Field label="Channel"><select name="channel" className="input"><option>Instagram</option><option>Facebook</option><option>Google</option><option>WhatsApp</option><option>Flyer / offline</option><option>Other</option></select></Field>
                <div className="grid grid-cols-2 gap-2"><Field label="From"><input type="date" name="starts_on" className="input" /></Field><Field label="To"><input type="date" name="ends_on" className="input" /></Field></div>
                <SubmitButton className="btn-secondary">Create campaign</SubmitButton>
              </form>
            </Reveal></div>
            <p className="text-xs muted mt-3">How tracking works: when a customer messages using the campaign link (or writes the code), they are tagged with the campaign automatically. Walk-ins can be tagged on their customer record.</p>
          </Card>
        </div>
      </div>
    </>
  )
}
