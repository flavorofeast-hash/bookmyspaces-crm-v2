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
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
          {user.uses_default_password && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Test login <b>admin / admin</b> is in use. Fine for testing — change it in <a href="/settings#users" className="link">Settings → Login</a> before real use.
            </div>)}
          {children}
        </div>
      </main>
    </div>
  )
}
