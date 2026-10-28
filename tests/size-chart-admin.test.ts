import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { COMMON_SIZE_CHARTS, type SizeChart } from '@/lib/size-chart'
import { unwrapAll } from '@/lib/action-result'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
const auth = vi.hoisted(() => vi.fn(async (_s?: string) => {}))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: vi.fn(async () => {}) }))
vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: auth, assertManageAuthenticated: auth, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'مدير' }))

const C = await import('@/app/manage/size-chart-actions')
const P = unwrapAll(await import('@/app/manage/actions'))
const { getProductBySlug } = await import('@/lib/data')
const { getAdminSizeCharts, getAdminProducts } = await import('@/lib/admin')

const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
let categoryId: string
const womenChart = COMMON_SIZE_CHARTS[0]
const custom: SizeChart = { name: 'خاص', columns: [{ key: 'chest', label: 'الصدر' }], rows: [{ size: 'M', ranges: { chest: [90, 95] } }, { size: 'L', ranges: { chest: [96, 101] } }] }
const productForm = (slug: string, guide?: object) =>
  form({ name: `منتج ${slug}`, categoryId, price: '100', slug, sizes: JSON.stringify(['M', 'L']), ...(guide ? { sizeGuide: JSON.stringify(guide) } : {}) })

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  categoryId = (await db.insert(s.categories).values({ name: 'ملابس', slug: 'clothes' }).returning())[0].id
})

describe('size chart actions', () => {
  it('seed the common charts once and never overwrite an edited one', async () => {
    expect(await C.seedCommonSizeCharts()).toEqual({ ok: true, message: 'أُضيف 4 جدول شائع' })
    expect(auth).toHaveBeenCalledWith('size-charts')
    const [women] = await db.select().from(s.sizeCharts).where(eq(s.sizeCharts.name, 'ملابس نسائية'))
    const edited = { ...womenChart, rows: womenChart.rows.map((r, i) => (i === 0 ? { ...r, size: 'XXS' } : r)) }
    expect((await C.saveSizeChart(women.id, edited)).ok).toBe(true)
    expect(await C.seedCommonSizeCharts()).toEqual({ ok: true, message: 'الجداول الشائعة موجودة بالفعل' })
    expect((await db.select().from(s.sizeCharts).where(eq(s.sizeCharts.id, women.id)))[0].rows[0].size).toBe('XXS')
    expect(await db.select().from(s.sizeCharts)).toHaveLength(4)
  })

  it('validate input and refuse duplicate names', async () => {
    expect(await C.saveSizeChart(null, { ...womenChart, name: '' })).toMatchObject({ ok: false })
    expect(await C.saveSizeChart(null, { ...womenChart, rows: [] })).toMatchObject({ ok: false })
    expect(await C.saveSizeChart(null, { ...womenChart, name: 'ملابس رجالية' })).toEqual({ ok: false, error: 'يوجد جدول بهذا الاسم' })
    expect((await C.saveSizeChart(null, { ...custom, name: 'جدول جديد' })).ok).toBe(true)
    expect(await C.saveSizeChart('00000000-0000-4000-8000-000000000000', { ...custom, name: 'x' })).toEqual({ ok: false, error: 'الجدول غير موجود' })
    expect(await C.saveSizeChart(null, 'not a chart' as never)).toEqual({ ok: false, error: 'بيانات الجدول غير صالحة' })
  })

  it('refuse everything without the permission', async () => {
    auth.mockRejectedValueOnce(new Error('unauthorized'))
    expect((await C.saveSizeChart(null, { ...custom, name: 'ممنوع' })).ok).toBe(false)
    expect((await db.select().from(s.sizeCharts).where(eq(s.sizeCharts.name, 'ممنوع')))).toHaveLength(0)
  })
})

describe('size guide on products', () => {
  it('is off by default, so existing products and quick saves need no size data', async () => {
    await P.saveProduct(null, productForm('plain'))
    const [p] = await db.select().from(s.products).where(eq(s.products.slug, 'plain'))
    expect(p).toMatchObject({ sizeChartId: null, customSizeChart: null })
    expect((await getProductBySlug('plain'))?.sizeChart).toBeUndefined()
  })

  it('uses a shared chart chosen with one click', async () => {
    const [men] = await db.select().from(s.sizeCharts).where(eq(s.sizeCharts.name, 'ملابس رجالية'))
    await P.saveProduct(null, productForm('with-chart', { mode: 'chart', chartId: men.id }))
    const product = await getProductBySlug('with-chart')
    expect(product?.sizeChart?.name).toBe('ملابس رجالية')
    expect(product?.sizeChart?.rows.map((r) => r.size)).toContain('XL')
    expect((await getAdminSizeCharts()).find((c) => c._id === men.id)?.productCount).toBe(1)
    expect((await getAdminProducts()).find((x) => x.slug === 'with-chart')?.sizeChartId).toBe(men.id)
  })

  it('uses a custom chart for one product, which wins over a shared one', async () => {
    await P.saveProduct(null, productForm('with-custom', { mode: 'custom', custom }))
    const product = await getProductBySlug('with-custom')
    expect(product?.sizeChart).toEqual(custom)
    const [row] = await db.select().from(s.products).where(eq(s.products.slug, 'with-custom'))
    expect(row.sizeChartId).toBeNull()
  })

  it('switching a product back to none clears the guide, and a deleted chart leaves products without a guide', async () => {
    const [men] = await db.select().from(s.sizeCharts).where(eq(s.sizeCharts.name, 'ملابس رجالية'))
    const [pChart] = await db.select().from(s.products).where(eq(s.products.slug, 'with-chart'))
    expect((await C.deleteSizeChart(men.id)).ok).toBe(true)
    expect((await db.select().from(s.products).where(eq(s.products.id, pChart.id)))[0].sizeChartId).toBeNull()
    expect((await getProductBySlug('with-chart'))?.sizeChart).toBeUndefined()

    const [pCustom] = await db.select().from(s.products).where(eq(s.products.slug, 'with-custom'))
    await P.saveProduct(pCustom.id, productForm('with-custom', { mode: 'none' }))
    expect((await db.select().from(s.products).where(eq(s.products.id, pCustom.id)))[0].customSizeChart).toBeNull()
  })

  it('reject a missing shared chart and an invalid custom chart without saving', async () => {
    await expect(P.saveProduct(null, productForm('bad-1', { mode: 'chart', chartId: '00000000-0000-4000-8000-000000000000' }))).rejects.toThrow('غير موجود')
    await expect(P.saveProduct(null, productForm('bad-2', { mode: 'custom', custom: { ...custom, rows: [] } }))).rejects.toThrow('عدد المقاسات')
    await expect(P.saveProduct(null, productForm('bad-3', { mode: 'custom', custom: 'x' }))).rejects.toThrow('غير صالحة')
    expect(await db.select().from(s.products).where(eq(s.products.slug, 'bad-1'))).toHaveLength(0)
  })
})
