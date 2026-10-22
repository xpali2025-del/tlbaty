import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { DEFAULT_REMINDER_RULES } from '@/lib/marketing/rules'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
process.env.CRON_SECRET = 'c'.repeat(32)
const db = drizzle(new PGlite())
const session = vi.hoisted(() => ({ customerId: null as string | null }))
const auth = vi.hoisted(() => vi.fn(async (_s?: string) => {}))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/otp/session', () => ({ resolveSession: async () => (session.customerId ? { customer: { id: session.customerId }, sessionId: 's' } : null) }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: auth, assertManageAuthenticated: auth, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'مدير' }))

const mine = await import('@/app/api/notifications/mine/route')
const cron = await import('@/app/api/cron/reminders/route')
const A = await import('@/app/manage/marketing-actions')
const { getAdminMarketing } = await import('@/lib/admin-marketing')

let a: string
let b: string
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  a = (await db.insert(s.customers).values({ publicId: 'MR_A', phone: '967770000301', marketingOptIn: true }).returning())[0].id
  b = (await db.insert(s.customers).values({ publicId: 'MR_B', phone: '967770000302', marketingOptIn: true }).returning())[0].id
})

describe('GET /api/notifications/mine', () => {
  it('returns only the signed-in customer\'s own live notifications, privately cached', async () => {
    const now = new Date()
    await db.insert(s.notifications).values([
      { title: 'لك', body: 'كودك TJAAAAAAAA', status: 'published', publishedAt: new Date(now.getTime() - 1000), customerId: a, link: '/cart' },
      { title: 'لغيرك', body: 'سري', status: 'published', publishedAt: new Date(now.getTime() - 1000), customerId: b },
      { title: 'منتهٍ', body: 'x', status: 'published', publishedAt: new Date(now.getTime() - 5000), expiresAt: new Date(now.getTime() - 1000), customerId: a },
      { title: 'مسودة', body: 'x', status: 'draft', customerId: a },
      { title: 'عام', body: 'للجميع', status: 'published', publishedAt: new Date(now.getTime() - 1000) },
    ])
    session.customerId = a
    const res = await mine.GET()
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(((await res.json()) as { items: { title: string; link: string | null }[] }).items.map((i) => i.title)).toEqual(['لك'])

    session.customerId = b
    expect(((await (await mine.GET()).json()) as { items: { title: string }[] }).items.map((i) => i.title)).toEqual(['لغيرك'])

    session.customerId = null
    expect(await (await mine.GET()).json()).toEqual({ items: [] })
  })
})

describe('cron reminders route', () => {
  const call = (auth?: string) => cron.GET(new Request('http://x/api/cron/reminders', { headers: auth ? { authorization: auth } : {} }) as never)
  it('requires the cron secret', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    const ok = await call(`Bearer ${'c'.repeat(32)}`)
    expect(ok.status).toBe(200)
    expect((await ok.json()).result).toMatchObject({ cart: { enabled: false }, wishlist: { enabled: false } })
  })
})

describe('marketing admin actions', () => {
  const rule = { ...DEFAULT_REMINDER_RULES.cart, enabled: true }
  it('check the marketing permission and save a valid rule', async () => {
    expect((await A.saveReminderRule(rule)).ok).toBe(true)
    expect(auth).toHaveBeenCalledWith('marketing')
    const saved = (await db.select().from(s.reminderRules).where(eq(s.reminderRules.kind, 'cart')))[0]
    expect(saved).toMatchObject({ enabled: true, delayHours: 24, discountValue: 10 })
    expect((await getAdminMarketing()).rules.cart.enabled).toBe(true)
  })
  it('reject invalid rules without writing, and unknown kinds', async () => {
    for (const bad of [{ ...rule, delayHours: 0 }, { ...rule, discountValue: 150 }, { ...rule, title: '' }, { ...rule, couponValidDays: 0 }, { ...rule, discountValue: 0 }]) {
      expect((await A.saveReminderRule(bad)).ok).toBe(false)
    }
    expect((await A.saveReminderRule({ ...rule, kind: 'other' as never })).ok).toBe(false)
    expect((await db.select().from(s.reminderRules).where(eq(s.reminderRules.kind, 'cart')))[0].delayHours).toBe(24)
  })
  it('refuse without permission', async () => {
    auth.mockRejectedValueOnce(new Error('unauthorized'))
    expect(await A.saveReminderRule(rule)).toEqual({ ok: false, error: 'تعذّر الحفظ' })
    auth.mockRejectedValueOnce(new Error('unauthorized'))
    expect((await A.runRemindersNow()).ok).toBe(false)
  })
  it('runs now and reports stats', async () => {
    const r = await A.runRemindersNow()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.marketing.stats.optedIn).toBe(2)
  })
})
