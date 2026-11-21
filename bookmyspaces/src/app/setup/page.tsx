import { redirect } from 'next/navigation'
import { timingSafeEqual } from 'crypto'
import { setupState, pool } from '@/lib/db'
import { applyMigrations } from '@/lib/migrate'
import { createUser } from '@/lib/setup'
import { setSessionCookie } from '@/lib/auth'
import { SubmitButton } from '@/components/client'
import { Flash } from '@/components/ui'

export const dynamic = 'force-dynamic'

function codeOk(given: string): boolean {
  const expected = process.env.CRM_SETUP_CODE ?? ''
  if (expected.length < 8) return false
  const a = Buffer.from(given), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function initDb(f: FormData) {
  'use server'
  if (!codeOk(String(f.get('code') ?? ''))) redirect('/setup?err=' + encodeURIComponent('Setup code is incorrect.'))
  if ((await setupState()) !== 'missing-schema') redirect('/setup')
  let msg = ''
  try { await applyMigrations(pool()) } catch (e) { msg = (e as Error).message }
  redirect(msg ? '/setup?err=' + encodeURIComponent(msg) : '/setup?ok=' + encodeURIComponent('Database tables created.'))
}

async function createOwner(f: FormData) {
  'use server'
  if (!codeOk(String(f.get('code') ?? ''))) redirect('/setup?err=' + encodeURIComponent('Setup code is incorrect.'))
  if ((await setupState()) !== 'no-users') redirect('/login')
  let err = ''
  try {
    const u = await createUser(f, 'owner')
    await setSessionCookie(u.id, u.session_version)
  } catch (e) { err = (e as Error).message }
  redirect(err ? '/setup?err=' + encodeURIComponent(err) : '/settings?ok=' + encodeURIComponent('Welcome! Start by entering your business details, properties and rooms.'))
}

export default async function SetupPage(props: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const searchParams = await props.searchParams
  let state: Awaited<ReturnType<typeof setupState>>
  let dbError = ''
  try { state = await setupState() } catch (e) { state = 'missing-config'; dbError = (e as Error).message }
  if (state === 'ready') redirect('/login')
  const codeSet = (process.env.CRM_SETUP_CODE ?? '').length >= 8
  const secretSet = (process.env.SESSION_SECRET ?? '').length >= 32
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card card-pad w-full max-w-lg space-y-4">
        <h1 className="h1">BookMySpaces CRM — first-time setup</h1>
        <Flash err={searchParams.err} ok={searchParams.ok} />
        {state === 'missing-config' && (
          <div className="text-sm space-y-2">
            <p>The database is not connected yet{dbError ? ` (${dbError})` : ''}.</p>
            <p>In Vercel → Project → Settings → Environment Variables, add <b>CRM_DATABASE_URL</b> (Supabase → Project Settings → Database → Connection string, “Session pooler”), <b>SESSION_SECRET</b> (any random text, 32+ characters) and <b>CRM_SETUP_CODE</b> (a code only you know, 8+ characters). Then redeploy.</p>
          </div>
        )}
        {state !== 'missing-config' && (!codeSet || !secretSet) && (
          <p className="text-sm text-red-700">Setup is locked: {!codeSet && 'CRM_SETUP_CODE (8+ characters) '}{!secretSet && 'SESSION_SECRET (32+ characters) '}must be set in the environment first.</p>
        )}
        {state === 'missing-schema' && codeSet && (
          <form action={initDb} className="space-y-3">
            <p className="text-sm">Step 1 of 2: create the CRM tables. This only adds a new <code>crm</code> area to the database; existing tables are not touched.</p>
            <label className="block"><span className="label">Setup code</span><input name="code" type="password" required className="input" /></label>
            <SubmitButton pendingText="Creating tables…">Create database tables</SubmitButton>
          </form>
        )}
        {state === 'no-users' && codeSet && secretSet && (
          <form action={createOwner} className="space-y-3">
            <p className="text-sm">Step 2 of 2: create the owner account.</p>
            <label className="block"><span className="label">Your name</span><input name="name" required className="input" /></label>
            <label className="block"><span className="label">Email</span><input name="email" type="email" required className="input" /></label>
            <label className="block"><span className="label">Password (8+ characters)</span><input name="password" type="password" minLength={8} required className="input" /></label>
            <label className="block"><span className="label">Setup code</span><input name="code" type="password" required className="input" /></label>
            <SubmitButton pendingText="Creating…">Create owner account</SubmitButton>
          </form>
        )}
      </div>
    </main>
  )
}
