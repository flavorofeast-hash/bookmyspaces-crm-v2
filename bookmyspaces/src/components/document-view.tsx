import { inr, fmtDate, fmtDateTime, DOC_LABEL, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, BOOKING_TYPE_LABEL } from '@/lib/format'
import { formatPhone } from '@/lib/phone'

/** Renders a frozen document snapshot. Everything printed comes from doc.content, so it never changes after issue. */
export function DocumentView({ doc }: { doc: any }) {
  const c = doc.content
  const biz = c.business ?? {}
  const isPayment = doc.doc_type === 'receipt' || doc.doc_type === 'refund'
  const title = doc.doc_type === 'bill' ? 'Bill' : DOC_LABEL[doc.doc_type]
  return (
    <article className="relative bg-white max-w-3xl mx-auto p-6 sm:p-10 text-sm text-slate-800 print:p-0">
      {doc.status === 'void' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-red-500/30 text-[120px] font-black -rotate-12 select-none">VOID</span>
        </div>
      )}
      <header className="flex flex-wrap justify-between gap-4 border-b border-slate-200 pb-4 mb-4">
        <div>
          <div className="text-xl font-bold">{biz.business_name}</div>
          {biz.address && <div className="whitespace-pre-line text-slate-600">{biz.address}</div>}
          <div className="text-slate-600">{[biz.phone, biz.email].filter(Boolean).join(' · ')}</div>
          {biz.gst_number && <div className="text-slate-600">GSTIN: {biz.gst_number}</div>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold uppercase tracking-wide">{title}</div>
          <div className="font-mono">{doc.number}</div>
          <div className="text-slate-600">Date: {fmtDate(doc.issued_at)}</div>
          {doc.status === 'void' && <div className="text-red-600 font-semibold">VOID — {doc.void_reason}</div>}
        </div>
      </header>

      <section className="grid sm:grid-cols-2 gap-4 mb-5">
        <div>
          <div className="text-xs uppercase text-slate-500">{isPayment ? (doc.doc_type === 'refund' ? 'Refunded to' : 'Received from') : 'Customer'}</div>
          <div className="font-medium">{c.customer?.name}</div>
          <div>{formatPhone(c.customer?.phone)}</div>
          {c.customer?.email && <div>{c.customer.email}</div>}
        </div>
        <div>
          <div className="text-xs uppercase text-slate-500">Booking</div>
          <div className="font-medium">{c.booking?.ref} · {BOOKING_TYPE_LABEL[c.booking?.booking_type] ?? ''}{c.booking?.event_type ? ` · ${c.booking.event_type}` : ''}</div>
          <div>{fmtDateTime(c.booking?.start_at)} → {fmtDateTime(c.booking?.end_at)}</div>
          {c.booking?.guests ? <div>{c.booking.guests} guests</div> : null}
          {c.booking?.property && <div>{c.booking.property}</div>}
        </div>
      </section>

      {isPayment ? (
        <section className="mb-5 rounded-lg border border-slate-200 p-4">
          <div className="flex justify-between text-base"><span>{PAYMENT_KIND_LABEL[c.payment?.kind] ?? 'Payment'}</span><b>{doc.doc_type === 'refund' ? '−' : ''}{inr(doc.amount)}</b></div>
          <div className="text-slate-600 mt-1">Method: {PAYMENT_METHOD_LABEL[c.payment?.method] ?? c.payment?.method}{c.payment?.reference ? ` · Ref ${c.payment.reference}` : ''}</div>
          {c.payment?.reason && <div className="text-slate-600">Reason: {c.payment.reason}</div>}
        </section>
      ) : (
        <table className="w-full mb-4">
          <thead><tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500"><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            {(c.lines ?? []).map((l: any, i: number) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2">{l.description}{l.start_at && <div className="text-xs text-slate-500">{fmtDateTime(l.start_at)} – {fmtDateTime(l.end_at)}</div>}</td>
                <td className="py-2 text-right">{Number(l.qty)}</td><td className="py-2 text-right">{inr(l.unit_price)}</td><td className="py-2 text-right">{inr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="ml-auto max-w-xs space-y-1 mb-6">
        {!isPayment && <>
          <div className="flex justify-between"><span>Subtotal</span><span>{inr(c.subtotal)}</span></div>
          {Number(c.discount) > 0 && <div className="flex justify-between"><span>Discount</span><span>−{inr(c.discount)}</span></div>}
        </>}
        <div className="flex justify-between font-semibold border-t border-slate-200 pt-1"><span>Booking total</span><span>{inr(doc.doc_type === 'quotation' ? doc.amount : c.total)}</span></div>
        {doc.doc_type !== 'quotation' && <>
          <div className="flex justify-between"><span>Paid to date{Number(c.refunded) > 0 ? ' (after refunds)' : ''}</span><span>{inr(doc.paid_to_date)}</span></div>
          <div className="flex justify-between font-semibold text-base"><span>Balance due</span><span>{inr(doc.balance)}</span></div>
        </>}
        <div className="text-xs text-slate-500 pt-1">{c.tax?.enabled ? '' : 'GST not applicable.'}</div>
      </section>

      {doc.doc_type === 'bill' && (c.payments ?? []).length > 0 && (
        <section className="mb-6">
          <div className="text-xs uppercase text-slate-500 mb-1">Payments received</div>
          <table className="w-full text-xs">
            <tbody>{c.payments.map((p: any) => (
              <tr key={p.id} className="border-b border-slate-100"><td className="py-1">{fmtDate(p.paid_on)}</td><td>{PAYMENT_KIND_LABEL[p.kind]}</td><td>{PAYMENT_METHOD_LABEL[p.method]}</td><td>{p.document_number}</td><td className="text-right">{p.kind === 'refund' ? '−' : ''}{inr(p.amount)}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {(biz.upi_id || biz.bank_details) && !isPayment && Number(doc.balance) > 0 && (
        <section className="mb-4 text-xs text-slate-600">
          <div className="uppercase text-slate-500">How to pay</div>
          {biz.upi_id && <div>UPI: {biz.upi_id}</div>}
          {biz.bank_details && <div className="whitespace-pre-line">{biz.bank_details}</div>}
        </section>
      )}
      {doc.doc_type === 'quotation' && <p className="text-xs text-slate-500 mb-2">This is a quotation, not a bill. Rooms and spaces are reserved only after the booking is confirmed.</p>}
      {biz.document_footer && <footer className="text-center text-xs text-slate-500 border-t border-slate-200 pt-3">{biz.document_footer}</footer>}
    </article>
  )
}
