import { appPublicUrl } from '@/lib/env'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { getDocument } from '@/lib/billing'
import { DocumentView } from '@/components/document-view'
import { PrintButton, CopyButton } from '@/components/client'

export const dynamic = 'force-dynamic'

export default async function DocPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireUser()
  const doc = await getDocument({ id: params.id }).catch(() => null)
  if (!doc) notFound()
  const base = appPublicUrl()
  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <div className="no-print flex flex-wrap items-center gap-2 max-w-3xl mx-auto p-3">
        <Link href={`/bookings/${doc.booking_id}`} className="btn-secondary">← Back to booking</Link>
        <PrintButton />
        {base && <CopyButton text={`${base}/d/${doc.public_token}`} label="Copy customer link" />}
        <span className="text-xs muted">To download: Print → “Save as PDF”.</span>
      </div>
      <div className="pb-8 print:pb-0"><div className="shadow-sm print:shadow-none"><DocumentView doc={doc} /></div></div>
    </div>
  )
}
