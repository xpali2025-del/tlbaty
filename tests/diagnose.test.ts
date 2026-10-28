import { describe, expect, it } from 'vitest'
import { checkDatabaseUrl, checkEnv, pendingMigrations, suggestRegion } from '@/lib/diagnose'

const GOOD_DB = 'postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
const KEY32 = Buffer.alloc(32, 7).toString('base64')

describe('checkDatabaseUrl', () => {
  it('accepts a real pooler URL', () => {
    expect(checkDatabaseUrl(GOOD_DB)).toBeNull()
  })
  it('flags the example placeholders copied as-is', () => {
    expect(checkDatabaseUrl('postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres')).toMatch('النص النموذجي')
    expect(checkDatabaseUrl('postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres')).toMatch('النص النموذجي')
  })
  it('flags malformed URLs, a missing password and a pooler user without the project ref', () => {
    expect(checkDatabaseUrl('not a url')).toMatch('ليس رابطاً')
    expect(checkDatabaseUrl('https://example.com')).toMatch('postgresql://')
    expect(checkDatabaseUrl('postgresql://postgres@db.abcd.supabase.co:5432/postgres')).toMatch('بلا كلمة مرور')
    expect(checkDatabaseUrl('postgresql://postgres:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres')).toMatch('postgres.<رمز المشروع>')
  })
})

describe('checkEnv', () => {
  const byName = (env: Record<string, string>) => Object.fromEntries(checkEnv(env).map((c) => [c.name, c]))

  it('marks required variables missing and optional ones as optional, never echoing values', () => {
    const r = byName({})
    expect(r.DATABASE_URL.status).toBe('missing')
    expect(r.SESSION_SECRET.status).toBe('missing')
    expect(r.R2_BUCKET.status).toBe('missing')
    expect(r.CRON_SECRET.status).toBe('optional')
    expect(r.WHATSAPP_WORKER_URL.status).toBe('optional')
  })

  it('validates formats', () => {
    const r = byName({ DATABASE_URL: GOOD_DB, SESSION_SECRET: 'short', PAYMENT_PROOF_ENCRYPTION_KEY: 'abc', R2_PUBLIC_URL: 'cdn.example.com', OTP_PROVIDER: 'telegram' })
    expect(r.DATABASE_URL.status).toBe('ok')
    expect(r.SESSION_SECRET.status).toBe('invalid')
    expect(r.PAYMENT_PROOF_ENCRYPTION_KEY.status).toBe('invalid')
    expect(r.R2_PUBLIC_URL.status).toBe('invalid')
    expect(r.OTP_PROVIDER.status).toBe('invalid')
    const good = byName({ SESSION_SECRET: 'x'.repeat(16), PAYMENT_PROOF_ENCRYPTION_KEY: KEY32, R2_PUBLIC_URL: 'https://cdn.example.com', OTP_PROVIDER: 'SMS' })
    expect([good.SESSION_SECRET.status, good.PAYMENT_PROOF_ENCRYPTION_KEY.status, good.R2_PUBLIC_URL.status, good.OTP_PROVIDER.status]).toEqual(['ok', 'ok', 'ok', 'ok'])
    for (const c of checkEnv({ SESSION_SECRET: 'super-secret-value-123', DATABASE_URL: GOOD_DB })) {
      expect(c.note).not.toContain('super-secret-value-123')
      expect(c.note).not.toContain('secret@')
    }
  })

  it('reads NAME_2 first, like the app does, and says so', () => {
    const r = byName({ DATABASE_URL: 'postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres', DATABASE_URL_2: GOOD_DB })
    expect(r.DATABASE_URL.status).toBe('ok')
    expect(r.DATABASE_URL.fromAlias).toBe(true)
    expect(r.DATABASE_URL.note).toContain('DATABASE_URL_2')
  })
})

describe('suggestRegion', () => {
  it('maps the Supabase pooler region to the nearest Vercel region', () => {
    expect(suggestRegion(GOOD_DB)).toEqual({ dbRegion: 'eu-central-1', vercelRegion: 'fra1' })
    expect(suggestRegion('postgresql://u:p@aws-1-us-east-1.pooler.supabase.com:6543/postgres')).toEqual({ dbRegion: 'us-east-1', vercelRegion: 'iad1' })
    expect(suggestRegion('postgresql://u:p@localhost:5432/db')).toBeNull()
    expect(suggestRegion(undefined)).toBeNull()
  })
})

describe('pendingMigrations', () => {
  const journal = [{ tag: '0000_a', when: 100 }, { tag: '0001_b', when: 200 }, { tag: '0002_c', when: 300 }]
  it('lists every migration newer than the last applied one, like the drizzle migrator', () => {
    expect(pendingMigrations(journal, null)).toEqual(['0000_a', '0001_b', '0002_c'])
    expect(pendingMigrations(journal, 200)).toEqual(['0002_c'])
    expect(pendingMigrations(journal, 300)).toEqual([])
  })
})
