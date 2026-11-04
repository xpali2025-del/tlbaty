import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { unwrapAll } from '@/lib/action-result'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'

// أساس الحفظ في لوحة التحكم (المرحلة 1 من docs/admin-instant-save-plan.md):
// حفظ آمن من التكرار، وكشف التعارض، وعنصر بشكل القائمة، وحفظ قسم بعدد جمل ثابت.

let counting = false
let statements = 0
const db = drizzle(new PGlite(), {
  logger: {
    logQuery: () => {
      if (counting) statements++
    },
  },
})
const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  deleteImageObject: vi.fn(async () => {}),
  auth: vi.fn(async (): Promise<unknown> => ({ username: 'tester', isOwner: true, permissions: [], role: 'owner' })),
}))

vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: mocks.revalidateTag, revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: mocks.auth, assertManageAuthenticated: mocks.auth, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'tester' }))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: mocks.deleteImageObject, getImageBytes: vi.fn(async () => null), createImageUpload: vi.fn(), createVideoUpload: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn(async () => ({ text: 'x' })) }))

const A = unwrapAll(await import('@/app/manage/actions'))
const { getAdminProduct } = await import('@/lib/admin')
const { purgeSaveRequests } = await import('@/lib/save-request')

const seed = loadSeedData(path.resolve(__dirname, '../scripts/migration/data'))
const KEY = (folder: string, name: string) => `${folder}/${name}.png`
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, Array.isArray(v) ? JSON.stringify(v) : v)
  return f
}
const rows = <T extends PgTable>(t: T) => db.select().from(t as PgTable) as unknown as Promise<T['$inferSelect'][]>
const deleted = () => mocks.deleteImageObject.mock.calls.map((c) => (c as unknown[])[0]).sort()
const uuid = () => crypto.randomUUID()

let categoryId: string
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  await importCatalog(db, seed, { resolveImage: async (p) => p })
  categoryId = (await rows(s.categories)).find((c) => c.slug === 'accessories')!.id
})
beforeEach(() => vi.clearAllMocks())

const productForm = (over: Record<string, string | string[]> = {}) =>
  form({ name: 'منتج الأساس', categoryId, price: '100', slug: 'foundation-product', stock: '5', ...over })
const bySlug = async (slug: string) => (await rows(s.products)).filter((p) => p.slug === slug)

