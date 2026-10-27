import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { CACHE_TAGS } from '@/lib/cache-tags'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'

const db = drizzle(new PGlite())
const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  deleteImageObject: vi.fn(async (_key?: string | null) => {}),
  auth: vi.fn(async (): Promise<unknown> => ({ username: 'tester', isOwner: true, permissions: [], role: 'owner' })),
}))

vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: mocks.revalidateTag, revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: mocks.auth, assertManageAuthenticated: mocks.auth, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'tester' }))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: mocks.deleteImageObject, createImageUpload: vi.fn(async (type: string, size: number, folder: string) => ({ uploadUrl: `https://r2/${folder}/${type}/${size}`, objectKey: `${folder}/new.png` })), createVideoUpload: vi.fn(async (type: string, size: number) => ({ uploadUrl: `https://r2/video/${type}/${size}`, objectKey: 'ads/new.mp4' })) }))
vi.mock('ai', () => ({ generateText: vi.fn(async () => ({ text: 'Women Dress Nike!' })) }))

const A = await import('@/app/manage/actions')
const { hashPassword, verifyPasswordHash } = await import('@/lib/manage-users')
const helpers = await import('@/lib/manage-helpers')
const uploads = await import('@/app/manage/upload-actions')

const seed = loadSeedData(path.resolve(__dirname, '../scripts/migration/data'))
const KEY = (folder: string, name: string) => `${folder}/${name}.png`
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, Array.isArray(v) ? JSON.stringify(v) : v)
  return f
}
const rows = <T extends PgTable>(t: T) => db.select().from(t as PgTable) as unknown as Promise<T['$inferSelect'][]>
const deleted = () => mocks.deleteImageObject.mock.calls.map((c) => c[0]).sort()

let categoryId: string
let brandId: string

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  await importCatalog(db, seed, { resolveImage: async (p) => p })
  const cat = (await rows(s.categories)).find((c) => c.slug === 'accessories')!
  categoryId = cat.id
  brandId = (await rows(s.brands))[0].id
})
beforeEach(() => vi.clearAllMocks())

const productForm = (over: Record<string, string | string[]> = {}) =>
  form({ name: 'منتج اختبار', categoryId, price: '100', slug: 'test-product', ...over })

describe('saveProduct with stock per colour and size', () => {
  const colors = JSON.stringify([{ name: 'أحمر', hex: '#FF0000' }, { name: 'أزرق', hex: '#0000FF' }])
  const variantsOf = async (id: string) => (await rows(s.productVariants)).filter((v) => v.productId === id).map((v) => `${v.color}|${v.size}|${v.stock}`).sort()
  const rowsInput = (v: { color: string; size: string; stock: number; base?: number }[]) => JSON.stringify(v)

  it('stores a quantity per combination, mirrors the total, and validates against the product colours and sizes', async () => {
    await A.saveProduct(null, productForm({ slug: 'variant-product', colors, sizes: ['S', 'M'], trackVariants: 'true', variants: rowsInput([
      { color: 'أحمر', size: 'S', stock: 3 }, { color: 'أحمر', size: 'M', stock: 0 }, { color: 'أزرق', size: 'S', stock: 5 }, { color: 'أزرق', size: 'M', stock: 2 },
    ]) }))
    const [p] = (await rows(s.products)).filter((x) => x.slug === 'variant-product')
    expect(await variantsOf(p.id)).toEqual(['أحمر|M|0', 'أحمر|S|3', 'أزرق|M|2', 'أزرق|S|5'])
    expect(p.stock).toBe(10)

    const bad = (v: object[]) => A.saveProduct(p.id, productForm({ slug: 'variant-product', colors, sizes: ['S', 'M'], trackVariants: 'true', variants: rowsInput(v as never) }))
    await expect(bad([{ color: 'أخضر', size: 'S', stock: 1 }])).rejects.toThrow('ليس من ألوان')
    await expect(bad([{ color: 'أحمر', size: 'XL', stock: 1 }])).rejects.toThrow('ليس من مقاسات')
    await expect(bad([{ color: 'أحمر', size: 'S', stock: -1 }])).rejects.toThrow('عدداً صحيحاً')
    await expect(bad([{ color: 'أحمر', size: 'S', stock: 1 }, { color: 'أحمر', size: 'S', stock: 2 }])).rejects.toThrow('مكررة')
    await expect(bad([])).rejects.toThrow('أضف ألواناً')
    expect(await variantsOf(p.id)).toHaveLength(4)
  })

  it('applies edits as a delta so orders placed while the form was open are not undone', async () => {
    const [p] = (await rows(s.products)).filter((x) => x.slug === 'variant-product')
    // while the admin edits (saw red/S = 3), a customer buys 2 of red/S
    await db.update(s.productVariants).set({ stock: 1 }).where(sql`${s.productVariants.productId} = ${p.id} and color = 'أحمر' and size = 'S'`)
    await A.saveProduct(p.id, productForm({ slug: 'variant-product', colors, sizes: ['S', 'M'], trackVariants: 'true', variants: rowsInput([
      { color: 'أحمر', size: 'S', stock: 4, base: 3 }, // +1 over what the admin saw
      { color: 'أحمر', size: 'M', stock: 0, base: 0 }, { color: 'أزرق', size: 'S', stock: 5, base: 5 }, { color: 'أزرق', size: 'M', stock: 2, base: 2 },
    ]) }))
    expect(await variantsOf(p.id)).toContain('أحمر|S|2')
    expect((await rows(s.products)).find((x) => x.id === p.id)!.stock).toBe(9)
  })

  it('removing a colour drops its rows, and turning tracking off returns to the single stock', async () => {
    const [p] = (await rows(s.products)).filter((x) => x.slug === 'variant-product')
    await A.saveProduct(p.id, productForm({ slug: 'variant-product', colors: JSON.stringify([{ name: 'أزرق', hex: '#0000FF' }]), sizes: ['S', 'M'], trackVariants: 'true', variants: rowsInput([
      { color: 'أزرق', size: 'S', stock: 5, base: 5 }, { color: 'أزرق', size: 'M', stock: 2, base: 2 },
    ]) }))
    expect(await variantsOf(p.id)).toEqual(['أزرق|M|2', 'أزرق|S|5'])
    await A.saveProduct(p.id, productForm({ slug: 'variant-product', colors, sizes: ['S', 'M'], stock: '6', stockBase: '7' }))
    expect(await variantsOf(p.id)).toEqual([])
  })
})

