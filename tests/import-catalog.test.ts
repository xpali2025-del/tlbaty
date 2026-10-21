import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { count, eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import * as s from '@/lib/db/store'
import { collectImagePaths, importCatalog, loadSeedData, validateSeed, type SeedData } from '../scripts/migration/import-catalog'

const DATA_DIR = path.resolve(__dirname, '../scripts/migration/data')
const seed = loadSeedData(DATA_DIR)
const localResolver = async (p: string) => p

const db = drizzle(new PGlite())
const n = async (table: PgTable) => (await db.select({ c: count() }).from(table))[0].c

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})

describe('seed data', () => {
  it('has the expected size and consistent references', () => {
    expect(seed.categories).toHaveLength(9)
    expect(seed.brands).toHaveLength(4)
    expect(seed.products).toHaveLength(73)
    const { errors, warnings } = validateSeed(seed)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('lists every distinct image path once', () => {
    const paths = collectImagePaths(seed)
    expect(paths).toHaveLength(new Set(paths).size)
    expect(paths.length).toBe(40)
  })
})

describe('validateSeed', () => {
  const clone = (): SeedData => structuredClone(seed)

  it('rejects unknown categories, duplicates, bad prices and bad dates', () => {
    const d = clone()
    d.products[0].category = 'nope'
    d.products[2].slug = d.products[1].slug
    d.products[3].id = d.products[4].id
    d.products[5].price = -1
    d.reviews[0].date = '21/10/2026'
    const { errors } = validateSeed(d)
    expect(errors.join('\n')).toMatch(/القسم غير موجود \(nope\)/)
    expect(errors.join('\n')).toMatch(/سلاج منتج مكرر/)
    expect(errors.join('\n')).toMatch(/رقم منتج مكرر/)
    expect(errors.join('\n')).toMatch(/سعر غير صالح/)
    expect(errors.join('\n')).toMatch(/تاريخ غير صالح/)
  })

  it('only warns about unknown brands and subcategories', () => {
    const d = clone()
    d.products[0].brand = 'Unknown'
    d.products[1].subcategory = 'unknown-sub'
    const { errors, warnings } = validateSeed(d)
    expect(errors).toEqual([])
    expect(warnings).toHaveLength(2)
  })
})

describe('importCatalog', () => {
  it('imports the real seed data with the expected row counts', async () => {
    const report = await importCatalog(db, seed, { resolveImage: localResolver })
    expect(report.missingImages).toEqual([])
    expect(report.counts).toMatchObject({ categories: 9, brands: 4, products: 73, slides: 3, coupons: 3, reviews: 4, ads: 3 })
    expect(await n(s.categories)).toBe(9)
    expect(await n(s.brands)).toBe(4)
    expect(await n(s.products)).toBe(73)
    expect(await n(s.slides)).toBe(3)
    expect(await n(s.coupons)).toBe(3)
    expect(await n(s.reviews)).toBe(4)
    expect(await n(s.ads)).toBe(3)
    const expectedSubs = seed.categories.reduce((a, c) => a + (c.subcategories?.length ?? 0), 0)
    expect(await n(s.subcategories)).toBe(expectedSubs)
    const expectedImages = seed.products.reduce((a, p) => a + (p.images?.length ?? 0), 0)
    expect(await n(s.productImages)).toBe(expectedImages)
    const expectedColors = seed.products.reduce((a, p) => a + (p.colors?.length ?? 0), 0)
    expect(await n(s.productColors)).toBe(expectedColors)
  })

  it('is idempotent: running it again changes nothing', async () => {
    const before = [await n(s.products), await n(s.productImages), await n(s.productColors), await n(s.subcategories), await n(s.adCategories)]
    await importCatalog(db, seed, { resolveImage: localResolver })
    const after = [await n(s.products), await n(s.productImages), await n(s.productColors), await n(s.subcategories), await n(s.adCategories)]
    expect(after).toEqual(before)
  })

  it('applies the legacy rules: tags drive isNew/isBestseller, brand links by name, "all" ads have no categories', async () => {
    const tagged = seed.products.find((p) => p.tags?.includes('bestseller'))!
    const [row] = await db.select().from(s.products).where(eq(s.products.slug, tagged.slug))
    expect(row.isBestseller).toBe(true)
    expect(row.tags).toEqual(tagged.tags)
    expect(row.productNumber).toBe(tagged.id)
    const brandId = (await db.select().from(s.brands).where(eq(s.brands.name, tagged.brand!.trim())))[0].id
    expect(row.brandId).toBe(brandId)

    const allAd = seed.ads.find((a) => (a.categories ?? []).includes('all') || !(a.categories ?? []).length)
    if (allAd) {
      const [ad] = await db.select().from(s.ads).where(eq(s.ads.title, allAd.title))
      const links = await db.select().from(s.adCategories).where(eq(s.adCategories.adId, ad.id))
      expect(links).toHaveLength(0)
    }
  })

  it('updates existing rows in place when the data changes', async () => {
    const changed = structuredClone(seed)
    changed.products[0].price = 12345
    changed.products[0].images = [changed.products[0].images![0]]
    await importCatalog(db, changed, { resolveImage: localResolver })
    const [row] = await db.select().from(s.products).where(eq(s.products.slug, changed.products[0].slug))
    expect(row.price).toBe(12345)
    expect(await n(s.products)).toBe(73)
    expect(await db.select().from(s.productImages).where(eq(s.productImages.productId, row.id))).toHaveLength(1)
    await importCatalog(db, seed, { resolveImage: localResolver })
  })

  it('stores a placeholder for required images that could not be resolved and reports them', async () => {
    const fresh = drizzle(new PGlite())
    await migrate(fresh, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
    const missing = new Set([seed.slides[0].image!, seed.products[0].image!])
    const report = await importCatalog(fresh, seed, { resolveImage: async (p) => (missing.has(p) ? null : p) })
    expect(report.missingImages.sort()).toEqual([...missing].sort())
    const [slide] = await fresh.select().from(s.slides).where(eq(s.slides.title, seed.slides[0].title))
    expect(slide.imageKey).toBe('/placeholder.svg')
    const [prod] = await fresh.select().from(s.products).where(eq(s.products.slug, seed.products[0].slug))
    expect(prod.mainImageKey).toBeNull()
  })

  it('rolls everything back when any row fails, leaving the database untouched', async () => {
    const fresh = drizzle(new PGlite())
    await migrate(fresh, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
    const broken = structuredClone(seed)
    broken.products[40].rating = 9 // violates products_rating_range, after categories/brands/40 products were written
    await expect(importCatalog(fresh, broken, { resolveImage: localResolver })).rejects.toThrow()
    for (const table of [s.categories, s.brands, s.products, s.slides, s.coupons, s.reviews, s.ads]) {
      expect((await fresh.select({ c: count() }).from(table))[0].c).toBe(0)
    }
  })

  it('refuses invalid data before touching the database', async () => {
    const fresh = drizzle(new PGlite())
    await migrate(fresh, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
    const bad = structuredClone(seed)
    bad.products[0].category = 'nope'
    await expect(importCatalog(fresh, bad, { resolveImage: localResolver })).rejects.toThrow(/بيانات غير صالحة/)
    expect((await fresh.select({ c: count() }).from(s.categories))[0].c).toBe(0)
  })
})

describe('image resolver', () => {
  const base = { publicDir: '/pub', readFile: async () => Buffer.from('img') }

  it('is idempotent for one-time tables: re-running does not duplicate slides, reviews, ads or coupons', async () => {
    const before = [await n(s.slides), await n(s.reviews), await n(s.ads), await n(s.coupons)]
    await importCatalog(db, seed, { resolveImage: localResolver })
    expect([await n(s.slides), await n(s.reviews), await n(s.ads), await n(s.coupons)]).toEqual(before)
  })

  it('imports without any image resolver: no image keys, placeholder for required ones', async () => {
    const fresh = drizzle(new PGlite())
    await migrate(fresh, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
    const report = await importCatalog(fresh, seed, {})
    expect(report.missingImages.length).toBeGreaterThan(0)
    const slides = await fresh.select().from(s.slides)
    expect(slides.every((x) => x.imageKey === '/placeholder.svg')).toBe(true)
    expect((await fresh.select().from(s.products)).every((x) => x.mainImageKey === null)).toBe(true)
  })

  it('assignCodes gives every product a short sequential code per category, stable across re-runs', async () => {
    const fresh = drizzle(new PGlite())
    await migrate(fresh, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
    await importCatalog(fresh, seed, { assignCodes: true })
    const rows = await fresh.select().from(s.products)
    expect(rows.every((p) => /^[A-Z]{2,4}[0-9]?-\d{3,}$/.test(p.productNumber))).toBe(true)
    expect(new Set(rows.map((p) => p.productNumber)).size).toBe(rows.length)
    const before = new Map(rows.map((p) => [p.slug, p.productNumber]))
    await importCatalog(fresh, seed, { assignCodes: true })
    for (const p of await fresh.select().from(s.products)) expect(p.productNumber).toBe(before.get(p.slug))
    const cats = await fresh.select().from(s.categories)
    expect(cats.every((c) => c.code && c.productSeq > 0)).toBe(true)
  })
})
