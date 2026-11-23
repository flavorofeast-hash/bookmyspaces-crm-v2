import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { getPost, facebookConnection, instagramConnection, trackingLink } from '@/lib/marketing'
import { savePostAction, publishAction, markManualAction } from '../../actions'
import { PageHeader, Card, Flash, Field, Hidden, Badge, Empty, Reveal } from '@/components/ui'
import { SubmitButton, CopyButton, CharCount } from '@/components/client'
import { fmtDateTime } from '@/lib/format'

const PL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google Business' }

export default async function PostPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser() // every page checks the session itself; the layout check alone can be skipped by client navigations
  const params = await props.params
  const searchParams = await props.searchParams
  const isNew = params.id === 'new'
  const post = isNew ? null : await getPost(params.id).catch(() => null)
  if (!isNew && !post) notFound()
  const [campaigns, settings, fb, ig] = await Promise.all([
    q<any>(`SELECT id, name, code FROM crm.campaigns ORDER BY created_at DESC`),
    q1<any>(`SELECT whatsapp_number, business_name FROM crm.business_settings WHERE id = 1`),
    post?.platforms.includes('facebook') ? facebookConnection() : null,
    post?.platforms.includes('instagram') ? instagramConnection() : null,
  ])
  const link = post?.campaign_code ? trackingLink(settings?.whatsapp_number, post.campaign_code, settings?.business_name) : null
  const latest = (pl: string) => post?.publications.find((p: any) => p.platform === pl)
  return (
    <>
      <PageHeader title={isNew ? 'New post' : post.title} subtitle={<Link href="/marketing" className="link">← Marketing</Link>} />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Content">
          <form action={savePostAction} className="space-y-3">
            <Hidden name="id" value={post?.id} />
            <Field label="Title (for you)"><input name="title" required defaultValue={post?.title ?? ''} className="input" /></Field>
            <Field label="Caption"><CharCount name="caption" defaultValue={post?.caption ?? ''} limit={2200} /></Field>
            <Field label="Image (JPG/PNG, up to 5 MB)" hint={post?.media_token ? 'Choose a new file to replace the current image.' : 'Instagram posts need an image.'}><input type="file" name="image" accept="image/jpeg,image/png" className="input" /></Field>
            <fieldset><span className="label">Platforms</span>
              <div className="flex flex-wrap gap-3 text-sm">{Object.entries(PL).map(([k, v]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="platforms" value={k} defaultChecked={post ? post.platforms.includes(k) : k !== 'google'} />{v}</label>)}</div>
            </fieldset>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Planned date"><input type="date" name="planned_for" defaultValue={post?.planned_for ? new Date(post.planned_for).toISOString().slice(0, 10) : ''} className="input" /></Field>
              <Field label="Campaign"><select name="campaign_id" defaultValue={post?.campaign_id ?? ''} className="input"><option value="">— none —</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select></Field>
            </div>
            <Field label="Notes"><textarea name="notes" rows={2} defaultValue={post?.notes ?? ''} className="input" /></Field>
            <SubmitButton>{isNew ? 'Save post' : 'Save changes'}</SubmitButton>
          </form>
        </Card>

        {post && (
          <div className="space-y-4">
            <Card title="Preview">
              <div className="rounded-lg border border-slate-200 overflow-hidden max-w-sm">
                {post.media_token ? <img src={`/api/media/${post.media_token}`} alt="" className="w-full aspect-square object-cover bg-slate-100" /> : <div className="aspect-square bg-slate-100 flex items-center justify-center text-sm muted">No image</div>}
                <div className="p-3 text-sm whitespace-pre-wrap">{post.caption || <span className="muted">No caption</span>}</div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <CopyButton text={post.caption} label="Copy caption" />
                {link && <CopyButton text={link} label={`Copy ${post.campaign_code} WhatsApp link`} />}
                {post.media_token && <a href={`/api/media/${post.media_token}`} download className="btn-secondary btn-sm">Download image</a>}
              </div>
            </Card>

            <Card title="Publish">
              <div className="space-y-4">
                {post.platforms.length === 0 && <Empty>Choose at least one platform and save.</Empty>}
                {post.platforms.includes('facebook') && fb && (
                  <div className="text-sm">
                    <div className="font-medium flex items-center gap-2">Facebook {latest('facebook') && <Badge value={latest('facebook').status} />}</div>
                    <p className={`text-xs ${fb.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{fb.detail}</p>
                    {fb.ok ? (
                      (latest('facebook')?.status === 'published'
                      ? <div className="mt-2"><Reveal label="Already published — publish again?"><form action={publishAction}><Hidden name="id" value={post.id} /><Hidden name="platform" value="facebook" /><SubmitButton className="btn-secondary btn-sm" pendingText="Publishing…">Yes, publish to Facebook again</SubmitButton></form></Reveal></div>
                      : <form action={publishAction} className="mt-2"><Hidden name="id" value={post.id} /><Hidden name="platform" value="facebook" /><SubmitButton className="btn-primary btn-sm" pendingText="Publishing…">Publish to Facebook now</SubmitButton></form>)
                    ) : <p className="text-xs muted mt-1">Automatic publishing is unavailable until the connection works. You can post manually and mark it below.</p>}
                  </div>
                )}
                {post.platforms.includes('instagram') && ig && (
                  <div className="text-sm">
                    <div className="font-medium flex items-center gap-2">Instagram {latest('instagram') && <Badge value={latest('instagram').status} />}</div>
                    <p className={`text-xs ${ig.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{ig.detail}</p>
                    {ig.ok && post.media_token ? (
                      (latest('instagram')?.status === 'published'
                      ? <div className="mt-2"><Reveal label="Already published — publish again?"><form action={publishAction}><Hidden name="id" value={post.id} /><Hidden name="platform" value="instagram" /><SubmitButton className="btn-secondary btn-sm" pendingText="Publishing…">Yes, publish to Instagram again</SubmitButton></form></Reveal></div>
                      : <form action={publishAction} className="mt-2"><Hidden name="id" value={post.id} /><Hidden name="platform" value="instagram" /><SubmitButton className="btn-primary btn-sm" pendingText="Publishing…">Publish to Instagram now</SubmitButton></form>)
                    ) : ig.ok ? <p className="text-xs text-amber-700">Add an image to publish on Instagram.</p> : <p className="text-xs muted mt-1">Automatic publishing is unavailable until the connection works. You can post manually and mark it below.</p>}
                  </div>
                )}
                {post.platforms.includes('google') && (
                  <div className="text-sm">
                    <div className="font-medium flex items-center gap-2">Google Business {latest('google') && <Badge value={latest('google').status} />}</div>
                    <p className="text-xs muted">Manual: copy the caption, download the image, then post at business.google.com. Automatic posting needs Google API approval.</p>
                    <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="btn-secondary btn-sm mt-2">Open Google Business</a>
                  </div>
                )}
                {post.platforms.length > 0 && (
                  <form action={markManualAction} className="flex flex-wrap items-end gap-2 pt-3 border-t border-slate-100">
                    <Hidden name="id" value={post.id} />
                    <Field label="Posted it yourself?"><select name="platform" className="input">{post.platforms.map((p: string) => <option key={p} value={p}>{PL[p]}</option>)}</select></Field>
                    <Field label="Link (optional)"><input name="link" className="input" placeholder="https://…" /></Field>
                    <SubmitButton className="btn-secondary btn-sm">Mark as posted</SubmitButton>
                  </form>
                )}
              </div>
            </Card>

            <Card title="Publishing history">
              {post.publications.length === 0 ? <Empty>Not posted anywhere yet.</Empty> : (
                <ul className="space-y-2 text-sm">{post.publications.map((p: any) => (
                  <li key={p.id}>
                    <span className="font-medium">{PL[p.platform]}</span> <Badge value={p.status} /> <span className="text-xs muted">{fmtDateTime(p.attempted_at)}</span>
                    {p.external_id && <div className="text-xs">Post ID: <span className="font-mono">{p.external_id}</span></div>}
                    {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="text-xs link">View post</a>}
                    {p.error && <div className="text-xs text-red-700">{p.error}</div>}
                  </li>))}</ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