describe('saveProduct is idempotent by request id', () => {
  it('same requestId twice creates one product and returns the same result', async () => {
    const requestId = uuid()
    const first = await A.saveProduct(null, productForm({ requestId }))
    expect(first.status).toBe('saved')
    const second = await A.saveProduct(null, productForm({ requestId }))
    expect(second).toMatchObject({ status: 'saved', replayed: true })
    if (first.status !== 'saved' || second.status !== 'saved') throw new Error('unreachable')
    expect(second.item._id).toBe(first.item._id)
    expect(await bySlug('foundation-product')).toHaveLength(1)
  })

  it('retry after a lost response does not duplicate, and the replay has no second side effects', async () => {
    const requestId = uuid()
    const key = KEY('products', 'idem-main')
    await A.saveProduct(null, productForm({ slug: 'lost-response', requestId, imageKey: key }))
    mocks.revalidateTag.mockClear()
    mocks.deleteImageObject.mockClear()
    // the browser never got the reply, so it sends the very same request again
    const retry = await A.saveProduct(null, productForm({ slug: 'lost-response', requestId, imageKey: key }))
    expect(retry).toMatchObject({ status: 'saved', replayed: true })
    expect(await bySlug('lost-response')).toHaveLength(1)
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
    expect(deleted()).toEqual([])
  })

  it('two concurrent sends with one requestId create one product', async () => {
    const requestId = uuid()
    const [a, b] = await Promise.all([
      A.saveProduct(null, productForm({ slug: 'concurrent', requestId })),
      A.saveProduct(null, productForm({ slug: 'concurrent', requestId })),
    ])
    expect([a.status, b.status]).toEqual(['saved', 'saved'])
    expect(await bySlug('concurrent')).toHaveLength(1)
    expect([a, b].filter((r) => r.status === 'saved' && r.replayed)).toHaveLength(1)
  })

  it('an edit replayed with the same requestId is not applied twice', async () => {
    const created = await A.saveProduct(null, productForm({ slug: 'edit-replay' }))
    if (created.status !== 'saved') throw new Error('unreachable')
    const id = created.item._id
    const requestId = uuid()
    await A.saveProduct(id, productForm({ slug: 'edit-replay', price: '120', requestId }))
    const again = await A.saveProduct(id, productForm({ slug: 'edit-replay', price: '999', requestId }))
    expect(again).toMatchObject({ status: 'saved', replayed: true })
    const [p] = await bySlug('edit-replay')
    expect(p.price).toBe(120)
    expect(p.version).toBe(2)
  })

  it('a failed save rolls back its request id, so the corrected retry runs for real', async () => {
    const requestId = uuid()
    await expect(A.saveProduct(null, productForm({ slug: 'foundation-product', requestId }))).rejects.toThrow('مستخدم لمنتج آخر')
    const ok = await A.saveProduct(null, productForm({ slug: 'rolled-back', requestId }))
    expect(ok).toMatchObject({ status: 'saved', replayed: false })
    expect(await bySlug('rolled-back')).toHaveLength(1)
  })

  it('rejects a malformed request id and a request id of another entity', async () => {
    await expect(A.saveProduct(null, productForm({ slug: 'bad-id', requestId: 'not-a-uuid' }))).rejects.toThrow('معرّف عملية الحفظ غير صالح')
    expect(await bySlug('bad-id')).toHaveLength(0)
    const requestId = uuid()
    await A.saveProduct(null, productForm({ slug: 'owner-a', requestId }))
    const other = await A.saveProduct(null, productForm({ slug: 'owner-b' }))
    if (other.status !== 'saved') throw new Error('unreachable')
    await expect(A.saveProduct(other.item._id, productForm({ slug: 'owner-b', requestId }))).rejects.toThrow('مستخدم لمنتج آخر')
  })

  it('a save without a requestId still works (old callers)', async () => {
    const r = await A.saveProduct(null, productForm({ slug: 'no-request-id' }))
    expect(r).toMatchObject({ status: 'saved', replayed: false })
  })

  it('purges only request ids older than a week', async () => {
    const old = uuid()
    const fresh = uuid()
    await db.insert(s.saveRequests).values([
      { requestId: old, screen: 'products', createdAt: new Date(Date.now() - 8 * 86_400_000) },
      { requestId: fresh, screen: 'products', createdAt: new Date(Date.now() - 6 * 86_400_000) },
    ])
    expect(await purgeSaveRequests()).toBe(1)
    const left = (await rows(s.saveRequests)).map((r) => r.requestId)
    expect(left).toContain(fresh)
    expect(left).not.toContain(old)
  })
})

