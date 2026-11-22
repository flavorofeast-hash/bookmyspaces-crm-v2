import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { resetDb, closePool } from './helpers'
import { q, setupState } from '@/lib/db'
import { databaseUrl, metaEnv, appPublicUrl, crmEnv } from '@/lib/env'

const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })
afterAll(closePool)
const set = (o: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete (process.env as any)[k]; else (process.env as any)[k] = v } }

describe('environment isolation', () => {
  it('Preview never reads the production database variable', () => {
    set({ CRM_DATABASE_URL: undefined, CRM_ENV: undefined, VERCEL_ENV: 'preview', POSTGRES_URL: 'postgres://prod:x@prod-host:6543/postgres', CRMTEST_POSTGRES_URL: undefined })
    expect(databaseUrl()).toBeUndefined()
    set({ CRMTEST_POSTGRES_URL: 'postgres://test:x@test-host:6543/postgres?sslmode=require&supa=base-pooler.x' })
    expect(databaseUrl()).toBe('postgres://test:x@test-host:6543/postgres')
  })
  it('Production uses CRM_DATABASE_URL, else POSTGRES_URL; never the test one', () => {
    set({ CRM_DATABASE_URL: undefined, CRM_ENV: undefined, VERCEL_ENV: 'production', POSTGRES_URL: 'postgres://prod:x@prod-host:6543/postgres?pgbouncer=true', CRMTEST_POSTGRES_URL: 'postgres://t@t/t' })
    expect(databaseUrl()).toBe('postgres://prod:x@prod-host:6543/postgres')
    set({ CRM_DATABASE_URL: 'postgres://a@b/c' }); expect(databaseUrl()).toBe('postgres://a@b/c')
  })
  it('Preview ignores live WhatsApp/Meta values even if set for all environments', () => {
    set({ VERCEL_ENV: 'preview', WHATSAPP_ACCESS_TOKEN: 'LIVE', PREVIEW_WHATSAPP_ACCESS_TOKEN: undefined })
    expect(metaEnv('WHATSAPP_ACCESS_TOKEN')).toBeUndefined()
    set({ PREVIEW_WHATSAPP_ACCESS_TOKEN: 'TEST' }); expect(metaEnv('WHATSAPP_ACCESS_TOKEN')).toBe('TEST')
    set({ VERCEL_ENV: 'production' }); expect(metaEnv('WHATSAPP_ACCESS_TOKEN')).toBe('LIVE')
  })
  it('public address falls back to the Vercel production domain', () => {
    set({ APP_PUBLIC_URL: undefined, VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'crm.example.in' })
    expect(appPublicUrl()).toBe('https://crm.example.in')
    expect(crmEnv()).toBe('production')
  })
  it('a test copy refuses to run against a database that has the live CRM tables', async () => {
    await resetDb()
    set({ CRM_ENV: 'preview' })
    await q(`CREATE TABLE public.proposals (id int)`)
    try { await expect(setupState()).rejects.toThrow(/live CRM tables/) }
    finally { await q(`DROP TABLE public.proposals`) }
    expect(await setupState()).toBe('no-users')
  })
})
