import Link from 'next/link'
import { searchCustomers } from '@/lib/customers'
import { PageHeader, Card, Flash, Empty, Badge } from '@/components/ui'
import { formatPhone } from '@/lib/phone'
import { inr, fmtDate, SOURCE_LABEL } from '@/lib/format'

export default async function CustomersPage(props: { searchParams: Promise<{ q?: string; ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams
  const term = searchParams.q ?? ''
  const rows = await searchCustomers(term, 100)
  return (
    <>
      <PageHeader title="Customers" subtitle="Search by name, mobile or email" actions={<Link href="/customers/new" className="btn-primary">+ Add customer</Link>} />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={term} placeholder="Name, mobile or email…" className="input" autoFocus />
        <button className="btn-secondary">Search</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? <div className="card-pad"><Empty>{term ? 'No customers match. ' : 'No customers yet. '}<Link href="/customers/new" className="link">Add one</Link>.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Name</th><th>Mobile</th><th className="hidden sm:table-cell">Source</th><th className="hidden sm:table-cell">Bookings</th><th className="hidden md:table-cell">Next follow-up</th><th>Balance due</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td><Link href={`/customers/${c.id}`} className="link font-medium">{c.name}</Link>
                      {c.import_flags.includes('no_phone') && <span className="ml-1"><Badge value="tentative" label="no phone" /></span>}</td>
                    <td className="whitespace-nowrap">{formatPhone(c.phone)}</td>
                    <td className="hidden sm:table-cell">{SOURCE_LABEL[c.source] ?? c.source}</td>
                    <td className="hidden sm:table-cell">{c.bookings}</td>
                    <td className="hidden md:table-cell">{c.next_follow_up ? fmtDate(c.next_follow_up) : ''}</td>
                    <td className={Number(c.balance) > 0 ? 'text-amber-700 font-medium' : 'muted'}>{Number(c.balance) > 0 ? inr(c.balance) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