describe('saveProduct detects conflicting edits', () => {
  it('conflict when the product changed since the form opened, and nothing is written', async () => {
    const created = await A.saveProduct(null, productForm({ slug: 'conflict-me', name: 'الأصل' }))
    if (created.status !== 'saved') throw new Error('unreachable')
    expect(created.item.version).toBe(1)
    const id = created.item._id

    // admin one opens the form (version 1); admin two saves first
    const second = await A.saveProduct(id, productForm({ slug: 'conflict-me', name: 'تعديل الثاني', expectedVersion: '1' }))
    expect(second).toMatchObject({ status: 'saved' })
    if (second.status !== 'saved') throw new Error('unreachable')
    expect(second.item.version).toBe(2)

    const stale = await A.saveProduct(id, productForm({ slug: 'conflict-me', name: 'تعديل الأول', expectedVersion: '1' }))
    expect(stale.status).toBe('conflict')
    if (stale.status !== 'conflict') throw new Error('unreachable')
    expect(stale.current?.name).toBe('تعديل الثاني')
    expect(stale.current?.version).toBe(2)
    const [p] = await bySlug('conflict-me')
    expect(p.name).toBe('تعديل الثاني')
    expect(p.version).toBe(2)
  })

  it('a conflict does not consume the request id', async () => {
    const created = await A.saveProduct(null, productForm({ slug: 'conflict-id' }))
    if (created.status !== 'saved') throw new Error('unreachable')
    await A.saveProduct(created.item._id, productForm({ slug: 'conflict-id', price: '111', expectedVersion: '1' }))
    const requestId = uuid()
    const stale = await A.saveProduct(created.item._id, productForm({ slug: 'conflict-id', price: '222', expectedVersion: '1', requestId }))
    expect(stale.status).toBe('conflict')
    expect(await db.select().from(s.saveRequests).where(eq(s.saveRequests.requestId, requestId))).toHaveLength(0)
    // reopening the form (fresh version) and saving succeeds with the same request id
    const fixed = await A.saveProduct(created.item._id, productForm({ slug: 'conflict-id', price: '222', expectedVersion: '2', requestId }))
    expect(fixed).toMatchObject({ status: 'saved', replayed: false })
  })

  it('stock stays a delta and never conflicts: orders do not bump the version', async () => {
    const created = await A.saveProduct(null, productForm({ slug: 'stock-delta', stock: '10' }))
    if (created.status !== 'saved') throw new Error('unreachable')
    const id = created.item._id
    // a customer buys 3 while the admin has the form open
    await db.update(s.products).set({ stock: sql`${s.products.stock} - 3` }).where(eq(s.products.id, id))
    const saved = await A.saveProduct(id, productForm({ slug: 'stock-delta', stock: '12', stockBase: '10', expectedVersion: '1' }))
    expect(saved.status).toBe('saved')
    const [p] = await bySlug('stock-delta')
    expect(p.stock).toBe(9) // 7 left + the +2 the admin typed
  })

  it('toggling a flag bumps the version, so an open form conflicts', async () => {
    const created = await A.saveProduct(null, productForm({ slug: 'flag-version' }))
    if (created.status !== 'saved') throw new Error('unreachable')
    await A.toggleProductFlag(created.item._id, 'isBestseller', true)
    const stale = await A.saveProduct(created.item._id, productForm({ slug: 'flag-version', expectedVersion: '1' }))
    expect(stale.status).toBe('conflict')
  })

  it('without expectedVersion the save is not checked (old callers)', async () => {
    const created = await A.saveProduct(null, productForm({ slug: 'unchecked' }))
    if (created.status !== 'saved') throw new Error('unreachable')
    await A.saveProduct(created.item._id, productForm({ slug: 'unchecked', price: '5' }))
    const again = await A.saveProduct(created.item._id, productForm({ slug: 'unchecked', price: '6' }))
    expect(again.status).toBe('saved')
  })
})

