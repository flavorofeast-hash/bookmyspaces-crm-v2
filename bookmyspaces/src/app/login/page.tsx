import { redirect } from 'next/navigation'
import { attemptLogin, getCurrentUser } from '@/lib/auth'
import { setupState } from '@/lib/db'
import { SubmitButton } from '@/components/client'
import { Flash } from '@/components/ui'

export const dynamic = 'force-dynamic'

async function login(f: FormData) {
  'use server'
  const r = await attemptLogin(String(f.get('email') ?? ''), String(f.get('password') ?? ''))
  if (typeof r === 'string') redirect('/login?err=' + encodeURIComponent(r))
  redirect('/today')
}

export default async function LoginPage(props: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const searchParams = await props.searchParams
  const state = await setupState().catch(() => 'missing-config' as const)
  if (state !== 'ready') redirect('/setup')
  if (await getCurrentUser()) redirect('/today')
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card card-pad w-full max-w-sm">
        <h1 className="h1 mb-1">BookMySpaces CRM</h1>
        <p className="text-sm muted mb-5">Sign in to continue</p>
        <Flash err={searchParams.err} ok={searchParams.ok} />
        <form action={login} className="space-y-3">
          <label className="block"><span className="label">Username</span><input name="email" autoComplete="username" autoCapitalize="none" required className="input" /></label>
          <label className="block"><span className="label">Password</span><input name="password" type="password" autoComplete="current-password" required className="input" /></label>
          <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
        </form>
      </div>
    </main>
  )
}
