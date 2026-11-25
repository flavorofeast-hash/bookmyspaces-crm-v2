import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q } from '@/lib/db'
import { getLead, SOURCE_LABEL, LEAD_STATUSES, CATEGORIES, STATUS_TEXT, type LeadSource } from '@/lib/leads'
import { updateLeadAction } from '../actions'
import { PageHeader, Card, Flash, Field, Hidden } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { fmtDateTime } from '@/lib/format'
import { formatPhone } from '@/lib/phone'

export default async function LeadPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser()
  const { id } = await props.params
  const sp = await props.searchParams
  const l = await getLead(id).catch(() => null)
  if (!l) notFound()
  const [users, props_] = await Promise.all([
    q<any>(`SELECT id, name FROM crm.app_users WHERE active ORDER BY name`),
    q<any>(`SELECT id, name FROM crm.properties WHERE active ORDER BY sort_order, name`),
  ])
  const phone = l.phone ?? l.customer_phone ?? l.customer_whatsapp
  const email = l.email ?? l.customer_email
  const row = (k: string, v: React.ReactNode) => <div className="flex gap-2"><span className="muted w-36 shrink-0">{k}</span><span className="break-words">{v || <span className="muted">—</span>}</span></div>
  return (
    <>
      <PageHeader title={l.name || l.customer_name} subtitle={`${SOURCE_LABEL[l.source as LeadSource]} · ${fmtDateTime(l.created_at)}${l.is_test ? ' · TEST' : ''}`}
        actions={<>
          <Link href={`/inbox/${l.customer_id}`} className="btn-secondary btn-sm">Conversation</Link>
          <Link href={`/customers/${l.customer_id}`} className="btn-secondary btn-sm">Customer record</Link>
          {l.booking_id ? <Link href={`/bookings/${l.booking_id}`} className="btn-secondary btn-sm">{l.booking_ref}</Link>
            : <Link href={`/bookings/new?customer=${l.customer_id}`} className="btn-primary btn-sm">Convert to booking</Link>}
        </>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Enquiry">
          <div className="text-sm space-y-1.5">
            {row('Name', l.name)}
            {row('Mobile', phone && formatPhone(phone))}
            {row('Email', email)}
            {row('Profile', [l.ig_username && `@${l.ig_username}`, l.social_id && !String(l.social_id).startsWith('91') ? `id ${l.social_id}` : null].filter(Boolean).join(' · '))}
            {row('Message', l.message && <span className="whitespace-pre-wrap">{l.message}</span>)}
            {row('Campaign', l.campaign_name ?? l.campaign_ref)}
            {row('Ad', l.ad_name ?? l.ad_id)}
            {row('Form', l.form_name ?? l.form_id)}
            {row('Last contact', l.last_contact_at && fmtDateTime(l.last_contact_at))}
            {l.notes && row('Notes', <span className="whitespace-pre-wrap">{l.notes}</span>)}
          </div>
        </Card>
        <Card title="Follow-up">
          <form action={updateLeadAction} className="grid sm:grid-cols-2 gap-2">
            <Hidden name="id" value={l.id} />
            <Field label="Status"><select name="status" defaultValue={l.status} className="input">{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}</select></Field>
            <Field label="Assigned to"><select name="assigned_to" defaultValue={l.assigned_to ?? ''} className="input"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Next follow-up"><input type="date" name="next_follow_up" defaultValue={l.next_follow_up ? String(l.next_follow_up).slice(0, 10) : ''} className="input" /></Field>
            <Field label="Property"><select name="property_id" defaultValue={l.property_id ?? ''} className="input"><option value="">Unknown</option>{props_.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Enquiry type"><select name="category" defaultValue={l.category ?? ''} className="input"><option value="">—</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></Field>
            <Field label="Guests"><input type="number" min={0} name="guests" defaultValue={l.guests ?? ''} className="input" /></Field>
            <Field label="Requested dates"><input name="requested_dates" defaultValue={l.requested_dates ?? ''} className="input" /></Field>
            <Field label="Budget"><input name="budget" defaultValue={l.budget ?? ''} className="input" /></Field>
            <Field label="Add a note" className="sm:col-span-2"><textarea name="note" rows={2} className="input" /></Field>
            <SubmitButton>Save</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  )
}
