import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

const db = drizzle(new PGlite())
const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  deleteImageObject: vi.fn(async (_key?: string | null) => {}),
  auth: vi.fn(async () => {}),
}))

vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: mocks.revalidateTag, revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: mocks.auth, assertManageAuthenticated: mocks.auth, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'tester' }))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: mocks.deleteImageObject }))

process.env.DATABASE_URL = 'postgres://test'
const A = await import('@/app/manage/notifications-actions')
const R = await import('@/lib/notifications')
const AdminR = await import('@/lib/admin-notifications')

const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const HOUR = 3_600_000

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})
beforeEach(async () => {
  vi.clearAllMocks()
  await db.delete(s.notifications)
})

const create = (over: Record<string, string> = {}) =>
  A.saveNotification(null, form({ title: 'عرض جديد', body: 'خصم على كل المنتجات', status: 'published', publishedAt: iso(-HOUR), ...over }))

describe('notification actions', () => {
  it('requires manage auth', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('unauthorized'))
    expect(await create()).toEqual({ ok: false, error: 'unauthorized' })
    expect(await db.select().from(s.notifications)).toHaveLength(0)
  })

  it('creates, strips html, stores image key and invalidates tags', async () => {
    const r = await create({ title: '<b>مرحبا</b> بكم', link: '/offers', imageKey: 'notifications/a.png' })
    expect(r.ok).toBe(true)
    const [n] = await db.select().from(s.notifications)
    expect(n).toMatchObject({ title: 'مرحبا بكم', link: '/offers', imageKey: 'notifications/a.png', status: 'published', createdBy: 'tester' })
    expect(mocks.revalidateTag).toHaveBeenCalledWith('notifications:list', { expire: 0 })
    expect(mocks.revalidateTag).toHaveBeenCalledWith('notifications:summary', { expire: 0 })
  })

  it.each(['https://evil.com', '//evil.com', 'javascript:alert(1)', '/a\\b'])('rejects unsafe link %s', async (link) => {
    const r = await create({ link })
    expect(r.ok).toBe(false)
    expect(await db.select().from(s.notifications)).toHaveLength(0)
  })

  it('rejects an image key outside the allowed folders and expiry before publish', async () => {
    expect((await create({ imageKey: 'payment-proofs/x.enc' })).ok).toBe(false)
    expect((await create({ expiresAt: iso(-2 * HOUR) })).ok).toBe(false)
  })

  it('replaces the image on edit and deletes the old object; delete removes the image', async () => {
    await create({ imageKey: 'notifications/old.png' })
    const [n] = await db.select().from(s.notifications)
    await A.saveNotification(n.id, form({ title: 'عنوان معدل', body: 'نص معدل', status: 'draft', imageKey: 'notifications/new.png' }))
    expect(mocks.deleteImageObject).toHaveBeenCalledWith('notifications/old.png')
    mocks.deleteImageObject.mockClear()
    expect((await A.deleteNotification(n.id)).ok).toBe(true)
    expect(mocks.deleteImageObject).toHaveBeenCalledWith('notifications/new.png')
    expect(await db.select().from(s.notifications)).toHaveLength(0)
  })

  it('publish / unpublish / archive and unknown ids', async () => {
    await create({ status: 'draft' })
    const [n] = await db.select().from(s.notifications)
    expect((await A.publishNotification(n.id)).ok).toBe(true)
    expect((await db.select().from(s.notifications))[0].status).toBe('published')
    await A.unpublishNotification(n.id)
    expect((await db.select().from(s.notifications))[0].status).toBe('draft')
    await A.archiveNotification(n.id)
    expect((await db.select().from(s.notifications))[0].status).toBe('archived')
    expect((await A.publishNotification('00000000-0000-4000-8000-000000000000')).ok).toBe(false)
    expect((await A.archiveNotification('not-a-uuid')).ok).toBe(false)
  })
})

describe('customer reads', () => {
  it('shows only published, already-live, unexpired notifications, newest first', async () => {
    await create({ title: 'live old', publishedAt: iso(-3 * HOUR) })
    await create({ title: 'live new', publishedAt: iso(-HOUR) })
    await create({ title: 'draft one', status: 'draft' })
    await create({ title: 'archived one', status: 'archived' })
    await create({ title: 'scheduled', publishedAt: iso(HOUR) })
    await create({ title: 'expired', publishedAt: iso(-3 * HOUR), expiresAt: iso(-HOUR) })
    const page = await R.getPublicNotifications(0)
    expect(page.items.map((i) => i.title)).toEqual(['live new', 'live old'])
    expect(page).toMatchObject({ total: 2, hasMore: false, configured: true })
    expect((await R.getNotificationsSummary()).map((i) => i._id)).toEqual(page.items.map((i) => i._id))
  })

  it('paginates and sanitizes links on read', async () => {
    for (let i = 0; i < 12; i++) await create({ title: `n${String(i).padStart(2, '0')}`, publishedAt: iso(-(i + 1) * 60_000) })
    const first = await R.getPublicNotifications(0)
    const second = await R.getPublicNotifications(1)
    expect(first.items).toHaveLength(10)
    expect(first.hasMore).toBe(true)
    expect(second.items).toHaveLength(2)
    expect(second.hasMore).toBe(false)
    await db.update(s.notifications).set({ link: 'https://evil.com' })
    expect((await R.getPublicNotifications(0)).items.every((i) => i.link === null)).toBe(true)
  })
})

describe('admin read', () => {
  it('lists everything with stats', async () => {
    await create({ title: 'a' + 'x'.repeat(3) })
    await create({ status: 'draft' })
    await create({ status: 'archived' })
    const r = await AdminR.getAdminNotifications()
    expect(r.stats).toEqual({ total: 3, published: 1, draft: 1, archived: 1 })
    expect(r.config.ready).toBe(true)
    expect(r.loadError).toBeNull()
  })
})
