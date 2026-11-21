import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { q1, setupState } from '@/lib/db'
import { Nav } from '@/components/nav'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if ((await setupState()) !== 'ready') redirect('/setup')
  const user = await requireUser()
  const [u, s] = await Promise.all([
    q1<{ n: number }>(`SELECT count(DISTINCT customer_id)::int AS n FROM crm.messages WHERE direction = 'in' AND NOT read_by_staff`),
    q1<{ business_name: string }>(`SELECT business_name FROM crm.business_settings WHERE id = 1`),
  ])
  return (
    <div className="min-h-screen">
      <Nav unread={u?.n ?? 0} userName={user.name} isOwner={user.role === 'owner'} businessName={s?.business_name ?? 'BookMySpaces'} />
      <main className="md:pl-56 pb-20 md:pb-8">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">{children}</div>
      </main>
    </div>
  )
}