describe('saveProduct returns the list-shaped item', () => {
  it('has every field the product list shows, matching a fresh read', async () => {
    const colors = JSON.stringify([{ name: 'أحمر', hex: '#FF0000' }])
    const r = await A.saveProduct(null, productForm({
      slug: 'list-shape', name: 'منتج القائمة', colors, sizes: ['S', 'M'], keywords: ['كلمة'], subcategory: 'gold-accessories',
      imageKey: KEY('products', 'ls-main'), newImageKeys: [KEY('products', 'ls-1'), KEY('products', 'ls-2')],
      trackVariants: 'true', variants: JSON.stringify([{ color: 'أحمر', size: 'S', stock: 3 }, { color: 'أحمر', size: 'M', stock: 4 }]),
      oldPrice: '150', badge: 'جديد', isNew: 'true',
    }))
    if (r.status !== 'saved') throw new Error('unreachable')
    const item = r.item
    expect(item).toMatchObject({
      name: 'منتج القائمة', slug: 'list-shape', price: 100, oldPrice: 150, badge: 'جديد', isNew: true, version: 1,
      categoryId, categoryName: expect.any(String), subcategory: 'gold-accessories', sizes: ['S', 'M'], keywords: ['كلمة'], stock: 7,
    })
    expect(item.productId).toMatch(/^[A-Z]{2,4}[0-9]?-\d{3,}$/)
    expect(item.images.map((i) => i.ref)).toEqual([KEY('products', 'ls-1'), KEY('products', 'ls-2')])
    expect(item.colors).toEqual([{ name: 'أحمر', hex: '#FF0000' }])
    expect([...item.variants].sort((a, b) => a.size.localeCompare(b.size))).toEqual([
      { color: 'أحمر', size: 'M', stock: 4 },
      { color: 'أحمر', size: 'S', stock: 3 },
    ])
    expect(await getAdminProduct(item._id)).toEqual(item)
  })

  it('reflects the edit (new version, new price) and the replaced image', async () => {
    const created = await A.saveProduct(null, productForm({ slug: 'list-edit', imageKey: KEY('products', 'le-a') }))
    if (created.status !== 'saved') throw new Error('unreachable')
    const edited = await A.saveProduct(created.item._id, productForm({ slug: 'list-edit', price: '77', imageKey: KEY('products', 'le-b'), expectedVersion: '1' }))
    if (edited.status !== 'saved') throw new Error('unreachable')
    expect(edited.item).toMatchObject({ price: 77, version: 2 })
    expect((await bySlug('list-edit'))[0].mainImageKey).toBe(KEY('products', 'le-b'))
    expect(await getAdminProduct(edited.item._id)).toEqual(edited.item)
  })

  it('the returned item always equals a fresh read, across creates and edits of every kind', async () => {
    const colors = JSON.stringify([{ name: 'أحمر', hex: '#FF0000' }, { name: 'أزرق', hex: '#0000FF' }])
    const sameAsFresh = async (r: Awaited<ReturnType<typeof A.saveProduct>>) => {
      if (r.status !== 'saved') throw new Error('unreachable')
      const fresh = await getAdminProduct(r.item._id)
      // variant rows come back in no particular order from the database
      const norm = (p: typeof r.item | null) => p && { ...p, variants: [...p.variants].sort((a, b) => `${a.color}${a.size}`.localeCompare(`${b.color}${b.size}`)) }
      expect(norm(r.item)).toEqual(norm(fresh))
      return r.item
    }
    const brandId = (await rows(s.brands))[0].id
    const created = await sameAsFresh(await A.saveProduct(null, productForm({
      slug: 'shape-1', colors, sizes: ['S', 'M'], keywords: ['ك'], subcategory: 'gold-accessories', brandId,
      imageKey: KEY('products', 'sh-main'), newImageKeys: [KEY('products', 'sh-1'), KEY('products', 'sh-2')],
      trackVariants: 'true', variants: JSON.stringify([{ color: 'أحمر', size: 'S', stock: 2 }, { color: 'أزرق', size: 'M', stock: 3 }]),
    })))
    const id = created.version === 1 ? created._id : created._id
    // edit without touching images/colors/variants, then change each in turn
    await sameAsFresh(await A.saveProduct(id, productForm({ slug: 'shape-1', colors, sizes: ['S', 'M'], keptImages: [KEY('products', 'sh-1'), KEY('products', 'sh-2')], trackVariants: 'true', variants: JSON.stringify([{ color: 'أحمر', size: 'S', stock: 2, base: 2 }, { color: 'أزرق', size: 'M', stock: 3, base: 3 }]), price: '55', expectedVersion: '1' })))
    await sameAsFresh(await A.saveProduct(id, productForm({ slug: 'shape-1', colors, sizes: ['S', 'M'], keptImages: [KEY('products', 'sh-2'), KEY('products', 'sh-1')], newImageKeys: [KEY('products', 'sh-3')], trackVariants: 'true', variants: JSON.stringify([{ color: 'أحمر', size: 'S', stock: 9 }]), expectedVersion: '2' })))
    await sameAsFresh(await A.saveProduct(id, productForm({ slug: 'shape-1', colors: JSON.stringify([{ name: 'أخضر', hex: '#00FF00' }]), sizes: ['L'], expectedVersion: '3', stock: '4' }))) // tracking off, colours changed, no brand/sub
    await sameAsFresh(await A.saveProduct(id, productForm({ slug: 'shape-1', imageKey: KEY('products', 'sh-new-main'), isBestseller: 'true', badge: 'خصم', expectedVersion: '4' })))
  })

  it('invalidates the storefront cache once per real save', async () => {
    await A.saveProduct(null, productForm({ slug: 'revalidate-once' }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
    expect(mocks.revalidateTag.mock.calls.length).toBeGreaterThan(0)
  })
})

describe('saveCategory does not touch products more than it must', () => {
  const makeCategory = async (slug: string, products: number) => {
    await A.saveCategory(null, form({ name: `قسم ${slug}`, slug }))
    const [cat] = (await rows(s.categories)).filter((c) => c.slug === slug)
    if (products > 0) {
      await db.insert(s.products).values(
        Array.from({ length: products }, (_, i) => ({
          productNumber: `${slug}-${i}`, name: `منتج ${slug} ${i}`, slug: `${slug}-p${i}`, categoryId: cat.id, price: 10, description: 'وصف',
          searchText: 'sentinel',
        })),
      )
    }
    return cat
  }
  const searchTexts = async (catId: string) => (await rows(s.products)).filter((p) => p.categoryId === catId).map((p) => p.searchText)
  const count = async (fn: () => Promise<unknown>) => {
    statements = 0
    counting = true
    try {
      await fn()
    } finally {
      counting = false
    }
    return statements
  }

  it('category save issues a constant number of statements regardless of product count', async () => {
    const small = await makeCategory('few-products', 1)
    const big = await makeCategory('many-products', 50)
    const rename = (cat: { id: string; slug: string }, name: string) => A.saveCategory(cat.id, form({ name, slug: cat.slug }))
    const forSmall = await count(() => rename(small, 'اسم جديد صغير'))
    const forBig = await count(() => rename(big, 'اسم جديد كبير'))
    expect(forBig).toBe(forSmall)
    // and the refresh really happened for all 50
    expect((await searchTexts(big.id)).every((t) => t.includes('كبير'))).toBe(true)
    expect(await searchTexts(big.id)).toHaveLength(50)
  })

  it('category save with only an image change does not refresh product search text', async () => {
    const cat = await makeCategory('image-only', 3)
    const withoutProducts = await makeCategory('image-only-empty', 0)
    const save = (c: { id: string; slug: string }, key: string) => A.saveCategory(c.id, form({ name: `قسم ${c.slug}`, slug: c.slug, imageKey: key }))
    const withProducts = await count(() => save(cat, KEY('categories', 'img-1')))
    const empty = await count(() => save(withoutProducts, KEY('categories', 'img-2')))
    expect(await searchTexts(cat.id)).toEqual(['sentinel', 'sentinel', 'sentinel'])
    expect(withProducts).toBe(empty) // products add no statements at all
  })

  it('refreshes product search text when a subcategory is renamed or removed, and not when one is only added', async () => {
    const cat = await makeCategory('sub-changes', 2)
    const save = (subs: object[]) => A.saveCategory(cat.id, form({ name: `قسم ${cat.slug}`, slug: cat.slug, subcategories: JSON.stringify(subs) }))
    await save([{ name: 'الأول', slug: 'first' }])
    expect(await searchTexts(cat.id)).toEqual(['sentinel', 'sentinel']) // adding one changes no product text
    const [sub] = await rows(s.subcategories).then((r) => r.filter((x) => x.categoryId === cat.id))
    await db.update(s.products).set({ subcategoryId: sub.id }).where(eq(s.products.categoryId, cat.id))
    await save([{ name: 'الأول معدّل', slug: 'first' }])
    expect((await searchTexts(cat.id)).every((t) => t.includes('معدل'))).toBe(true) // renamed
    await db.update(s.products).set({ searchText: 'sentinel' }).where(eq(s.products.categoryId, cat.id))
    await save([])
    expect((await searchTexts(cat.id)).every((t) => t !== 'sentinel')).toBe(true) // removed
  })

  it('saves all subcategories and keeps their order', async () => {
    const cat = await makeCategory('sub-order', 0)
    await A.saveCategory(cat.id, form({ name: `قسم ${cat.slug}`, slug: cat.slug, subcategories: JSON.stringify([{ name: 'ب' }, { name: 'أ' }, { name: 'ج' }]) }))
    await A.saveCategory(cat.id, form({ name: `قسم ${cat.slug}`, slug: cat.slug, subcategories: JSON.stringify([{ name: 'ج' }, { name: 'أ' }, { name: 'ب', description: 'وصف' }]) }))
    const subs = (await rows(s.subcategories)).filter((x) => x.categoryId === cat.id).sort((a, b) => a.sortOrder - b.sortOrder)
    expect(subs.map((x) => x.name)).toEqual(['ج', 'أ', 'ب'])
    expect(subs[2].description).toBe('وصف')
  })
})
