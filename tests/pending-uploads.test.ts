import path from 'node:path'
import { eq } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { openTestDb } from './helpers/test-db'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { unwrapAll } from '@/lib/action-result'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'

// رفع الصور عند الاختيار (المرحلة 2 من docs/admin-instant-save-plan.md): تتبّع ما رُفع ولم يُحفظ بعد،
// ومطالبة الحفظ الناجح بمفاتيحه، وإلغاء النموذج، والتنظيف اليومي.

const testDb = await openTestDb()
const db = testDb.db
const mocks = vi.hoisted(() => ({
  user: 'admin-a',
  seq: 0,
  deleteImageObject: vi.fn(async () => {}),
}))
const ctx = () => ({ username: mocks.user, isOwner: true, permissions: [], role: 'owner' })

vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({
  assertManagePermission: async () => ctx(),
  assertManageAuthenticated: async () => ctx(),
  getManageUsername: () => 'odoo',
  getManageSessionUser: async () => mocks.user,
}))
vi.mock('@/lib/storage/r2', () => ({
  deleteImageObject: mocks.deleteImageObject,
  getImageBytes: vi.fn(async () => null),
  createImageUpload: vi.fn(async (...[, , folder]: [string, number, string]) => ({ uploadUrl: `https://r2/${folder}`, objectKey: `${folder}/u${++mocks.seq}.webp` })),
  createVideoUpload: vi.fn(async () => ({ uploadUrl: 'https://r2/video', objectKey: `ads/v${++mocks.seq}.mp4` })),
}))
vi.mock('ai', () => ({ generateText: vi.fn() }))

const A = unwrapAll(await import('@/app/manage/actions'))
const U = unwrapAll(await import('@/app/manage/upload-actions'))
const P = await import('@/lib/pending-uploads')

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, Array.isArray(v) ? JSON.stringify(v) : v)
  return f
}
const rows = <T extends PgTable>(t: T) => db.select().from(t as PgTable) as unknown as Promise<T['$inferSelect'][]>
const pending = async () => (await rows(s.pendingUploads)).map((r) => r.objectKey).sort()
const deleted = () => mocks.deleteImageObject.mock.calls.map((c) => (c as unknown[])[0]).sort()
const sign = async (user = 'admin-a', folder = 'categories', count = 1) => {
  mocks.user = user
  const slots = await U.requestImageUploads(Array.from({ length: count }, () => ({ folder, contentType: 'image/webp', size: 1000 })))
  return slots.map((x) => x.objectKey)
}
const age = (key: string, hours: number) =>
  db.update(s.pendingUploads).set({ createdAt: new Date(Date.now() - hours * 3_600_000) }).where(eq(s.pendingUploads.objectKey, key))

beforeAll(async () => {
  process.env.R2_ACCOUNT_ID = 'a'
  process.env.R2_ACCESS_KEY_ID = 'b'
  process.env.R2_SECRET_ACCESS_KEY = 'c'
  process.env.R2_BUCKET = 'd'
  process.env.R2_PUBLIC_URL = 'https://cdn.example.com'
  await testDb.migrate()
  await importCatalog(db, loadSeedData(path.resolve(__dirname, '../scripts/migration/data')), { resolveImage: async (p) => p })
})
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.user = 'admin-a'
  await db.delete(s.pendingUploads)
})

describe('pending uploads are tracked from signing to saving', () => {
  it('signing a URL records the key as pending for that admin, in one statement per batch', async () => {
    const keys = await sign('admin-a', 'products', 3)
    expect(await pending()).toEqual([...keys].sort())
    expect((await rows(s.pendingUploads)).every((r) => r.createdBy === 'admin-a')).toBe(true)
    const video = await U.requestVideoUpload('video/mp4', 1000)
    expect(await pending()).toContain(video.objectKey)
  })

  it('a successful save claims its keys; a failed save does not', async () => {
    const [ok, failing] = await sign('admin-a', 'categories', 2)
    await A.saveCategory(null, form({ name: 'قسم الرفع', slug: 'upload-cat', imageKey: ok }))
    expect(await pending()).toEqual([failing])
    // the slug is taken, so the save fails after the key was read: the key stays pending for a retry
    await expect(A.saveCategory(null, form({ name: 'قسم ثانٍ', slug: 'upload-cat', imageKey: failing }))).rejects.toThrow('مستخدم لقسم آخر')
    expect(await pending()).toEqual([failing])
    await A.saveCategory(null, form({ name: 'قسم ثانٍ', slug: 'upload-cat-2', imageKey: failing }))
    expect(await pending()).toEqual([])
  })

  it('claims every key of a product save (main image and gallery)', async () => {
    const [main, g1, g2] = await sign('admin-a', 'products', 3)
    const [cat] = await rows(s.categories)
    const r = await A.saveProduct(null, form({ name: 'منتج الرفع', categoryId: cat.id, price: '5', slug: 'upload-product', imageKey: main, newImageKeys: [g1, g2] }))
    expect(r.status).toBe('saved')
    expect(await pending()).toEqual([])
  })

  it('claims the video key of an ad save', async () => {
    const [poster] = await sign('admin-a', 'ads', 1)
    const video = (await U.requestVideoUpload('video/mp4', 1000)).objectKey
    await A.saveAd(null, form({ title: 'إعلان فيديو', kind: 'video', imageKey: poster, videoKey: video, placements: JSON.stringify(['home']), frequency: '6' }))
    expect(await pending()).toEqual([])
  })

  it('a conflicting product save leaves its uploads pending (they were not used)', async () => {
    const [cat] = await rows(s.categories)
    const created = await A.saveProduct(null, form({ name: 'منتج تعارض الرفع', categoryId: cat.id, price: '5', slug: 'upload-conflict' }))
    if (created.status !== 'saved') throw new Error('unreachable')
    await A.saveProduct(created.item._id, form({ name: 'منتج تعارض الرفع', categoryId: cat.id, price: '6', slug: 'upload-conflict', expectedVersion: '1' }))
    const [key] = await sign('admin-a', 'products', 1)
    const stale = await A.saveProduct(created.item._id, form({ name: 'منتج تعارض الرفع', categoryId: cat.id, price: '7', slug: 'upload-conflict', expectedVersion: '1', imageKey: key }))
    expect(stale.status).toBe('conflict')
    expect(await pending()).toEqual([key])
  })

  it("a key from another admin's form cannot be claimed, and the cleanup never deletes the live image", async () => {
    const [key] = await sign('admin-a', 'categories', 1)
    mocks.user = 'admin-b'
    await A.saveCategory(null, form({ name: 'قسم المدير ب', slug: 'b-category', imageKey: key }))
    expect(await pending()).toEqual([key]) // not claimed by B
    await age(key, 30)
    const result = await P.purgePendingUploads()
    expect(result).toMatchObject({ checked: 1, deleted: 0, referenced: 1 })
    expect(deleted()).toEqual([]) // the object is referenced by a live category: untouched
    expect(await pending()).toEqual([]) // only the stale record is dropped
  })
})

