import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { PageHeader, Card, Flash, Badge, Empty, Stat } from '@/components/ui'
import { inr, fmtDate, fmtDateTime, DOC_LABEL, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, STATUS_LABEL } from '@/lib/format'

type SP = { tab?: string; type?: string; ok?: string; err?: string }

export default async function BillingPage({ searchParams: sp }: { searchParams: SP }) {
  const tab = ['documents', 'transactions'].includes(sp.tab ?? '') ? sp.tab! : 'outstanding'
  const totals = await q1<any>(`SELECT
      (SELECT COALESCE(sum(bb.balance),0) FROM crm.booking_balances bb JOIN crm.bookings b ON b.id = bb.booking_id WHERE b.status IN ('confirmed','completed') AND bb.balance > 0) AS outstanding,
      (SELECT COALESCE(sum(amount),0) FROM crm.payments WHERE voided_at IS NULL AND kind <> 'refund' AND date_trunc('month', paid_on) = date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS received_month,
      (SELECT COALESCE(sum(amount),0) FROM crm.payments WHERE voided_at IS NULL AND kind = 'refund' AND date_trunc('month', paid_on) = date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS refunded_month,
      (SELECT COALESCE(sum(total),0) FROM crm.bookings WHERE status = 'quoted') AS open_quotes`)
  const outstanding = tab === 'outstanding' ? await q<any>(
    `SELECT b.id, b.ref, b.status, b.start_at, b.total, bb.net_paid, bb.balance, c.name AS customer_name, c.id AS customer_id
     FROM crm.bookings b JOIN crm.booking_balances bb ON bb.booking_id = b.id JOIN crm.customers c ON c.id = b.customer_id
     WHERE b.status IN ('confirmed','completed') AND bb.balance > 0 ORDER BY b.start_at`) : []
  const docs = tab === 'documents' ? await q<any>(
    `SELECT d.*, b.ref, c.name AS customer_name FROM crm.documents d JOIN crm.bookings b ON b.id = d.booking_id JOIN crm.customers c ON c.id = d.customer_id
     WHERE ($1::text IS NULL OR d.doc_type = $1) ORDER BY d.issued_at DESC LIMIT 300`, [sp.type || null]) : []
  const tx = tab === 'transactions' ? await q<any>(
    `SELECT p.*, b.ref, c.name AS customer_name, d.id AS doc_id, d.number AS doc_number, u.name AS user_name
     FROM crm.payments p JOIN crm.bookings b ON b.id = p.booking_id JOIN crm.customers c ON c.id = p.customer_id
     LEFT JOIN crm.documents d ON d.payment_id = p.id AND (d.status = 'issued' OR p.voided_at IS NOT NULL)
     LEFT JOIN crm.app_users u ON u.id = p.created_by ORDER BY p.created_at DESC LIMIT 300`) : []
  const tabs = [['outstanding', 'Outstanding balances'], ['documents', 'Quotations, bills & receipts'], ['transactions', 'All transactions']]
  return (
    <>
      <PageHeader title="Billing" subtitle="Payments are recorded on each booking. This page shows everything in one place." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Outstanding balances" value={inr(totals.outstanding)} tone={Number(totals.outstanding) > 0 ? 'warn' : undefined} />
        <Stat label="Received this month" value={inr(totals.received_month)} tone="good" />
        <Stat label="Refunded this month" value={inr(totals.refunded_month)} />
        <Stat label="Open quotations" value={inr(totals.open_quotes)} />
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {tabs.map(([k, l]) => <Link key={k} href={`/billing?tab=${k}`} className={tab === k ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{l}</Link>)}
      </div>
      {tab === 'outstanding' && (
        <Card pad={false}>{outstanding.length === 0 ? <div className="card-pad"><Empty>No outstanding balances.</Empty></div> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Booking</th><th>Customer</th><th>Date</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="text-right">Balance</th></tr></thead>
            <tbody>{outstanding.map((b) => (
              <tr key={b.id}><td><Link href={`/bookings/${b.id}`} className="link font-medium">{b.ref}</Link></td><td><Link href={`/customers/${b.customer_id}`} className="link">{b.customer_name}</Link></td>
                <td className="whitespace-nowrap">{fmtDate(b.start_at)}</td><td><Badge value={b.status} label={STATUS_LABEL[b.status]} /></td>
                <td className="text-right">{inr(b.total)}</td><td className="text-right">{inr(b.net_paid)}</td><td className="text-right font-medium text-amber-700">{inr(b.balance)}</td></tr>))}</tbody>
          </table></div>)}
        </Card>
      )}
      {tab === 'documents' && (
        <>
          <div className="flex gap-2 mb-3 text-sm">
            {[['', 'All'], ['quotation', 'Quotations'], ['bill', 'Bills'], ['receipt', 'Receipts'], ['refund', 'Refund notes']].map(([k, l]) => (
              <Link key={k} href={`/billing?tab=documents${k ? `&type=${k}` : ''}`} className={(sp.type ?? '') === k ? 'font-semibold underline' : 'link'}>{l}</Link>))}
          </div>
          <Card pad={false}>{docs.length === 0 ? <div className="card-pad"><Empty>No documents yet.</Empty></div> : (
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>Number</th><th>Type</th><th>Customer</th><th>Booking</th><th>Issued</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
              <tbody>{docs.map((d) => (
                <tr key={d.id}><td><Link href={`/doc/${d.id}`} className="link font-mono">{d.number}</Link></td><td>{DOC_LABEL[d.doc_type]}</td><td>{d.customer_name}</td>
                  <td><Link href={`/bookings/${d.booking_id}`} className="link">{d.ref}</Link></td><td className="whitespace-nowrap">{fmtDateTime(d.issued_at)}</td>
                  <td className="text-right">{inr(d.amount)}</td><td><Badge value={d.status} label={d.status === 'void' ? 'VOID' : 'Issued'} /></td></tr>))}</tbody>
            </table></div>)}
          </Card>
        </>
      )}
      {tab === 'transactions' && (
        <Card pad={false}>{tx.length === 0 ? <div className="card-pad"><Empty>No transactions yet.</Empty></div> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Date</th><th>Customer</th><th>Booking</th><th>Type</th><th>Method</th><th className="text-right">Amount</th><th>Receipt</th><th className="hidden md:table-cell">By</th></tr></thead>
            <tbody>{tx.map((p) => (
              <tr key={p.id} className={p.voided_at ? 'text-slate-400' : ''}><td className="whitespace-nowrap">{fmtDate(p.paid_on)}</td><td>{p.customer_name}</td>
                <td><Link href={`/bookings/${p.booking_id}`} className="link">{p.ref}</Link></td>
                <td>{PAYMENT_KIND_LABEL[p.kind]}{p.voided_at && <> <Badge value="void" label="VOID" /></>}</td><td>{PAYMENT_METHOD_LABEL[p.method]}</td>
                <td className={`text-right ${p.kind === 'refund' ? 'text-red-700' : ''} ${p.voided_at ? 'line-through' : ''}`}>{p.kind === 'refund' ? '−' : ''}{inr(p.amount)}</td>
                <td>{p.doc_id ? <Link href={`/doc/${p.doc_id}`} className="link font-mono text-xs">{p.doc_number}</Link> : '—'}</td><td className="hidden md:table-cell text-xs">{p.user_name ?? ''}</td></tr>))}</tbody>
          </table></div>)}
        </Card>
      )}
    </>
  )
}
