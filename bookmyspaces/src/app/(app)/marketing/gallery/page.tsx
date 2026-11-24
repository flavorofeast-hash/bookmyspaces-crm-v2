import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { q } from '@/lib/db'
import { listMedia, MEDIA_CATEGORIES } from '@/lib/promo'
import { uploadMediaAction, updateMediaAction, removeMediaAction, importWebsiteAction } from '../studio-actions'
import { PageHeader, Card, Flash, Empty, Field, Hidden, Reveal, Badge } from '@/components/ui'
import { SubmitButton } from '@/components/client'

type SP = { ok?: string; err?: string; note?: string; property?: string; category?: string; approved?: string; q?: string; archived?: string }

export default async function GalleryPage(props: { searchParams: Promise<SP> }) {
  const u = await requireUser()
  const sp = await props.searchParams
  const owner = u.role === 'owner'
  const [props_, media] = await Promise.all([
    q<{ id: string; name: string }>(`SELECT id, name FROM crm.properties WHERE active ORDER BY sort_order, name`),
    listMedia({ propertyId: sp.property, category: sp.category, approved: sp.approved, search: sp.q, archived: sp.archived === '1' }),
  ])
  const back = `/marketing/gallery?${new URLSearchParams(Object.entries({ property: sp.property ?? '', category: sp.category ?? '', approved: sp.approved ?? '', q: sp.q ?? '' }).filter(([, v]) => v)).toString()}`
  return (
    <>
      <PageHeader title="Photo gallery" subtitle={<><Link href="/marketing" className="link">← Marketing</Link> · Genuine property photos used for promotions. Only photos the owner approves are used.</>}
        actions={<Link href="/marketing/studio" className="btn-primary">Promotion Studio</Link>} />
      <Flash ok={sp.note ?? sp.ok} err={sp.err} />
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <form className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
              <Field label="Search"><input name="q" defaultValue={sp.q ?? ''} className="input" placeholder="rooftop, hall…" /></Field>
              <Field label="Property"><select name="property" defaultValue={sp.property ?? ''} className="input"><option value="">All</option>{props_.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="none">Not set</option></select></Field>
              <Field label="Category"><select name="category" defaultValue={sp.category ?? ''} className="input"><option value="">All</option>{MEDIA_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
              <Field label="Approved"><select name="approved" defaultValue={sp.approved ?? ''} className="input"><option value="">All</option><option value="yes">Approved</option><option value="no">Not approved</option></select></Field>
              <button className="btn-secondary">Filter</button>
            </form>
            <div className="text-xs muted mt-2">{media.length} photo{media.length === 1 ? '' : 's'} · <Link className="link" href={sp.archived === '1' ? '/marketing/gallery' : '/marketing/gallery?archived=1'}>{sp.archived === '1' ? 'Show current photos' : 'Show archived photos'}</Link></div>
          </Card>
          {media.length === 0 ? <Card><Empty>No photos here yet.{owner ? ' Use “Import photos from bookmyspaces.in” or upload photos.' : ' Upload photos on the right.'}</Empty></Card> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{media.map((m) => (
              <div key={m.id} className="card overflow-hidden" data-media={m.filename}>
                <a href={`/api/media/${m.public_token}`} target="_blank" rel="noreferrer"><img src={`/api/media/${m.public_token}`} alt={m.title ?? ''} loading="lazy" className="w-full h-44 object-cover bg-slate-100" /></a>
                <div className="p-3 space-y-2 text-sm">
                  <div className="flex flex-wrap gap-1 items-center">
                    {m.approved ? <Badge value="confirmed" label="Approved for promotion" /> : <Badge value="tentative" label="Not approved" />}
                    {m.has_text_overlay && <Badge value="cancelled" label="Has text/price printed" />}
                    {m.ai_mark && <Badge value="cancelled" label="AI mark — made or edited with AI" />}
                    <span className="text-xs muted">{Math.round(m.size / 1024)} KB · {m.mime.replace('image/', '')}</span>
                  </div>
                  {m.description && <p className="text-xs muted">{m.description}</p>}
                  <form action={updateMediaAction} className="space-y-1.5">
                    <Hidden name="id" value={m.id} /><Hidden name="back" value={back} />
                    <input name="title" defaultValue={m.title ?? ''} className="input" placeholder="Title" aria-label="Title" />
                    <div className="grid grid-cols-2 gap-1.5">
                      <select name="property_id" defaultValue={m.property_id ?? ''} className="input" aria-label="Property"><option value="">Property not set</option>{props_.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                      <select name="category" defaultValue={m.category ?? ''} className="input" aria-label="Category"><option value="">Category</option>{MEDIA_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                    </div>
                    <input name="description" defaultValue={m.description ?? ''} className="input" placeholder="Description" aria-label="Description" />
                    {owner && <><Hidden name="approved_field" value="1" /><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="approved" defaultChecked={m.approved} /> Approved for promotion (genuine photo, no outdated prices)</label></>}
                    <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                  </form>
                  {owner && <Reveal label="Delete" danger>
                    <form action={removeMediaAction}><Hidden name="id" value={m.id} /><Hidden name="back" value={back} />
                      <p className="text-xs mb-2">Photos already used in a promotion are archived (kept for the record) instead of deleted.</p>
                      <SubmitButton className="btn-secondary btn-sm text-red-700">Delete this photo</SubmitButton></form>
                  </Reveal>}
                </div>
              </div>))}</div>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Upload photos">
            <form action={uploadMediaAction} className="space-y-2">
              <input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple required className="text-sm" />
              <Field label="Property"><select name="property_id" className="input"><option value="">Not set</option>{props_.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Category"><select name="category" className="input"><option value="">Choose</option>{MEDIA_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
              <Field label="Title (optional)"><input name="title" className="input" /></Field>
              <p className="text-xs muted">JPG, PNG or WebP, up to 4 MB each (originals are kept, not compressed). Upload only real photos of the property.</p>
              <SubmitButton>Upload</SubmitButton>
            </form>
          </Card>
          {owner && <Card title="Old website photos">
            <p className="text-sm mb-2">Copies the original photos from www.bookmyspaces.in/images into this gallery (exact files, no quality loss). Photos already here are skipped. Nothing is approved automatically.</p>
            <form action={importWebsiteAction}><SubmitButton className="btn-secondary" pendingText="Importing…">Import photos from bookmyspaces.in</SubmitButton></form>
          </Card>}
        </div>
      </div>
    </>
  )
}
