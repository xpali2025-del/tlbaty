import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { count, eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import * as s from '@/lib/db/store'
import { collectImagePaths, importCatalog, loadSeedData, validateSeed, type SeedData } from '../scripts/migration/import-catalog'
import { contentTypeFor, createImageResolver, r2KeyFor, sanityAssetUrl } from '../scripts/migration/images'

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
    expect(row.sanityId).toBe(`product-${tagged.slug}`)
    const brandId = (await db.select().from(s.brands).where(eq(s.brands.name, tagged.brand!.trim())))[0].id
    expect(row.brandId).toBe(brandId)

    const allAd = seed.ads.find((a) => (a.categories ?? []).includes('all') || !(a.categories ?? []).length)
    if (allAd) {
      const [ad] = await db.select().from(s.ads).where(eq(s.ads.sanityId, `ad-${allAd.id}`))
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
    const [slide] = await fresh.select().from(s.slides).where(eq(s.slides.sanityId, `slide-${seed.slides[0].id}`))
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

  it('builds stable R2 keys inside allowed folders', () => {
    expect(r2KeyFor('/products/accessory-1.jpg')).toBe('products/accessory-1.jpg')
    expect(r2KeyFor('/slider/hero 1.png')).toBe('slides/hero-1.png')
    expect(r2KeyFor('/weird/x.png')).toBe('site/x.png')
    expect(r2KeyFor('/products/../../etc/passwd.jpg')).not.toContain('..')
    expect(contentTypeFor('a.PNG')).toBe('image/png')
    expect(contentTypeFor('a.bin')).toBe('application/octet-stream')
  })

  it('converts Sanity asset ids to CDN URLs', () => {
    expect(sanityAssetUrl('image-4cd1da52-1024x1024-jpg', 'proj', 'production')).toBe('https://cdn.sanity.io/images/proj/production/4cd1da52-1024x1024.jpg')
    expect(sanityAssetUrl('file-abc-pdf', 'proj', 'production')).toBeNull()
  })

  it('local mode keeps the public path for existing files and reports missing ones', async () => {
    const resolve = createImageResolver({ ...base, fileExists: (f) => f.endsWith('here.jpg'), cache: {} })
    expect(await resolve('/products/here.jpg')).toBe('/products/here.jpg')
    expect(await resolve('/products/gone.jpg')).toBeNull()
  })

  it('R2 mode uploads local files once and then serves from the cache', async () => {
    const uploads: string[] = []
    const cache: Record<string, string> = {}
    const resolve = createImageResolver({
      ...base, fileExists: () => true, cache,
      upload: async (key, _b, type) => void uploads.push(`${key}|${type}`),
    })
    expect(await resolve('/products/a.jpg')).toBe('products/a.jpg')
    expect(await resolve('/products/a.jpg')).toBe('products/a.jpg')
    expect(uploads).toEqual(['products/a.jpg|image/jpeg'])
  })

  it('downloads from the Sanity CDN when the file is not local, and skips unknown assets or failed downloads', async () => {
    const uploads: string[] = []
    const fetched: string[] = []
    const resolve = createImageResolver({
      ...base, fileExists: () => false, cache: {},
      upload: async (key) => void uploads.push(key),
      sanity: {
        projectId: 'proj', dataset: 'ds',
        assetIds: { '/products/a.jpg': 'image-aa11-100x100-jpg', '/products/b.jpg': 'image-bb22-100x100-jpg' },
        fetchBytes: async (url) => { fetched.push(url); return url.includes('bb22') ? null : Buffer.from('x') },
      },
    })
    expect(await resolve('/products/a.jpg')).toBe('products/a.jpg')
    expect(await resolve('/products/b.jpg')).toBeNull() // CDN returned 404
    expect(await resolve('/products/c.jpg')).toBeNull() // no known asset id
    expect(fetched).toEqual(['https://cdn.sanity.io/images/proj/ds/aa11-100x100.jpg', 'https://cdn.sanity.io/images/proj/ds/bb22-100x100.jpg'])
    expect(uploads).toEqual(['products/a.jpg'])
  })
})
