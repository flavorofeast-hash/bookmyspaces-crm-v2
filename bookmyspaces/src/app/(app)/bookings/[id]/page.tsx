import { appPublicUrl } from '@/lib/env'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBooking, listSpaces } from '@/lib/bookings'
import { requireUser } from '@/lib/auth'
import { q } from '@/lib/db'
import { setStatusAction, addItemAction, removeItemAction, updateDetailsAction, issueDocAction, recordPaymentAction, recordRefundAction, voidPaymentAction, voidDocumentAction } from '../actions'
import { addFollowUpAction } from '../../customers/actions'
import { PageHeader, Card, Flash, Badge, Empty, Hidden, Field, Reveal } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { inr, fmtDate, fmtDateTime, istDate, addDays, STATUS_LABEL, BOOKING_TYPE_LABEL, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, DOC_LABEL, EVENT_TYPES } from '@/lib/format'
import { formatPhone, waLink } from '@/lib/phone'

export default async function BookingPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; receipt?: string }> }) {
  const params = await props.params
  const searchParams = await props.searchParams
  const user = await requireUser()
  const b = await getBooking(params.id).catch(() => null)
  if (!b) notFound()
  const [spaces, followUps, staff] = await Promise.all([
    listSpaces(),
    q<any>(`SELECT * FROM crm.follow_ups WHERE booking_id = $1 AND done_at IS NULL ORDER BY due_on`, [b.id]),
    q<{ id: string; name: string }>(`SELECT id, name FROM crm.app_users WHERE active OR id = $1 ORDER BY name`, [b.assigned_to]),
  ])
  const editable = !['completed', 'cancelled'].includes(b.status)
  const isOwner = user.role === 'owner'
  const balance = Number(b.balance), netPaid = Number(b.net_paid)
  const liveQuote = b.documents.find((d: any) => d.doc_type === 'quotation' && d.status === 'issued')
  const liveBill = b.documents.find((d: any) => d.doc_type === 'bill' && d.status === 'issued')
  const newReceipt = searchParams.receipt ? b.documents.find((d: any) => d.id === searchParams.receipt) : null
  const appUrl = appPublicUrl()
  const shareText = (d: any) => `${DOC_LABEL[d.doc_type]} ${d.number} from BookMySpaces${appUrl ? `: ${appUrl}/d/${d.public_token}` : ''}`
  const wa = (d: any) => waLink(b.customer_whatsapp ?? b.customer_phone, shareText(d))
  const back = `/bookings/${b.id}`

  return (
    <>
      <PageHeader
        title={`${b.ref} · ${b.customer_name}`}
        subtitle={<>{BOOKING_TYPE_LABEL[b.booking_type]}{b.event_type ? ` · ${b.event_type}` : ''}{b.guests ? ` · ${b.guests} guests` : ''} · {fmtDateTime(b.start_at)} → {fmtDateTime(b.end_at)}</>}
        actions={<><Badge value={b.status} label={STATUS_LABEL[b.status]} /><Link href={`/customers/${b.customer_id}`} className="btn-secondary btn-sm">Customer</Link></>}
      />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      {newReceipt && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm flex flex-wrap items-center gap-2">
          Receipt <b>{newReceipt.number}</b> issued.
          <Link href={`/doc/${newReceipt.id}`} className="btn-secondary btn-sm">View / print</Link>
          {wa(newReceipt) && <a href={wa(newReceipt)!} target="_blank" rel="noreferrer" className="btn-green btn-sm">Send on WhatsApp</a>}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="card card-pad"><div className="text-xs muted">Total</div><div className="text-xl font-semibold">{inr(b.total)}</div></div>
        <div className="card card-pad"><div className="text-xs muted">Received</div><div className="text-xl font-semibold text-emerald-700">{inr(b.received)}</div></div>
        <div className="card card-pad"><div className="text-xs muted">Refunded</div><div className="text-xl font-semibold">{inr(b.refunded)}</div></div>
        <div className={`card card-pad ${balance > 0 ? 'border-amber-300' : ''}`}><div className="text-xs muted">Balance due</div><div className={`text-xl font-semibold ${balance > 0 ? 'text-amber-700' : ''}`}>{inr(balance)}</div></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Status">
            <div className="flex flex-wrap gap-2 items-start">
              {['enquiry', 'quoted'].includes(b.status) && <form action={setStatusAction}><Hidden name="booking_id" value={b.id} /><Hidden name="to" value="confirmed" /><SubmitButton className="btn-green">Confirm booking</SubmitButton></form>}
              {b.status === 'confirmed' && <form action={setStatusAction}><Hidden name="booking_id" value={b.id} /><Hidden name="to" value="completed" /><SubmitButton className="btn-secondary">Mark completed</SubmitButton></form>}
              {b.status === 'cancelled' && <form action={setStatusAction}><Hidden name="booking_id" value={b.id} /><Hidden name="to" value="enquiry" /><SubmitButton className="btn-secondary">Reopen as enquiry</SubmitButton></form>}
              {editable && (
                <Reveal label="Cancel booking" danger>
                  <form action={setStatusAction} className="space-y-2">
                    <Hidden name="booking_id" value={b.id} /><Hidden name="to" value="cancelled" />
                    <input name="reason" required placeholder="Reason for cancelling" className="input" />
                    <SubmitButton className="btn-danger">Yes, cancel this booking</SubmitButton>
                    {netPaid > 0 && <p className="text-xs muted">{inr(netPaid)} has been paid. After cancelling, record any refund below.</p>}
                  </form>
                </Reveal>
              )}
            </div>
            {b.status === 'cancelled' && <p className="text-sm mt-2 text-red-700">Cancelled {fmtDateTime(b.cancelled_at)}: {b.cancel_reason}</p>}
          </Card>

          <Card title="Rooms, spaces & items" pad={false}>
            {b.items.length === 0 ? <div className="card-pad"><Empty>No rooms or items yet — add them below.</Empty></div> : (
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Item</th><th className="hidden sm:table-cell">When</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th></th></tr></thead>
                <tbody>
                  {b.items.map((i: any) => (
                    <tr key={i.id}>
                      <td>{i.description}{i.space_id && <span className="ml-1">{i.holds ? <Badge value="confirmed" label="blocked" /> : <Badge value="tentative" label="not blocked yet" />}</span>}</td>
                      <td className="hidden sm:table-cell text-xs whitespace-nowrap">{i.start_at ? <>{fmtDateTime(i.start_at)}<br />{fmtDateTime(i.end_at)}</> : ''}</td>
                      <td className="text-right">{Number(i.qty)}</td><td className="text-right">{inr(i.unit_price)}</td><td className="text-right">{inr(i.amount)}</td>
                      <td>{editable && <form action={removeItemAction}><Hidden name="booking_id" value={b.id} /><Hidden name="item_id" value={i.id} /><SubmitButton className="text-xs text-red-600 hover:underline" pendingText="…">Remove</SubmitButton></form>}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={4} className="text-right muted hidden sm:table-cell">Subtotal</td><td colSpan={1} className="text-right sm:hidden muted">Subtotal</td><td className="text-right">{inr(b.subtotal)}</td><td /></tr>
                  {Number(b.discount) > 0 && <tr><td colSpan={4} className="text-right muted hidden sm:table-cell">Discount</td><td className="text-right sm:hidden muted">Discount</td><td className="text-right">−{inr(b.discount)}</td><td /></tr>}
                  <tr className="font-semibold"><td colSpan={4} className="text-right hidden sm:table-cell">Total</td><td className="text-right sm:hidden">Total</td><td className="text-right">{inr(b.total)}</td><td /></tr>
                </tbody>
              </table></div>
            )}
            {editable && (
              <div className="card-pad border-t border-slate-100 grid sm:grid-cols-2 gap-3">
                <Reveal label="+ Add room / space">
                  <form action={addItemAction} className="space-y-2">
                    <Hidden name="booking_id" value={b.id} /><Hidden name="line_type" value="space" />
                    <select name="space_id" required className="input">{spaces.filter((s) => s.price !== null).map((s) => <option key={s.id} value={s.id}>{s.property_name} · {s.name} ({inr(s.price)}/{s.price_unit})</option>)}</select>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="From date"><input type="date" name="start_date" required defaultValue={istDate(new Date(b.start_at))} className="input" /></Field>
                      <Field label="time"><input type="time" name="start_time" defaultValue="14:00" className="input" /></Field>
                      <Field label="To date"><input type="date" name="end_date" required defaultValue={istDate(new Date(b.end_at))} className="input" /></Field>
                      <Field label="time"><input type="time" name="end_time" defaultValue="11:00" className="input" /></Field>
                      <Field label="Quantity (nights/slots)"><input type="number" name="qty" min="0.5" step="0.5" defaultValue={1} className="input" /></Field>
                      <Field label="Rate (₹)"><input type="number" name="unit_price" min="0" step="1" required className="input" /></Field>
                    </div>
                    <SubmitButton className="btn-secondary">Add room / space</SubmitButton>
                  </form>
                </Reveal>
                <Reveal label="+ Add food / extra">
                  <form action={addItemAction} className="space-y-2">
                    <Hidden name="booking_id" value={b.id} />
                    <select name="line_type" className="input" defaultValue="food"><option value="food">Food</option><option value="extra">Extra (decoration, DJ…)</option></select>
                    <input name="description" required placeholder="e.g. Veg dinner buffet" className="input" />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Quantity"><input type="number" name="qty" min="0.5" step="0.5" defaultValue={1} className="input" /></Field>
                      <Field label="Rate (₹)"><input type="number" name="unit_price" min="0" step="1" required className="input" /></Field>
                    </div>
                    <SubmitButton className="btn-secondary">Add item</SubmitButton>
                  </form>
                </Reveal>
              </div>
            )}
          </Card>

          <Card title="Payments">
            {b.payments.length === 0 ? <Empty>No payments recorded yet.</Empty> : (
              <div className="overflow-x-auto -mx-4 sm:-mx-5 mb-3"><table className="table">
                <thead><tr><th>Date</th><th>Type</th><th>Method</th><th className="text-right">Amount</th><th>Receipt</th><th></th></tr></thead>
                <tbody>{b.payments.map((p: any) => (
                  <tr key={p.id} className={p.voided_at ? 'text-slate-400' : ''}>
                    <td>{fmtDate(p.paid_on)}</td>
                    <td>{PAYMENT_KIND_LABEL[p.kind]}{p.voided_at && <> <Badge value="void" label="VOID" /><div className="text-xs">{p.void_reason}</div></>}</td>
                    <td>{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? <div className="text-xs muted">{p.reference}</div> : null}</td>
                    <td className={`text-right ${p.voided_at ? 'line-through' : ''} ${p.kind === 'refund' ? 'text-red-700' : ''}`}>{p.kind === 'refund' ? '−' : ''}{inr(p.amount)}</td>
                    <td>{p.doc_id ? <Link href={`/doc/${p.doc_id}`} className="link">{p.doc_number}</Link> : '—'}</td>
                    <td>{isOwner && !p.voided_at && (
                      <Reveal label="Void" danger>
                        <form action={voidPaymentAction} className="space-y-2"><Hidden name="booking_id" value={b.id} /><Hidden name="payment_id" value={p.id} />
                          <input name="reason" required placeholder="Reason" className="input" /><SubmitButton className="btn-danger btn-sm">Void payment</SubmitButton></form>
                      </Reveal>)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
            {b.status !== 'cancelled' && balance > 0 && Number(b.total) > 0 && (
              <form action={recordPaymentAction} className="grid sm:grid-cols-3 gap-2 pt-3 border-t border-slate-100">
                <Hidden name="booking_id" value={b.id} />
                <Field label="Type"><select name="kind" className="input" defaultValue={netPaid > 0 ? 'balance' : 'advance'}><option value="advance">Advance</option><option value="balance">Balance payment</option><option value="payment">Other payment</option></select></Field>
                <Field label={`Amount (₹, max ${inr(balance)})`}><input type="number" name="amount" min="1" max={balance} step="0.01" required className="input" /></Field>
                <Field label="Method"><select name="method" className="input" defaultValue="upi">{Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Reference (UPI / cheque no.)"><input name="reference" className="input" /></Field>
                <Field label="Date received"><input type="date" name="paid_on" defaultValue={istDate()} max={istDate()} className="input" /></Field>
                <Field label="Note"><input name="note" className="input" /></Field>
                {['enquiry', 'quoted'].includes(b.status) && <label className="sm:col-span-3 text-sm flex items-center gap-2"><input type="checkbox" name="confirm" defaultChecked /> Also confirm the booking (blocks the rooms/spaces)</label>}
                <div className="sm:col-span-3"><SubmitButton className="btn-green" pendingText="Recording…">Record payment & issue receipt</SubmitButton></div>
              </form>
            )}
            {netPaid > 0 && (
              <div className="pt-3 mt-3 border-t border-slate-100">
                <Reveal label="Record a refund">
                  <form action={recordRefundAction} className="grid sm:grid-cols-2 gap-2">
                    <Hidden name="booking_id" value={b.id} />
                    <Field label={`Refund amount (max ${inr(netPaid)})`}><input type="number" name="amount" min="1" max={netPaid} step="0.01" required className="input" /></Field>
                    <Field label="Method"><select name="method" className="input" defaultValue="upi">{Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Reference"><input name="reference" className="input" /></Field>
                    <Field label="Date"><input type="date" name="paid_on" defaultValue={istDate()} className="input" /></Field>
                    <Field label="Reason *" className="sm:col-span-2"><input name="note" required className="input" placeholder="e.g. Cancellation refund, ₹1,000 retained" /></Field>
                    <div className="sm:col-span-2"><SubmitButton className="btn-danger">Record refund & issue refund note</SubmitButton></div>
                  </form>
                </Reveal>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Documents">
            <div className="flex flex-wrap gap-2 mb-3">
              {b.status !== 'cancelled' && b.items.length > 0 && <form action={issueDocAction}><Hidden name="booking_id" value={b.id} /><Hidden name="type" value="quotation" /><SubmitButton className="btn-secondary btn-sm">{liveQuote ? 'Issue revised quotation' : 'Issue quotation'}</SubmitButton></form>}
              {['confirmed', 'completed'].includes(b.status) && <form action={issueDocAction}><Hidden name="booking_id" value={b.id} /><Hidden name="type" value="bill" /><SubmitButton className="btn-secondary btn-sm">{liveBill ? 'Issue revised final bill' : 'Issue final bill'}</SubmitButton></form>}
            </div>
            {b.documents.length === 0 ? <Empty>No documents yet.</Empty> : (
              <ul className="space-y-2 text-sm">{b.documents.slice().reverse().map((d: any) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/doc/${d.id}`} className="link font-medium">{DOC_LABEL[d.doc_type]} {d.number}</Link>
                  <Badge value={d.status} label={d.status === 'void' ? 'VOID' : inr(d.amount)} />
                  {d.status === 'issued' && wa(d) && <a href={wa(d)!} target="_blank" rel="noreferrer" className="text-xs link">WhatsApp</a>}
                  {d.status === 'void' && d.void_reason && <span className="text-xs muted w-full">{d.void_reason}</span>}
                  {isOwner && d.status === 'issued' && ['quotation', 'bill'].includes(d.doc_type) && (
                    <Reveal label="Void" danger>
                      <form action={voidDocumentAction} className="space-y-2"><Hidden name="booking_id" value={b.id} /><Hidden name="document_id" value={d.id} />
                        <input name="reason" required placeholder="Reason" className="input" /><SubmitButton className="btn-danger btn-sm">Void document</SubmitButton></form>
                    </Reveal>)}
                </li>))}</ul>
            )}
            {!appUrl && <p className="text-xs muted mt-3">Tip: set APP_PUBLIC_URL so WhatsApp messages include a link the customer can open.</p>}
          </Card>

          <Card title="Customer">
            <div className="text-sm space-y-1">
              <Link href={`/customers/${b.customer_id}`} className="link font-medium">{b.customer_name}</Link>
              <div>{formatPhone(b.customer_phone)}</div>
              {b.customer_email && <div>{b.customer_email}</div>}
              <div className="flex gap-2 pt-2">
                <Link href={`/inbox/${b.customer_id}`} className="btn-secondary btn-sm">WhatsApp chat</Link>
                {b.customer_phone && <a href={`tel:+${b.customer_phone}`} className="btn-secondary btn-sm">Call</a>}
              </div>
            </div>
          </Card>

          <Card title="Follow-up">
            {followUps.map((f) => <p key={f.id} className="text-sm mb-1"><b>{fmtDate(f.due_on)}</b> — {f.note}</p>)}
            <form action={addFollowUpAction} className="space-y-2 mt-2">
              <Hidden name="customer_id" value={b.customer_id} /><Hidden name="booking_id" value={b.id} /><Hidden name="back" value={back} />
              <input type="date" name="due_on" required defaultValue={addDays(istDate(), 1)} className="input" />
              <input name="note" required placeholder="e.g. Remind about balance" className="input" />
              <SubmitButton className="btn-secondary btn-sm">Add follow-up</SubmitButton>
            </form>
          </Card>

          <Card title="Details">
            <form action={updateDetailsAction} className="space-y-2">
              <Hidden name="booking_id" value={b.id} />
              <Field label="Assigned to"><select name="assigned_to" defaultValue={b.assigned_to ?? ''} className="input"><option value="">Not assigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Occasion"><select name="event_type" defaultValue={b.event_type ?? ''} className="input"><option value="">—</option>{Array.from(new Set([...EVENT_TYPES, ...(b.event_type ? [b.event_type] : [])])).map((e) => <option key={e}>{e}</option>)}</select></Field>
              <Field label="Guests"><input type="number" name="guests" min={0} defaultValue={b.guests ?? ''} className="input" /></Field>
              <Field label="Discount (₹)"><input type="number" name="discount" min={0} defaultValue={Number(b.discount)} disabled={!editable} className="input" /></Field>
              <Field label="Food & requirements"><textarea name="food_requirements" rows={2} defaultValue={b.food_requirements ?? ''} className="input" /></Field>
              <Field label="Notes"><textarea name="notes" rows={2} defaultValue={b.notes ?? ''} className="input" /></Field>
              {b.package_name && <p className="text-xs muted">Package: {b.package_name}</p>}
              <SubmitButton className="btn-secondary btn-sm">Save details</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  )
}
