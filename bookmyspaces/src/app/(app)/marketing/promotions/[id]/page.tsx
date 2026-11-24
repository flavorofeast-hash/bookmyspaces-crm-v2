import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { getPromotion, PROMO_TYPES, type PromoType } from '@/lib/promo'
import { promotionStatusAction, updateCaptionsAction, markPostedAction } from '../../studio-actions'
import { PageHeader, Card, Flash, Field, Hidden, Badge, Reveal, Empty } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { PromoImages, VideoMaker, TrackedCopy, TrackedLink } from '@/components/promo-client'
import { fmtDate, fmtDateTime, inr } from '@/lib/format'

const KIND: Record<string, string> = { created: 'Created', approved: 'Approved by owner', downloaded_image: 'Image downloaded', downloaded_video: 'Video downloaded', copied_caption: 'Caption copied', copied_whatsapp: 'WhatsApp message copied', opened_destination: 'Opened a place to post', posted: 'Marked as posted' }

export default async function PromotionPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const u = await requireUser()
  const { id } = await props.params
  const sp = await props.searchParams
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const p = await getPromotion(id)
  if (!p) notFound()
  const prop = await q1<any>(`SELECT promo_location FROM crm.properties WHERE id = $1`, [p.property_id])
  const opps = await q<any>(`SELECT id, platform, name, url, status, free_posting FROM crm.promo_opportunities WHERE status IN ('approved','reviewed','posted') ORDER BY (status = 'approved') DESC, platform, name`)
  const c = p.captions
  const owner = u.role === 'owner'
  const text = { propertyName: p.property_name, location: prop?.promo_location ?? null, headlineEn: c.headlineEn, headlineBn: c.headlineBn, language: p.language, offerLine: p.offer_line, contactLine: c.contactLine, code: c.code }
  const photos = p.media.map((m: any) => ({ token: m.public_token, title: m.title }))
  const fileBase = `${p.property_name}-${p.promo_type}-${c.code}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const texts: [string, string, string][] = [['social', 'Facebook / Instagram caption', 'copied_caption'], ['whatsapp', 'WhatsApp message', 'copied_whatsapp'], ['group', 'Local Facebook group post', 'copied_caption'], ['classified', 'Classified listing', 'copied_caption']]
  return (
    <>
      <PageHeader title={p.headline} subtitle={<><Link href="/marketing/studio" className="link">← Promotion Studio</Link> · {p.property_name} · {PROMO_TYPES[p.promo_type as PromoType]?.label} · code <span className="font-mono">{c.code}</span>{p.planned_for ? ` · planned ${fmtDate(p.planned_for)}` : ''}</>}
        actions={<Badge value={p.status === 'approved' ? 'confirmed' : p.status === 'posted' ? 'published' : 'draft'} label={p.status === 'draft' ? 'Waiting for owner approval' : p.status} />} />
      <Flash ok={sp.ok} err={sp.err} />
      {!p.promo_contacts_confirmed && <div className="mb-4 rounded-lg px-4 py-3 text-sm border bg-amber-50 border-amber-200 text-amber-900">Check the phone numbers on the image before posting: the owner has not yet confirmed them in Settings → Properties.</div>}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Card title="Promotional image"><PromoImages promotionId={p.id} photos={photos} text={text} fileBase={fileBase} /></Card>
          <Card title="Short video (MP4)"><VideoMaker promotionId={p.id} photos={photos} text={text} fileBase={fileBase} /></Card>
          <Card title="Captions — ready to copy">
            <div className="space-y-4">{texts.map(([k, label, kind]) => (
              <div key={k}>
                <div className="flex items-center justify-between mb-1"><span className="label">{label}</span><TrackedCopy promotionId={p.id} text={c[k]} label="Copy" kind={kind as any} /></div>
                <pre className="whitespace-pre-wrap text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 font-sans">{c[k]}</pre>
              </div>))}
              <div><div className="flex items-center justify-between mb-1"><span className="label">Hashtags</span><TrackedCopy promotionId={p.id} text={c.hashtags} label="Copy" kind="copied_caption" /></div><p className="text-sm">{c.hashtags}</p></div>
              {c.waLink && <div><span className="label">WhatsApp enquiry link (tags enquiries with code {c.code})</span><div className="flex gap-2 items-center"><TrackedCopy promotionId={p.id} text={c.waLink} label="Copy link" kind="copied_whatsapp" /><span className="text-xs muted truncate">{c.waLink.slice(0, 60)}…</span></div></div>}
            </div>
            <div className="mt-4"><Reveal label="Edit captions">
              <form action={updateCaptionsAction} className="space-y-2"><Hidden name="id" value={p.id} />
                {texts.map(([k, label]) => <Field key={k} label={label}><textarea name={k} defaultValue={c[k]} rows={6} className="input" /></Field>)}
                <p className="text-xs muted">Editing an approved promotion sends it back to the owner for approval.</p>
                <SubmitButton className="btn-secondary">Save captions</SubmitButton>
              </form></Reveal></div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Approval">
            {p.status === 'draft' && (owner ? <form action={promotionStatusAction}><Hidden name="id" value={p.id} /><Hidden name="to" value="approved" />
              <p className="text-sm mb-2">Check the image, prices, phone numbers and captions. Once approved, staff can post it.</p>
              <SubmitButton>Approve for posting</SubmitButton></form>
              : <p className="text-sm">Waiting for the owner to approve. You can already download and check everything.</p>)}
            {p.status !== 'draft' && <p className="text-sm">Approved{p.approved_by_name ? ` by ${p.approved_by_name}` : ''}{p.approved_at ? ` on ${fmtDateTime(p.approved_at)}` : ''}.</p>}
            <div className="mt-3"><Reveal label="Archive" danger><form action={promotionStatusAction}><Hidden name="id" value={p.id} /><Hidden name="to" value="archived" /><SubmitButton className="btn-secondary btn-sm text-red-700">Archive this promotion</SubmitButton></form></Reveal></div>
          </Card>
          <Card title="Where to post (free)">
            {opps.length === 0 ? <Empty>No places reviewed yet. See <Link href="/marketing/opportunities" className="link">Free places to post</Link>.</Empty> : (
              <ul className="space-y-2 text-sm">{opps.map((o: any) => (
                <li key={o.id} className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="font-medium truncate">{o.name}</div><div className="text-xs muted">{o.platform} · {o.status}{o.free_posting !== 'yes' ? ' · rules not confirmed' : ''}</div></div>
                  <TrackedLink promotionId={p.id} href={o.url}>Open</TrackedLink></li>))}</ul>)}
            <p className="text-xs muted mt-2">Post by hand: download the image or video, copy the caption, open the place, paste and upload. Follow each group&apos;s rules — no bulk posting or unsolicited messages.</p>
          </Card>
          <Card title="Mark as posted">
            {p.status === 'draft' ? <p className="text-sm muted">Available after the owner approves.</p> : (
              <form action={markPostedAction} className="space-y-2"><Hidden name="id" value={p.id} />
                <Field label="Posted on (from the list)"><select name="opportunity_id" className="input"><option value="">— other —</option>{opps.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
                <Field label="…or where (e.g. Facebook Page, Instagram, WhatsApp Status)"><input name="destination" className="input" /></Field>
                <Field label="Link to the post (optional)"><input name="url" type="url" className="input" placeholder="https://" /></Field>
                <Field label="Date"><input name="posted_on" type="date" className="input" /></Field>
                <SubmitButton>Mark as posted</SubmitButton>
              </form>)}
          </Card>
          <Card title="Results (from CRM records)">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded bg-slate-50 p-2"><div className="font-semibold">{p.results.enquiries}</div><div className="text-[11px] muted">enquiries</div></div>
              <div className="rounded bg-slate-50 p-2"><div className="font-semibold">{p.results.bookings}</div><div className="text-[11px] muted">bookings</div></div>
              <div className="rounded bg-slate-50 p-2"><div className="font-semibold">{inr(p.results.value)}</div><div className="text-[11px] muted">booked value</div></div>
            </div>
            <p className="text-xs muted mt-2">Counted when a customer messages with code {c.code} (or the WhatsApp link), or when staff tag the customer with this campaign. Views and likes are not shown because we don&apos;t have that data.</p>
            <ul className="mt-3 space-y-1 text-xs">{p.events.slice(0, 15).map((e: any) => (
              <li key={e.id}><span className="muted">{fmtDateTime(e.at)}</span> · {KIND[e.kind] ?? e.kind}{e.opportunity_name ? ` — ${e.opportunity_name}` : e.detail ? ` — ${e.detail}` : ''}{e.url ? <> · <a className="link" href={e.url} target="_blank" rel="noreferrer">link</a></> : null}{e.user_name ? ` · ${e.user_name}` : ''}</li>))}</ul>
          </Card>
        </div>
      </div>
    </>
  )
}
