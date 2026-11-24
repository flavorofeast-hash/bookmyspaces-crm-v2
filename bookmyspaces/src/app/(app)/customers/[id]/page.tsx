import { requireUser } from '@/lib/auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q } from '@/lib/db'
import { getCustomer } from '@/lib/customers'
import { updateCustomerAction, addFollowUpAction, completeFollowUpAction } from '../actions'
import { CustomerFields } from '@/components/customer-form'
import { PageHeader, Card, Flash, Badge, Empty, Hidden, Field, Reveal } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { formatPhone, waLink } from '@/lib/phone'
import { inr, fmtDate, fmtDateTime, STATUS_LABEL, BOOKING_TYPE_LABEL, SOURCE_LABEL, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, DOC_LABEL, istDate, addDays } from '@/lib/format'

export default async function CustomerPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser() // every page checks the session itself; the layout check alone can be skipped by client navigations
  const params = await props.params
  const searchParams = await props.searchParams
  const c = await getCustomer(params.id).catch(() => null)
  if (!c) notFound()
  const [campaigns, followUps, bookings, payments, documents, messages, activity] = await Promise.all([
    q<any>(`SELECT id, name, code FROM crm.campaigns ORDER BY created_at DESC`),
    q<any>(`SELECT * FROM crm.follow_ups WHERE customer_id = $1 ORDER BY done_at NULLS FIRST, due_on`, [c.id]),
    q<any>(`SELECT b.*, bb.balance, bb.net_paid FROM crm.bookings b JOIN crm.booking_balances bb ON bb.booking_id = b.id WHERE b.customer_id = $1 ORDER BY b.start_at DESC`, [c.id]),
    q<any>(`SELECT p.*, b.ref, d.id AS doc_id, d.number AS doc_number FROM crm.payments p JOIN crm.bookings b ON b.id = p.booking_id
            LEFT JOIN crm.documents d ON d.payment_id = p.id AND d.status = 'issued' WHERE p.customer_id = $1 ORDER BY p.created_at DESC`, [c.id]),
    q<any>(`SELECT d.*, b.ref FROM crm.documents d JOIN crm.bookings b ON b.id = d.booking_id WHERE d.customer_id = $1 ORDER BY d.issued_at DESC`, [c.id]),
    q<any>(`SELECT * FROM crm.messages WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 5`, [c.id]),
    q<any>(`SELECT a.*, u.name AS user_name FROM crm.activity a LEFT JOIN crm.app_users u ON u.id = a.user_id WHERE a.customer_id = $1 ORDER BY a.at DESC LIMIT 20`, [c.id]),
  ])
  const totalDue = bookings.filter((b) => ['confirmed', 'completed'].includes(b.status)).reduce((s, b) => s + Number(b.balance), 0)
  const back = `/customers/${c.id}`
  const wa = waLink(c.whatsapp ?? c.phone)
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={<>{formatPhone(c.phone) || 'No mobile number'} · {SOURCE_LABEL[c.source] ?? c.source}{c.campaign_code ? ` · Campaign ${c.campaign_code}` : ''} · Customer since {fmtDate(c.created_at)}</>}
        actions={<>
          <Link href={`/bookings/new?customer=${c.id}`} className="btn-primary">+ New booking / enquiry</Link>
          {(c.whatsapp || c.phone) && <Link href={`/inbox/${c.id}`} className="btn-secondary">WhatsApp chat</Link>}
          {c.phone && <a href={`tel:+${c.phone}`} className="btn-secondary">Call</a>}
        </>}
      />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      {(c.requirements || c.notes) && (
        <div className="card card-pad mb-4 text-sm grid sm:grid-cols-2 gap-3">
          {c.requirements && <div><div className="text-xs font-semibold muted">Requirements</div><div className="whitespace-pre-line">{c.requirements}</div></div>}
          {c.notes && <div><div className="text-xs font-semibold muted">Notes</div><div className="whitespace-pre-line">{c.notes}</div></div>}
        </div>
      )}
      {c.import_flags?.length > 0 && <p className="text-xs muted mb-3">Imported from the old CRM{c.import_flags.includes('no_phone') ? ' — no mobile number in the old record' : ''}{c.import_flags.includes('merged_duplicate_leads') ? ' — several old leads with this number were merged here' : ''}.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Bookings & enquiries" actions={totalDue > 0 ? <span className="text-sm text-amber-700 font-medium">Balance due {inr(totalDue)}</span> : null} pad={false}>
            {bookings.length === 0 ? <div className="card-pad"><Empty>No bookings yet.</Empty></div> : (
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Booking</th><th>Dates</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead>
                <tbody>{bookings.map((b) => (
                  <tr key={b.id}>
                    <td><Link className="link font-medium" href={`/bookings/${b.id}`}>{b.ref}</Link><div className="text-xs muted">{BOOKING_TYPE_LABEL[b.booking_type]}{b.event_type ? ` · ${b.event_type}` : ''}</div></td>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(b.start_at)}<br />{fmtDateTime(b.end_at)}</td>
                    <td><Badge value={b.status} label={STATUS_LABEL[b.status]} /></td>
                    <td>{inr(b.total)}</td><td>{inr(b.net_paid)}</td>
                    <td className={Number(b.balance) > 0 && b.status !== 'enquiry' && b.status !== 'quoted' ? 'text-amber-700 font-medium' : ''}>{inr(b.balance)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>

          <Card title="Payments & receipts" pad={false}>
            {payments.length === 0 ? <div className="card-pad"><Empty>No payments yet.</Empty></div> : (
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Date</th><th>Booking</th><th>Type</th><th>Method</th><th>Amount</th><th>Receipt</th></tr></thead>
                <tbody>{payments.map((p) => (
                  <tr key={p.id} className={p.voided_at ? 'line-through text-slate-400' : ''}>
                    <td>{fmtDate(p.paid_on)}</td><td><Link href={`/bookings/${p.booking_id}`} className="link">{p.ref}</Link></td>
                    <td>{PAYMENT_KIND_LABEL[p.kind]}{p.voided_at && <span className="no-underline ml-1"><Badge value="void" label="VOID" /></span>}</td>
                    <td>{PAYMENT_METHOD_LABEL[p.method]}</td>
                    <td className={p.kind === 'refund' ? 'text-red-700' : ''}>{p.kind === 'refund' ? '−' : ''}{inr(p.amount)}</td>
                    <td>{p.doc_id ? <Link href={`/doc/${p.doc_id}`} className="link">{p.doc_number}</Link> : '—'}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
            {documents.length > 0 && (
              <div className="card-pad border-t border-slate-100">
                <div className="text-xs font-medium muted mb-2">All documents</div>
                <div className="flex flex-wrap gap-2">
                  {documents.map((d) => <Link key={d.id} href={`/doc/${d.id}`} className="text-xs rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50">{DOC_LABEL[d.doc_type]} {d.number} {d.status === 'void' ? '(VOID)' : ''}</Link>)}
                </div>
              </div>
            )}
          </Card>

          <Card title="Customer details">
            <form action={updateCustomerAction} className="space-y-3">
              <Hidden name="id" value={c.id} />
              <CustomerFields c={c} campaigns={campaigns} />
              <SubmitButton>Save changes</SubmitButton>
            </form>
            {c.legacy_data && (
              <div className="mt-4"><Reveal label="Show original old-CRM record"><pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto">{JSON.stringify(c.legacy_data, null, 2)}</pre></Reveal></div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Follow-ups">
            <form action={addFollowUpAction} className="space-y-2 mb-3">
              <Hidden name="customer_id" value={c.id} /><Hidden name="back" value={back} />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" name="due_on" required defaultValue={addDays(istDate(), 1)} className="input" />
                <select name="method" defaultValue="call" className="input" aria-label="How"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="visit">Visit</option><option value="email">Email</option></select>
                <SubmitButton className="btn-secondary col-span-2">Add</SubmitButton>
              </div>
              <input name="note" required placeholder="What to do, e.g. Send revised quote" className="input" />
            </form>
            {followUps.length === 0 ? <Empty>No follow-ups.</Empty> : (
              <ul className="space-y-2">{followUps.map((f) => (
                <li key={f.id} className={`flex items-start justify-between gap-2 text-sm ${f.done_at ? 'muted line-through' : ''}`}>
                  <span><b className={!f.done_at && f.due_on <= istDate() ? 'text-amber-700' : ''}>{fmtDate(f.due_on)}</b> — {f.note}</span>
                  {!f.done_at && <form action={completeFollowUpAction}><Hidden name="id" value={f.id} /><Hidden name="back" value={back} /><SubmitButton className="btn-secondary btn-sm">Done</SubmitButton></form>}
                </li>))}</ul>
            )}
          </Card>

          <Card title="WhatsApp" actions={<Link href={`/inbox/${c.id}`} className="link text-sm">Open chat →</Link>}>
            {messages.length === 0 ? <Empty>No WhatsApp messages yet.{wa && <> You can also <a className="link" href={wa} target="_blank" rel="noreferrer">open WhatsApp on this device</a>.</>}</Empty> : (
              <ul className="space-y-2 text-sm">{messages.slice().reverse().map((m) => (
                <li key={m.id} className={m.direction === 'in' ? '' : 'text-right'}>
                  <span className={`inline-block rounded-lg px-2.5 py-1.5 ${m.direction === 'in' ? 'bg-slate-100' : 'bg-emerald-50'}`}>{m.body ?? `[${m.msg_type}]`}</span>
                  <div className="text-[11px] muted">{fmtDateTime(m.created_at)}{m.direction === 'out' && ` · ${m.status}`}</div>
                </li>))}</ul>
            )}
          </Card>

          <Card title="History">
            {activity.length === 0 ? <Empty>No activity yet.</Empty> : (
              <ul className="space-y-1.5 text-xs">{activity.map((a) => (
                <li key={a.id}><span className="muted">{fmtDateTime(a.at)}</span> — {a.action.replace(/_/g, ' ')}{a.detail ? `: ${a.detail}` : ''}{a.user_name ? <span className="muted"> ({a.user_name})</span> : ''}</li>))}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
