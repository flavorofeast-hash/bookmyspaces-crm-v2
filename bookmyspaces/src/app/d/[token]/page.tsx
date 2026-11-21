import { notFound } from 'next/navigation'
import { getDocument } from '@/lib/billing'
import { DocumentView } from '@/components/document-view'
import { PrintButton } from '@/components/client'

export const dynamic = 'force-dynamic'

// Public, customer-facing copy of one document. The token is a random
// 24-character secret generated per document; nothing else is exposed.
export default async function PublicDocPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(params.token)) notFound()
  const doc = await getDocument({ token: params.token }).catch(() => null)
  if (!doc) notFound()
  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <div className="no-print max-w-3xl mx-auto p-3"><PrintButton label="Download / print" /></div>
      <div className="pb-8 print:pb-0"><DocumentView doc={doc} /></div>
    </div>
  )
}
