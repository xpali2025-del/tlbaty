import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

const pg = new PGlite()
const db = drizzle(pg)
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
const proofs = vi.hoisted(() => ({ del: vi.fn(async (_k: string | null | undefined) => {}) }))
vi.mock('@/lib/storage/proofs', () => ({ deletePaymentProof: proofs.del }))
const { purgeExpiredAuthData, purgeOldPaymentProofs, PROOF_PURGE_BATCH } = await import('@/lib/maintenance')
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

describe('purgeOldPaymentProofs', () => {
  let seq = 0
  const KEY = (n: number) => `payment-proofs/00000000-0000-4000-8000-${String(n).padStart(12, '0')}/11111111-1111-4111-8111-111111111111.enc`
  async function proofOrder(over: Partial<typeof s.orders.$inferInsert>) {
    const n = ++seq
    const [o] = await db.insert(s.orders).values({ orderNumber: `ORD-P-${n}`, customerName: 'x', phone: '1', subtotal: 1, total: 1, paymentMethod: 'manual_transfer', ...over }).returning()
    await db.insert(s.orderPaymentProofs).values({ orderId: o.id, objectKey: KEY(n), iv: 'a', authTag: 'b', keyVersion: '1' })
    return { id: o.id, key: KEY(n) }
  }
  const remaining = async () => (await db.select().from(s.orderPaymentProofs)).map((p) => p.objectKey)
  const setDays = (days: number | null) => db.insert(s.siteSettings).values({ id: 1, proofRetentionDays: days }).onConflictDoUpdate({ target: s.siteSettings.id, set: { proofRetentionDays: days } })

  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete(s.orderPaymentProofs)
    await db.delete(s.orders)
  })

  it('does nothing while no retention period is configured', async () => {
    await proofOrder({ status: 'delivered', deliveredAt: ago(400), paymentStatus: 'verified' })
    await setDays(null)
    expect(await purgeOldPaymentProofs(now)).toEqual({ enabled: false, deleted: 0, failed: 0 })
    expect(proofs.del).not.toHaveBeenCalled()
    expect(await remaining()).toHaveLength(1)
  })

  it('deletes the file then the row only for finished orders older than the period', async () => {
    await setDays(30)
    const oldDelivered = await proofOrder({ status: 'delivered', deliveredAt: ago(31), paymentStatus: 'verified' })
    const recentDelivered = await proofOrder({ status: 'delivered', deliveredAt: ago(10), paymentStatus: 'verified' })
    const oldCancelled = await proofOrder({ status: 'cancelled', updatedAt: ago(40), paymentStatus: 'rejected' })
    const oldReturned = await proofOrder({ status: 'returned', updatedAt: ago(40), paymentStatus: 'refunded' })
    const stillOpen = await proofOrder({ status: 'on_the_way', updatedAt: ago(90), paymentStatus: 'verified' })
    const oldButUnverified = await proofOrder({ status: 'cancelled', updatedAt: ago(90), paymentStatus: 'pending_verification' })

    expect(await purgeOldPaymentProofs(now)).toEqual({ enabled: true, deleted: 3, failed: 0 })
    expect(proofs.del.mock.calls.map((c) => c[0]).sort()).toEqual([oldDelivered.key, oldCancelled.key, oldReturned.key].sort())
    expect((await remaining()).sort()).toEqual([recentDelivered.key, stillOpen.key, oldButUnverified.key].sort())
    // the order itself and its text transfer details are untouched
    expect(await db.select().from(s.orders).where(eq(s.orders.id, oldDelivered.id))).toHaveLength(1)
  })

  it('keeps the row when the file deletion fails so it is retried next run', async () => {
    await setDays(7)
    const a = await proofOrder({ status: 'delivered', deliveredAt: ago(20), paymentStatus: 'verified' })
    const b = await proofOrder({ status: 'delivered', deliveredAt: ago(20), paymentStatus: 'verified' })
    proofs.del.mockImplementationOnce(async () => { throw new Error('r2 down') })
    const r = await purgeOldPaymentProofs(now)
    expect(r).toMatchObject({ deleted: 1, failed: 1 })
    expect(await remaining()).toHaveLength(1)
    expect(await purgeOldPaymentProofs(now)).toMatchObject({ deleted: 1, failed: 0 })
    expect(await remaining()).toHaveLength(0)
    void a; void b
  })

  it('works through a large backlog in bounded batches', async () => {
    await setDays(7)
    expect(PROOF_PURGE_BATCH).toBeGreaterThan(0)
    for (let i = 0; i < 3; i++) await proofOrder({ status: 'delivered', deliveredAt: ago(50), paymentStatus: 'verified' })
    expect((await purgeOldPaymentProofs(now)).deleted).toBe(3)
  })

  it('the database refuses a period outside 7..365 days', async () => {
    await expect(setDays(3)).rejects.toThrow()
    await expect(setDays(1000)).rejects.toThrow()
  })
})
