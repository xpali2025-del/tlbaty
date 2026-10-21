import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

const pg = new PGlite()
const db = drizzle(pg)
vi.mock('@/lib/db/client', () => ({ db }))
const { purgeExpiredAuthData } = await import('@/lib/maintenance')
const { GET } = await import('@/app/api/cron/cleanup/route')

const now = new Date('2026-10-21T12:00:00Z')
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})

describe('migrations', () => {
  it('enable row level security on every store table', async () => {
    const r = await pg.query<{ n: number }>(`select count(*)::int as n from pg_tables t join pg_class c on c.relname = t.tablename join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = t.schemaname where t.schemaname = 'store' and not c.relrowsecurity`)
    expect(r.rows[0].n).toBe(0)
  })
})

describe('purgeExpiredAuthData', () => {
  it('removes only long-expired rows and old events', async () => {
    const [c] = await db.insert(s.customers).values({ publicId: 'CUS_M', phone: '967700000001' }).returning()
    await db.insert(s.authEvents).values([
      { event: 'otp_sent', phone: '1', at: ago(100) },
      { event: 'otp_sent', phone: '2', at: ago(1) },
    ] as never)
    await db.insert(s.customerSessions).values([
      { customerId: c.id, tokenHash: 'old', createdAt: ago(40), expiresAt: ago(10) },
      { customerId: c.id, tokenHash: 'live', createdAt: ago(1), expiresAt: new Date(now.getTime() + 86_400_000) },
      { customerId: c.id, tokenHash: 'revoked-old', revoked: true, createdAt: ago(5), expiresAt: new Date(now.getTime() + 86_400_000) },
    ] as never)
    const deleted = await purgeExpiredAuthData(now)
    expect(deleted.authEvents).toBe(1)
    expect(deleted.sessions).toBe(2)
    expect((await db.select().from(s.customerSessions)).map((x) => x.tokenHash)).toEqual(['live'])
    expect(await db.select().from(s.authEvents)).toHaveLength(1)
  })
})

describe('cron route', () => {
  const call = (auth?: string) => GET(new Request('http://x/api/cron/cleanup', { headers: auth ? { authorization: auth } : {} }) as never)
  it('rejects without a configured or matching secret', async () => {
    delete process.env.CRON_SECRET
    expect((await call('Bearer anything')).status).toBe(401)
    process.env.CRON_SECRET = 'sekret'
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong!')).status).toBe(401)
    expect((await call('Bearer sekret')).status).toBe(200)
  })
})