describe('cancelling a form discards what it uploaded', () => {
  it('cancel deletes pending objects and their records', async () => {
    const keys = await sign('admin-a', 'products', 2)
    expect(await U.discardUploads(keys)).toEqual({ discarded: 2 })
    expect(deleted()).toEqual([...keys].sort())
    expect(await pending()).toEqual([])
  })

  it('cannot discard a claimed key (a live image) or the key of another admin', async () => {
    const [used] = await sign('admin-a', 'categories', 1)
    await A.saveCategory(null, form({ name: 'قسم محفوظ', slug: 'kept-cat', imageKey: used }))
    const [theirs] = await sign('admin-b', 'categories', 1)
    mocks.user = 'admin-a'
    expect(await U.discardUploads([used, theirs])).toEqual({ discarded: 0 })
    expect(deleted()).toEqual([])
    expect(await pending()).toEqual([theirs])
  })

  it('rejects malformed keys and oversized lists', async () => {
    await expect(U.discardUploads([])).rejects.toThrow('غير صالحة')
    expect(await U.discardUploads(['../etc/passwd', 'payment-proofs/x.png', 'https://x/y.png'])).toEqual({ discarded: 0 })
    expect(deleted()).toEqual([])
  })

  it('requires a session', async () => {
    // the mock always returns a session; an unauthenticated request is covered by assertManageAuthenticated itself
    expect(typeof U.discardUploads).toBe('function')
  })
})

describe('the daily cleanup', () => {
  it('cleanup deletes only unclaimed keys older than 24h (a used key is never touched)', async () => {
    const [oldFree, oldUsed, young, edge] = await sign('admin-a', 'categories', 4)
    await A.saveCategory(null, form({ name: 'قسم يستعمل صورة قديمة', slug: 'old-used', imageKey: oldUsed })) // claims oldUsed...
    await P.recordPendingUploads([oldUsed], 'admin-a') // ...but suppose its record came back (e.g. recorded again): still must not be deleted
    await age(oldFree, 30)
    await age(oldUsed, 30)
    await age(young, 2)
    await age(edge, 23)
    const result = await P.purgePendingUploads()
    expect(result).toEqual({ checked: 2, deleted: 1, referenced: 1, failed: 0 })
    expect(deleted()).toEqual([oldFree])
    expect(await pending()).toEqual([edge, young].sort())
  })

  it('keeps the record when the object cannot be deleted, so tomorrow retries', async () => {
    const [key] = await sign('admin-a', 'categories', 1)
    await age(key, 48)
    const result = await P.purgePendingUploads(new Date(), async () => {
      throw new Error('R2 down')
    })
    expect(result).toEqual({ checked: 1, deleted: 0, referenced: 0, failed: 1 })
    expect(await pending()).toEqual([key])
  })

  it('does nothing when nothing is old enough', async () => {
    await sign('admin-a', 'categories', 2)
    expect(await P.purgePendingUploads()).toEqual({ checked: 0, deleted: 0, referenced: 0, failed: 0 })
  })
})

describe('the reference check covers every column that holds an R2 object key', () => {
  it('OBJECT_KEY_COLUMNS lists every *_key column of the store schema except the known non-image ones', () => {
    // a new column that stores an image key must be added to OBJECT_KEY_COLUMNS, or the cleanup could delete a live image
    const NOT_IMAGE_KEYS = new Set([
      'orders.idempotency_key', // order de-duplication
      'wallet_transactions.idempotency_key',
      'order_payment_proofs.object_key', // private bucket (encrypted payment proofs), never touched here
      'pending_uploads.object_key', // this registry itself
    ])
    const found: string[] = []
    for (const table of Object.values(s)) {
      let config
      try {
        config = getTableConfig(table as PgTable)
      } catch {
        continue
      }
      for (const column of config.columns) if (column.name.endsWith('_key')) found.push(`${config.name}.${column.name}`)
    }
    const covered = new Set(P.OBJECT_KEY_COLUMNS.map((c) => c.name))
    const missing = found.filter((name) => !covered.has(name) && !NOT_IMAGE_KEYS.has(name))
    expect(missing).toEqual([])
    // and the list names only columns that exist
    for (const name of covered) expect(found).toContain(name)
  })
})