describe('saveProduct', () => {
  it('creates a product with a generated number, defaults, images and colors, then invalidates the store cache', async () => {
    await A.saveProduct(null, productForm({
      imageKey: KEY('products', 'main'), newImageKeys: [KEY('products', 'g1'), KEY('products', 'g2')],
      colors: JSON.stringify([{ name: 'أحمر', hex: '#FF0000' }]), sizes: ['S', 'M'], keywords: ['k'],
      stock: '7', oldPrice: '150', subcategory: 'gold-accessories', brandId, isNew: 'true', badge: 'جديد',
    }))
    const [p] = (await rows(s.products)).filter((x) => x.slug === 'test-product')
    expect(p.productNumber).toMatch(/^[A-Z]{2,4}[0-9]?-\d{3,}$/)
    expect(p).toMatchObject({ rating: 5, reviewsCount: 0, tags: [], stock: 7, price: 100, oldPrice: 150, isNew: true, isBestseller: false, badge: 'جديد', mainImageKey: KEY('products', 'main'), brandId, sizes: ['S', 'M'] })
    expect(p.subcategoryId).not.toBeNull()
    const imgs = (await rows(s.productImages)).filter((i) => i.productId === p.id).sort((a, b) => a.sortOrder - b.sortOrder)
    expect(imgs.map((i) => i.imageKey)).toEqual([KEY('products', 'g1'), KEY('products', 'g2')])
    expect((await rows(s.productColors)).filter((c) => c.productId === p.id)).toHaveLength(1)
    for (const tag of Object.values(CACHE_TAGS)) expect(mocks.revalidateTag).toHaveBeenCalledWith(tag, { expire: 0 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('rejects invalid input without writing anything', async () => {
    const before = (await rows(s.products)).length
    await expect(A.saveProduct(null, form({ categoryId, price: '1' }))).rejects.toThrow('اسم المنتج مطلوب')
    await expect(A.saveProduct(null, form({ name: 'x', price: '1' }))).rejects.toThrow('اختر القسم')
    await expect(A.saveProduct(null, form({ name: 'x', categoryId }))).rejects.toThrow('سعراً صحيحاً')
    await expect(A.saveProduct(null, productForm({ price: '-5' }))).rejects.toThrow('سالباً')
    await expect(A.saveProduct(null, productForm({ categoryId: 'nope' }))).rejects.toThrow('القسم غير صالح')
    await expect(A.saveProduct(null, productForm({ categoryId: '00000000-0000-4000-8000-000000000000' }))).rejects.toThrow('القسم غير موجود')
    await expect(A.saveProduct(null, productForm({ colors: JSON.stringify([{ name: 'x', hex: 'red' }]) }))).rejects.toThrow('لون غير صالح')
    await expect(A.saveProduct('not-a-uuid', productForm())).rejects.toThrow('معرّف غير صالح')
    expect((await rows(s.products)).length).toBe(before)
  })

  it('accepts only valid public image keys (no URLs, traversal or sensitive folders)', async () => {
    for (const bad of ['https://evil.com/x.png', '../x.png', 'products/../x.png', 'payment-proofs/secret.png', '/products/x.png', 'products/a b.png']) {
      await expect(A.saveProduct(null, productForm({ slug: 'bad-key', imageKey: bad }))).rejects.toThrow('مفتاح الصورة غير صالح')
    }
    await expect(A.saveProduct(null, productForm({ slug: 'bad-key', newImageKeys: ['https://evil.com/x.png'] }))).rejects.toThrow('مفتاح الصورة غير صالح')
    expect((await rows(s.products)).some((p) => p.slug === 'bad-key')).toBe(false)
  })

  it('reports a duplicate slug with a clear message', async () => {
    await expect(A.saveProduct(null, productForm({ slug: 'test-product' }))).rejects.toThrow('مستخدم لمنتج آخر')
  })

  it('updates in place: keeps valid kept images, adds new ones, drops the rest, replaces the main image, deletes old files from R2', async () => {
    const [p] = (await rows(s.products)).filter((x) => x.slug === 'test-product')
    await A.saveProduct(p.id, productForm({
      name: 'منتج معدّل', price: '120', imageKey: KEY('products', 'main2'),
      keptImages: [KEY('products', 'g1'), 'products/foreign.png'], newImageKeys: [KEY('products', 'g3')],
      isNew: 'false',
    }))
    const [after] = (await rows(s.products)).filter((x) => x.id === p.id)
    expect(after).toMatchObject({ name: 'منتج معدّل', price: 120, mainImageKey: KEY('products', 'main2'), isNew: false })
    const imgs = (await rows(s.productImages)).filter((i) => i.productId === p.id).sort((a, b) => a.sortOrder - b.sortOrder)
    expect(imgs.map((i) => i.imageKey)).toEqual([KEY('products', 'g1'), KEY('products', 'g3')])
    expect(deleted()).toEqual([KEY('products', 'g2'), KEY('products', 'main')].sort())
    expect((await rows(s.productColors)).filter((c) => c.productId === p.id)).toHaveLength(0)
    expect(after.productNumber).toBe(p.productNumber)
  })

  it('applies stock as a delta from what the admin saw, so orders placed meanwhile are not erased', async () => {
    const [p] = (await rows(s.products)).filter((x) => x.slug === 'test-product')
    await db.update(s.products).set({ stock: 10 }).where(eq(s.products.id, p.id))
    // admin opens the form (sees 10); a customer buys 3 meanwhile; admin saves a price change without touching stock
    await db.update(s.products).set({ stock: 7 }).where(eq(s.products.id, p.id))
    await A.saveProduct(p.id, productForm({ keptImages: [KEY('products', 'g1'), KEY('products', 'g3')], name: 'منتج معدّل', price: '130', stock: '10', stockBase: '10' }))
    expect((await rows(s.products)).find((x) => x.id === p.id)!.stock).toBe(7)
    // admin deliberately adds 5 units (10 -> 15) while 7 are on the shelf -> 12
    await A.saveProduct(p.id, productForm({ keptImages: [KEY('products', 'g1'), KEY('products', 'g3')], name: 'منتج معدّل', price: '130', stock: '15', stockBase: '10' }))
    expect((await rows(s.products)).find((x) => x.id === p.id)!.stock).toBe(12)
    // never negative
    await A.saveProduct(p.id, productForm({ keptImages: [KEY('products', 'g1'), KEY('products', 'g3')], name: 'منتج معدّل', price: '130', stock: '0', stockBase: '100' }))
    expect((await rows(s.products)).find((x) => x.id === p.id)!.stock).toBe(0)
    // without a base (old clients) the value is absolute
    await A.saveProduct(p.id, productForm({ keptImages: [KEY('products', 'g1'), KEY('products', 'g3')], name: 'منتج معدّل', price: '130', stock: '9' }))
    expect((await rows(s.products)).find((x) => x.id === p.id)!.stock).toBe(9)
  })

  it('does not delete anything from R2 when the images are unchanged', async () => {
    const [p] = (await rows(s.products)).filter((x) => x.slug === 'test-product')
    await A.saveProduct(p.id, productForm({ keptImages: [KEY('products', 'g1'), KEY('products', 'g3')] }))
    expect(mocks.deleteImageObject).not.toHaveBeenCalled()
  })

  it('removes the legacy "new" tag when the flag is switched off, so the product really leaves the list', async () => {
    const tagged = (await rows(s.products)).find((x) => x.tags.includes('new'))!
    await A.saveProduct(tagged.id, form({ name: tagged.name, categoryId: tagged.categoryId, price: String(tagged.price), slug: tagged.slug, isNew: 'false' }))
    const [after] = (await rows(s.products)).filter((x) => x.id === tagged.id)
    expect(after.tags).not.toContain('new')
    expect(after.isNew).toBe(false)
  })
})

describe('toggleProductFlag and deleteProduct', () => {
  it('toggles the flag and keeps tags consistent', async () => {
    const target = (await rows(s.products)).find((x) => x.tags.includes('bestseller'))!
    await A.toggleProductFlag(target.id, 'isBestseller', false)
    let [after] = (await rows(s.products)).filter((x) => x.id === target.id)
    expect(after.isBestseller).toBe(false)
    expect(after.tags).not.toContain('bestseller')
    await A.toggleProductFlag(target.id, 'isBestseller', true)
    ;[after] = (await rows(s.products)).filter((x) => x.id === target.id)
    expect(after.isBestseller).toBe(true)
    await expect(A.toggleProductFlag(target.id, 'price' as 'isNew', true)).rejects.toThrow('حقل غير مدعوم')
    await expect(A.toggleProductFlag('00000000-0000-4000-8000-000000000000', 'isNew', true)).rejects.toThrow('غير موجود')
  })

  it('deletes a product with its images and colors, keeps order history, and removes its files from R2', async () => {
    const [p] = (await rows(s.products)).filter((x) => x.slug === 'test-product')
    await db.insert(s.productColors).values({ productId: p.id, name: 'x', hex: '#000000' })
    const [customer] = await db.insert(s.customers).values({ publicId: 'CUS_DEL', phone: '967700000001' }).returning()
    const [order] = await db.insert(s.orders).values({ orderNumber: 'ORD-DEL', customerId: customer.id, customerName: 'x', phone: '1', subtotal: 1, total: 1 }).returning()
    await db.insert(s.orderItems).values({ orderId: order.id, productId: p.id, name: 'منتج اختبار', quantity: 1, price: 1 })

    await A.deleteProduct(p.id)
    expect((await rows(s.products)).some((x) => x.id === p.id)).toBe(false)
    expect((await rows(s.productImages)).filter((i) => i.productId === p.id)).toHaveLength(0)
    expect((await rows(s.productColors)).filter((c) => c.productId === p.id)).toHaveLength(0)
    const [item] = (await rows(s.orderItems)).filter((i) => i.orderId === order.id)
    expect(item.productId).toBeNull()
    expect(item.name).toBe('منتج اختبار')
    expect(deleted()).toEqual([KEY('products', 'g1'), KEY('products', 'g3'), KEY('products', 'main2')].sort())
    mocks.revalidateTag.mockClear()
    await A.deleteProduct(p.id) // already gone: silent no-op
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
  })
})

describe('categories', () => {
  it('creates a category with subcategories, then diffs them on update, and guards deletion', async () => {
    await A.saveCategory(null, form({ name: 'قسم جديد', slug: 'new-cat', imageKey: KEY('categories', 'c1'), sortOrder: '3', subcategories: JSON.stringify([{ name: 'فرعي أ', slug: 'sub-a' }, { name: 'فرعي ب', slug: 'sub-b', description: 'وصف' }, { name: 'مكرر', slug: 'sub-a' }]) }))
    const cat = (await rows(s.categories)).find((c) => c.slug === 'new-cat')!
    expect(cat).toMatchObject({ name: 'قسم جديد', sortOrder: 3, imageKey: KEY('categories', 'c1') })
    let subs = (await rows(s.subcategories)).filter((x) => x.categoryId === cat.id).sort((a, b) => a.sortOrder - b.sortOrder)
    expect(subs.map((x) => [x.slug, x.name])).toEqual([['sub-a', 'مكرر'], ['sub-b', 'فرعي ب']])

    const subBId = subs[1].id
    await A.saveCategory(cat.id, form({ name: 'قسم جديد', slug: 'new-cat', imageKey: KEY('categories', 'c2'), subcategories: JSON.stringify([{ name: 'فرعي ب', slug: 'sub-b' }, { name: 'فرعي ج', slug: 'sub-c' }]) }))
    subs = (await rows(s.subcategories)).filter((x) => x.categoryId === cat.id).sort((a, b) => a.sortOrder - b.sortOrder)
    expect(subs.map((x) => x.slug)).toEqual(['sub-b', 'sub-c'])
    expect(subs[0].id).toBe(subBId) // kept row is updated in place, not recreated
    expect(deleted()).toEqual([KEY('categories', 'c1')])

    await db.insert(s.products).values({ productNumber: 'P-IN-CAT', name: 'p', slug: 'p-in-cat', categoryId: cat.id, price: 1, description: 'd' })
    await expect(A.deleteCategory(cat.id)).rejects.toThrow('لوجود 1 منتج')
    await db.delete(s.products).where(eq(s.products.slug, 'p-in-cat'))
    mocks.deleteImageObject.mockClear()
    await A.deleteCategory(cat.id)
    expect((await rows(s.categories)).some((c) => c.id === cat.id)).toBe(false)
    expect((await rows(s.subcategories)).filter((x) => x.categoryId === cat.id)).toHaveLength(0)
    expect(deleted()).toEqual([KEY('categories', 'c2')])
  })

  it('validates the name and reports duplicate slugs', async () => {
    await expect(A.saveCategory(null, form({ slug: 'x' }))).rejects.toThrow('اسم القسم مطلوب')
    await expect(A.saveCategory(null, form({ name: 'مكرر', slug: 'accessories' }))).rejects.toThrow('مستخدم لقسم آخر')
  })
})

describe('brands, slides, coupons, reviews', () => {
  it('manages brands and deletes replaced/removed images', async () => {
    await A.saveBrand(null, form({ name: 'ماركة جديدة', slug: 'new-brand', imageKey: KEY('brands', 'b1'), featured: 'true' }))
    const b = (await rows(s.brands)).find((x) => x.slug === 'new-brand')!
    expect(b.featured).toBe(true)
    await A.saveBrand(b.id, form({ name: 'ماركة جديدة', slug: 'new-brand', imageKey: KEY('brands', 'b2') }))
    expect(deleted()).toEqual([KEY('brands', 'b1')])
    await expect(A.saveBrand(null, form({ name: 'مكررة', slug: 'new-brand' }))).rejects.toThrow('مستخدم لبراند آخر')
    await A.deleteBrand(b.id)
    expect(deleted()).toContain(KEY('brands', 'b2'))
    expect((await rows(s.brands)).some((x) => x.id === b.id)).toBe(false)
  })

  it('requires an image for new slides and keeps the image when updating without one', async () => {
    await expect(A.saveSlide(null, form({ title: 'شريحة' }))).rejects.toThrow('صورة السلايد مطلوبة')
    await A.saveSlide(null, form({ title: 'شريحة', imageKey: KEY('slides', 's1') }))
    const sl = (await rows(s.slides)).find((x) => x.title === 'شريحة')!
    expect(sl.href).toBe('/')
    await A.saveSlide(sl.id, form({ title: 'شريحة معدلة', href: '/shop' }))
    const [after] = (await rows(s.slides)).filter((x) => x.id === sl.id)
    expect(after).toMatchObject({ title: 'شريحة معدلة', href: '/shop', imageKey: KEY('slides', 's1') })
    expect(mocks.deleteImageObject).not.toHaveBeenCalled()
    await A.deleteSlide(sl.id)
    expect(deleted()).toEqual([KEY('slides', 's1')])
  })

  it('validates coupons, uppercases codes, and blocks duplicates case-insensitively', async () => {
    await expect(A.saveCoupon(null, form({ discount: '5', description: 'd' }))).rejects.toThrow('كود الخصم مطلوب')
    await expect(A.saveCoupon(null, form({ code: 'X', description: 'd' }))).rejects.toThrow('قيمة الخصم مطلوبة')
    await expect(A.saveCoupon(null, form({ code: 'X', discount: '-1', description: 'd' }))).rejects.toThrow('سالبة')
    await expect(A.saveCoupon(null, form({ code: 'X', discount: '150', type: 'percent', description: 'd' }))).rejects.toThrow('100%')
    await expect(A.saveCoupon(null, form({ code: 'X', discount: '5' }))).rejects.toThrow('وصف الكوبون مطلوب')
    await A.saveCoupon(null, form({ code: 'summer5', discount: '5', type: 'percent', minOrder: '100', description: 'صيف' }))
    const c = (await rows(s.coupons)).find((x) => x.code === 'SUMMER5')!
    expect(c).toMatchObject({ type: 'percent', minOrder: 100 })
    await expect(A.saveCoupon(null, form({ code: 'Summer5', discount: '1', description: 'd' }))).rejects.toThrow('مستخدم بالفعل')
    await A.saveCoupon(c.id, form({ code: 'SUMMER5', discount: '8', type: 'percent', description: 'صيف 8' }))
    expect((await rows(s.coupons)).find((x) => x.id === c.id)!.discount).toBe(8)
    await expect(A.saveCoupon('00000000-0000-4000-8000-000000000000', form({ code: 'NOPE', discount: '1', description: 'd' }))).rejects.toThrow('غير موجود')
    await A.deleteCoupon(c.id)
    expect((await rows(s.coupons)).some((x) => x.id === c.id)).toBe(false)
  })

  it('manages reviews: clamps ratings, defaults the date, validates it, replaces avatars', async () => {
    await expect(A.saveReview(null, form({ comment: 'c' }))).rejects.toThrow('اسم العميل مطلوب')
    await expect(A.saveReview(null, form({ name: 'n' }))).rejects.toThrow('نص التقييم مطلوب')
    await expect(A.saveReview(null, form({ name: 'n', comment: 'c', date: '1/2/2026' }))).rejects.toThrow('تاريخ غير صالح')
    await A.saveReview(null, form({ name: 'عميل', comment: 'ممتاز', rating: '9', avatarKey: KEY('reviews', 'a1') }))
    const r = (await rows(s.reviews)).find((x) => x.name === 'عميل')!
    expect(r.rating).toBe(5)
    expect(r.reviewDate).toBe(new Date().toISOString().slice(0, 10))
    await A.saveReview(r.id, form({ name: 'عميل', comment: 'ممتاز', rating: '0', avatarKey: KEY('reviews', 'a2') }))
    expect((await rows(s.reviews)).find((x) => x.id === r.id)!.rating).toBe(1)
    expect(deleted()).toEqual([KEY('reviews', 'a1')])
    await A.deleteReview(r.id)
    expect(deleted()).toContain(KEY('reviews', 'a2'))
  })
})

describe('ads and settings', () => {
  it('creates ads with only existing categories, rewrites links on update, toggles and deletes', async () => {
    await expect(A.saveAd(null, form({ title: 'إعلان' }))).rejects.toThrow('صورة الإعلان مطلوبة')
    await A.saveAd(null, form({ title: 'إعلان', imageKey: KEY('ads', 'a1'), active: 'true', frequency: '0', categoryIds: [categoryId, '00000000-0000-4000-8000-000000000000'] }))
    const ad = (await rows(s.ads)).find((x) => x.title === 'إعلان')!
    expect(ad).toMatchObject({ active: true, frequency: 1 })
    expect((await rows(s.adCategories)).filter((l) => l.adId === ad.id).map((l) => l.categoryId)).toEqual([categoryId])

    await A.saveAd(ad.id, form({ title: 'إعلان', categoryIds: [] }))
    expect((await rows(s.adCategories)).filter((l) => l.adId === ad.id)).toHaveLength(0)
    expect(mocks.deleteImageObject).not.toHaveBeenCalled()
    await A.toggleAdActive(ad.id, false)
    expect((await rows(s.ads)).find((x) => x.id === ad.id)!.active).toBe(false)
    await expect(A.saveAd(null, form({ title: 'x', imageKey: KEY('ads', 'a2'), categoryIds: ['not-a-uuid'] }))).rejects.toThrow('معرّف غير صالح')
    await A.deleteAd(ad.id)
    expect(deleted()).toEqual([KEY('ads', 'a1')])
  })

  it('saves video ads with a validated video key, placements and dates, and removes replaced videos', async () => {
    const poster = KEY('ads', 'p1')
    await expect(A.saveAd(null, form({ title: 'ف', kind: 'video', imageKey: poster }))).rejects.toThrow('فيديو الإعلان مطلوب')
    await expect(A.saveAd(null, form({ title: 'ف', kind: 'video', imageKey: poster, videoKey: KEY('ads', 'x') }))).rejects.toThrow('مفتاح الفيديو غير صالح')
    await expect(A.saveAd(null, form({ title: 'ف', kind: 'video', videoKey: 'ads/v1.mp4' }))).rejects.toThrow('صورة الغلاف مطلوبة')
    await expect(A.saveAd(null, form({ title: 'ف', imageKey: poster, startsOn: '2026-02-30' }))).rejects.toThrow('تاريخ البداية غير صالح')
    await expect(A.saveAd(null, form({ title: 'ف', imageKey: poster, startsOn: '2026-05-02', endsOn: '2026-05-01' }))).rejects.toThrow('النهاية')

    await A.saveAd(null, form({ title: 'فيديو', kind: 'video', imageKey: poster, videoKey: 'ads/v1.mp4', placements: ['grid', 'bogus', 'grid'], startsOn: '2026-05-01', endsOn: '2026-05-31' }))
    const ad = (await rows(s.ads)).find((x) => x.title === 'فيديو')!
    expect(ad).toMatchObject({ kind: 'video', videoKey: 'ads/v1.mp4', placements: ['grid'], startsOn: '2026-05-01', endsOn: '2026-05-31' })

    await A.saveAd(ad.id, form({ title: 'فيديو', kind: 'video', videoKey: 'ads/v2.mp4' }))
    expect((await rows(s.ads)).find((x) => x.id === ad.id)).toMatchObject({ videoKey: 'ads/v2.mp4', placements: [], startsOn: null })
    expect(deleted()).toEqual(['ads/v1.mp4'])

    await A.saveAd(ad.id, form({ title: 'فيديو', kind: 'image' }))
    expect((await rows(s.ads)).find((x) => x.id === ad.id)).toMatchObject({ kind: 'image', videoKey: null })
    expect(deleted()).toEqual(['ads/v1.mp4', 'ads/v2.mp4'])

    await A.saveAd(ad.id, form({ title: 'فيديو', kind: 'video', videoKey: 'ads/v3.mp4' }))
    mocks.deleteImageObject.mockClear()
    await A.deleteAd(ad.id)
    expect(deleted()).toEqual([poster, 'ads/v3.mp4'].sort())
  })

  it('upserts the single settings row and removes a replaced logo', async () => {
    await A.saveSettings(null, form({ name: 'متجر', whatsapp: '967700000000', instagram: 'https://instagram.com/x', logoKey: KEY('site', 'l1'), codEnabled: 'true' }))
    await A.saveSettings('anything', form({ name: 'متجر 2', logoKey: KEY('site', 'l2'), transferEnabled: 'true' }))
    const all = await rows(s.siteSettings)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: 1, name: 'متجر 2', logoKey: KEY('site', 'l2'), whatsapp: null, instagram: null, codEnabled: false, transferEnabled: true })
    expect(deleted()).toEqual([KEY('site', 'l1')])
  })
})

describe('panel users', () => {
  it('creates users with a hashed password and enforces username and password rules', async () => {
    await expect(A.saveUser(null, form({ password: '123456' }))).rejects.toThrow('اسم المستخدم مطلوب')
    await expect(A.saveUser(null, form({ username: 'a b', password: '123456' }))).rejects.toThrow('3 أحرف')
    await expect(A.saveUser(null, form({ username: 'editor1', password: '123' }))).rejects.toThrow('6 أحرف')
    await expect(A.saveUser(null, form({ username: 'editor1' }))).rejects.toThrow('مطلوبة')
    await A.saveUser(null, form({ username: 'Editor1', password: 'secret1', name: 'محرر', role: 'admin', active: 'true' }))
    const u = (await rows(s.manageUsers)).find((x) => x.username === 'Editor1')!
    expect(u).toMatchObject({ role: 'admin', active: true, name: 'محرر' })
    expect(u.passwordHash).not.toContain('secret1')
    expect(verifyPasswordHash('secret1', u.passwordHash)).toBe(true)
    await expect(A.saveUser(null, form({ username: 'editor1', password: 'secret2' }))).rejects.toThrow('مُستخدم بالفعل')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/manage')
  })

  it('keeps the password when updating without one, changes it when given, and toggles/deletes', async () => {
    const u = (await rows(s.manageUsers)).find((x) => x.username === 'Editor1')!
    await A.saveUser(u.id, form({ username: 'Editor1', name: 'جديد', role: 'editor', active: 'true' }))
    let [after] = (await rows(s.manageUsers)).filter((x) => x.id === u.id)
    expect(after).toMatchObject({ name: 'جديد', role: 'editor', passwordHash: u.passwordHash })
    await expect(A.saveUser(u.id, form({ username: 'Editor1', password: '12' }))).rejects.toThrow('6 أحرف')
    await A.saveUser(u.id, form({ username: 'Editor1', password: 'newpass1', active: 'true' }))
    ;[after] = (await rows(s.manageUsers)).filter((x) => x.id === u.id)
    expect(verifyPasswordHash('newpass1', after.passwordHash)).toBe(true)
    await A.toggleUserActive(u.id, false)
    expect((await rows(s.manageUsers)).find((x) => x.id === u.id)!.active).toBe(false)
    await A.deleteUser(u.id)
    expect((await rows(s.manageUsers)).some((x) => x.id === u.id)).toBe(false)
    expect(await A.getCurrentManageUser()).toBe('tester')
    expect(hashPassword('x')).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
  })
})

describe('authorization', () => {
  it('every action requires a manage session and writes nothing when it is missing', async () => {
    mocks.auth.mockRejectedValue(new Error('UNAUTHORIZED'))
    const before = [(await rows(s.products)).length, (await rows(s.categories)).length, (await rows(s.coupons)).length, (await rows(s.manageUsers)).length]
    const id = '00000000-0000-4000-8000-000000000000'
    const attempts = [
      A.saveProduct(null, productForm({ slug: 'unauth' })), A.deleteProduct(id), A.toggleProductFlag(id, 'isNew', true),
      A.saveCategory(null, form({ name: 'x' })), A.deleteCategory(id), A.saveBrand(null, form({ name: 'x' })), A.deleteBrand(id),
      A.saveSlide(null, form({ title: 'x' })), A.deleteSlide(id), A.saveCoupon(null, form({ code: 'X', discount: '1', description: 'd' })),
      A.deleteCoupon(id), A.saveReview(null, form({ name: 'x', comment: 'x' })), A.deleteReview(id), A.saveAd(null, form({ title: 'x' })),
      A.toggleAdActive(id, true), A.deleteAd(id), A.saveSettings(null, form({ name: 'x' })), A.saveUser(null, form({ username: 'abc', password: '123456' })),
      A.deleteUser(id), A.toggleUserActive(id, true), A.generateProductSlug({ product: 'x' }), uploads.requestImageUpload('products', 'image/png', 10),
    ]
    for (const a of attempts) await expect(a).rejects.toThrow('UNAUTHORIZED')
    expect([(await rows(s.products)).length, (await rows(s.categories)).length, (await rows(s.coupons)).length, (await rows(s.manageUsers)).length]).toEqual(before)
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
    mocks.auth.mockReset()
    mocks.auth.mockResolvedValue(undefined)
  })
})

describe('generateProductSlug', () => {
  it('returns a clean English slug from the model output, and falls back without the model', async () => {
    expect(await A.generateProductSlug({ category: 'نساء', product: 'فستان', brand: 'نايكي' })).toBe('women-dress-nike')
    expect(await A.generateProductSlug({})).toBe('')
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockRejectedValueOnce(new Error('offline'))
    expect(await A.generateProductSlug({ product: 'Red Shirt' })).toBe('red-shirt')
  })
})

describe('requestImageUpload', () => {
  it('validates folder, type, size and configuration before signing', async () => {
    const saved = { ...process.env }
    Object.assign(process.env, { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd', R2_PUBLIC_URL: 'https://cdn.example.com' })
    await expect(uploads.requestImageUpload('payment-proofs', 'image/png', 10)).rejects.toThrow('مجلد الصور غير مسموح')
    await expect(uploads.requestImageUpload('../x', 'image/png', 10)).rejects.toThrow('مجلد الصور غير مسموح')
    await expect(uploads.requestImageUpload('products', 'application/pdf', 10)).rejects.toThrow('نوع الصورة غير مدعوم')
    await expect(uploads.requestImageUpload('products', 'image/png', 0)).rejects.toThrow('حجم الصورة')
    await expect(uploads.requestImageUpload('products', 'image/png', 6 * 1024 * 1024)).rejects.toThrow('حجم الصورة')
    expect(await uploads.requestImageUpload('brands', 'image/png', 1000)).toEqual({ uploadUrl: 'https://r2/brands/image/png/1000', objectKey: 'brands/new.png' })
    delete process.env.R2_BUCKET
    await expect(uploads.requestImageUpload('products', 'image/png', 1000)).rejects.toThrow('غير مضبوط')
    Object.assign(process.env, saved)
  })
})

describe('requestVideoUpload', () => {
  it('accepts only MP4 within the size limit and a configured bucket', async () => {
    const saved = { ...process.env }
    Object.assign(process.env, { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd', R2_PUBLIC_URL: 'https://cdn.example.com' })
    await expect(uploads.requestVideoUpload('video/webm', 1000)).rejects.toThrow('MP4 فقط')
    await expect(uploads.requestVideoUpload('video/mp4', 0)).rejects.toThrow('حجم الفيديو')
    await expect(uploads.requestVideoUpload('video/mp4', 9 * 1024 * 1024)).rejects.toThrow('حجم الفيديو')
    expect(await uploads.requestVideoUpload('video/mp4', 1000)).toEqual({ uploadUrl: 'https://r2/video/video/mp4/1000', objectKey: 'ads/new.mp4' })
    delete process.env.R2_BUCKET
    await expect(uploads.requestVideoUpload('video/mp4', 1000)).rejects.toThrow('غير مضبوط')
    Object.assign(process.env, saved)
  })
})

describe('helpers', () => {
  it('validates uuids, slugs, image keys, tags and unique-violation shapes', () => {
    expect(helpers.uuidParam('00000000-0000-4000-8000-000000000000')).toBeTruthy()
    for (const bad of ['', 'x', null, undefined, 5, '00000000-0000-4000-8000-00000000000g']) expect(() => helpers.uuidParam(bad)).toThrow('معرّف غير صالح')
    expect(helpers.slugify(' فستان   أحمر! ')).toBe('فستان-أحمر')
    expect(helpers.englishSlug('Red  Shirt!! 2026')).toBe('red-shirt-2026')
    expect(helpers.syncTags(['new', 'offer', 'bestseller'], { isNew: false })).toEqual(['offer', 'bestseller'])
    expect(helpers.syncTags(['new'], { isNew: true })).toEqual(['new'])
    expect(helpers.uniqueViolation({ code: '23505', constraint_name: 'products_slug_unique' })).toBe('products_slug_unique')
    expect(helpers.uniqueViolation({ cause: { code: '23505', constraint: 'x_idx' } })).toBe('x_idx')
    expect(helpers.uniqueViolation({ code: '23503' })).toBeNull()
    expect(helpers.uniqueViolation(null)).toBeNull()
    const f = form({ a: ' x ', n: '3.5', t: 'true', j: '[1]', bad: '{' })
    expect(helpers.str(f, 'a')).toBe('x')
    expect(helpers.str(f, 'missing')).toBeUndefined()
    expect(helpers.num(f, 'n')).toBe(3.5)
    expect(helpers.num(f, 'a')).toBeUndefined()
    expect(helpers.bool(f, 't')).toBe(true)
    expect(helpers.json(f, 'j', [])).toEqual([1])
    expect(helpers.json(f, 'bad', 'fallback')).toBe('fallback')
  })
})
