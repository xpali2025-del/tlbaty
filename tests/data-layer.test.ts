import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
process.env.R2_PUBLIC_URL = 'https://cdn.example.com/'

const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))
// Next's cache primitives are passthroughs here: the tests exercise the queries, not Next's cache.
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

const data = await import('@/lib/data')
const { resolveImageUrl, resolveOptionalImageUrl } = await import('@/lib/images')

const seed = loadSeedData(path.resolve(__dirname, '../scripts/migration/data'))
const bySlug = new Map(seed.products.map((p) => [p.slug, p]))

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  await importCatalog(db, seed, { resolveImage: async (p) => p })
})

describe('products', () => {
  it('returns every product in file order with the exact legacy shape', async () => {
    const list = await data.getProducts()
    expect(list).toHaveLength(73)
    expect(list.map((p) => p.slug)).toEqual(seed.products.map((p) => p.slug))

    const raw = bySlug.get('accessories-product-1')!
    const p = list.find((x) => x.slug === raw.slug)!
    expect(p).toEqual({
      id: 'gp150', // the product number, not the internal uuid
      slug: 'accessories-product-1',
      name: raw.name,
      description: raw.description,
      price: 59,
      image: '/products/accessory-1.jpg',
      images: ['/products/accessory-1.jpg', '/products/accessory-b.png'],
      category: 'accessories',
      subcategory: 'gold-accessories',
      brand: raw.brand,
      rating: 4,
      reviewsCount: 10,
      colors: raw.colors,
      sizes: ['S', 'M', 'L'],
      stock: 8,
      isNew: false,
      isBestseller: false,
      tags: ['regular'],
      metaTitle: raw.metaTitle,
      metaDescription: raw.metaDescription,
      keywords: raw.keywords,
      sku: 'gp150',
      oldPrice: undefined,
      badge: undefined,
    })
  })

  it('finds products by slug and by product number, and returns undefined for unknown ones', async () => {
    expect((await data.getProductBySlug('accessories-product-1'))?.id).toBe('gp150')
    expect((await data.getProductById('gp150'))?.slug).toBe('accessories-product-1')
    expect(await data.getProductBySlug('nope')).toBeUndefined()
    expect(await data.getProductById('nope')).toBeUndefined()
  })

  it('builds the bestseller, new and offer lists with the legacy rules (flag or tag)', async () => {
    const tagged = (tag: string, flag: 'isBestseller' | 'isNew') => seed.products.filter((p) => p[flag] || p.tags?.includes(tag)).map((p) => p.slug)
    expect((await data.getBestsellers()).map((p) => p.slug).sort()).toEqual(tagged('bestseller', 'isBestseller').sort())
    expect((await data.getNewArrivals()).map((p) => p.slug).sort()).toEqual(tagged('new', 'isNew').sort())
    const offers = seed.products.filter((p) => (p.oldPrice != null && p.oldPrice > p.price) || p.tags?.includes('offer')).map((p) => p.slug)
    expect((await data.getOfferProducts()).map((p) => p.slug).sort()).toEqual(offers.sort())
    expect(offers.length).toBeGreaterThan(0)
  })

  it('filters by category, subcategory and brand', async () => {
    const cat = 'accessories'
    expect((await data.getProductsByCategory(cat)).map((p) => p.slug)).toEqual(seed.products.filter((p) => p.category === cat).map((p) => p.slug))
    expect((await data.getProductsBySubcategory('gold-accessories')).every((p) => p.subcategory === 'gold-accessories')).toBe(true)
    const brand = seed.brands[0]
    expect((await data.getProductsByBrand(brand.slug)).map((p) => p.slug)).toEqual(
      seed.products.filter((p) => p.brand?.trim() === brand.name.trim()).map((p) => p.slug),
    )
    expect(await data.getProductsByCategory('nope')).toEqual([])
  })

  it('searches name, description and category slug case-insensitively', async () => {
    expect(await data.searchProducts('   ')).toEqual([])
    expect((await data.searchProducts('ACCESSORIES')).length).toBe(seed.products.filter((p) => p.category.includes('accessories')).length)
    expect((await data.searchProducts('عقد ذهبي')).length).toBeGreaterThan(0)
    expect(await data.searchProducts('zzzz-no-match')).toEqual([])
  })

  it('lists slugs for static generation', async () => {
    expect((await data.getProductSlugs()).sort()).toEqual(seed.products.map((p) => p.slug).sort())
  })
})

describe('categories and brands', () => {
  it('returns categories with real product counts and slug-based ids', async () => {
    const list = await data.getCategories()
    expect(list.map((c) => c.slug)).toEqual(seed.categories.map((c) => c.slug))
    for (const c of list) {
      expect(c.id).toBe(c.slug)
      expect(c.productCount).toBe(seed.products.filter((p) => p.category === c.slug).length)
      const raw = seed.categories.find((x) => x.slug === c.slug)!
      expect(c.subcategories?.map((x) => x.slug)).toEqual((raw.subcategories ?? []).map((x) => x.slug))
    }
    expect(list.reduce((a, c) => a + (c.productCount ?? 0), 0)).toBe(73)
  })

  it('finds a category by slug and counts subcategory products', async () => {
    const cat = seed.categories.find((c) => c.subcategories?.length)!
    expect((await data.getCategoryBySlug(cat.slug))?.name).toBe(cat.name)
    expect(await data.getCategoryBySlug('nope')).toBeUndefined()
    const subs = await data.getSubcategoriesWithCounts(cat.slug)
    expect(subs.map((x) => x.slug)).toEqual(cat.subcategories!.map((x) => x.slug))
    for (const sub of subs) {
      expect(sub.count).toBe(seed.products.filter((p) => p.category === cat.slug && p.subcategory === sub.slug).length)
    }
    expect((await data.getSubcategoryBySlug(cat.slug, cat.subcategories![0].slug))?.name).toBe(cat.subcategories![0].name)
    expect(await data.getSubcategoryBySlug(cat.slug, 'nope')).toBeUndefined()
    expect(await data.getSubcategories('nope')).toEqual([])
  })

  it('builds footer links and slug lists', async () => {
    expect(await data.getFooterCategories()).toEqual(seed.categories.map((c) => ({ label: c.name, href: `/category/${c.slug}` })))
    expect((await data.getCategorySlugs()).sort()).toEqual(seed.categories.map((c) => c.slug).sort())
    expect((await data.getBrandSlugs()).sort()).toEqual(seed.brands.map((b) => b.slug).sort())
  })

  it('returns brands with product counts', async () => {
    const list = await data.getBrands()
    expect(list.map((b) => b.slug)).toEqual(seed.brands.map((b) => b.slug))
    for (const b of list) {
      expect(b.productCount).toBe(seed.products.filter((p) => p.brand?.trim() === b.name.trim()).length)
      expect(b.featured).toBe(Boolean(seed.brands.find((x) => x.slug === b.slug)!.featured))
    }
    expect((await data.getBrandBySlug(seed.brands[0].slug))?.name).toBe(seed.brands[0].name)
    expect(await data.getBrandBySlug('nope')).toBeUndefined()
  })
})

describe('marketing content', () => {
  it('returns slides in order with legacy defaults', async () => {
    const list = await data.getSlides()
    expect(list).toHaveLength(3)
    expect(list.map((x) => x.title)).toEqual(seed.slides.map((x) => x.title))
    expect(list[0]).toEqual({
      id: expect.any(String), title: seed.slides[0].title, subtitle: seed.slides[0].subtitle ?? '',
      cta: seed.slides[0].cta ?? '', href: seed.slides[0].href ?? '/', image: seed.slides[0].image,
    })
  })

  it('returns coupons and validates them like before', async () => {
    const coupons = await data.getCoupons()
    expect(coupons).toHaveLength(3)
    const fixed = seed.coupons.find((c) => c.type === 'fixed')!
    const percent = seed.coupons.find((c) => c.type === 'percent')!
    expect((await data.validateCoupon('nope', 1000)).valid).toBe(false)
    const ok = await data.validateCoupon(fixed.code.toLowerCase(), (fixed.minOrder ?? 0) + 1000)
    expect(ok).toMatchObject({ valid: true, discountAmount: fixed.discount })
    const pct = await data.validateCoupon(percent.code, 10000 + (percent.minOrder ?? 0))
    expect(pct.discountAmount).toBe(Math.round(((10000 + (percent.minOrder ?? 0)) * percent.discount) / 100))
    if (percent.minOrder) expect((await data.validateCoupon(percent.code, percent.minOrder - 1)).message).toMatch(/الحد الأدنى/)
  })

  it('returns reviews newest first with their dates', async () => {
    const list = await data.getReviews()
    expect(list).toHaveLength(4)
    const dates = list.map((r) => r.date)
    expect(dates).toEqual([...dates].sort().reverse())
    expect(list[0]).toMatchObject({ name: expect.any(String), rating: expect.any(Number), comment: expect.any(String), avatar: undefined })
  })

  it('returns active ads, filtered by category with "all" semantics', async () => {
    const all = await data.getAds()
    expect(all.length).toBe(seed.ads.filter((a) => a.active !== false).length)
    const catAd = seed.ads.find((a) => (a.categories ?? []).some((c) => c !== 'all'))
    if (catAd) {
      const slug = catAd.categories!.find((c) => c !== 'all')!
      expect((await data.getAds(slug)).some((a) => a.title === catAd.title)).toBe(true)
      expect((await data.getAds('some-other-category')).some((a) => a.title === catAd.title)).toBe(false)
    }
    const universal = seed.ads.filter((a) => !(a.categories ?? []).filter((c) => c !== 'all').length)
    for (const u of universal) expect((await data.getAds('anything')).some((a) => a.title === u.title)).toBe(true)
  })
})

describe('video ads', () => {
  it('maps video fields and hides ads outside their date window', async () => {
    const base = { imageKey: 'ads/p.webp', active: true }
    await db.insert(s.ads).values([
      { ...base, title: 'v-live', kind: 'video', videoKey: 'ads/v.mp4', placements: ['grid'], startsOn: '2000-01-01', endsOn: '2999-12-31' },
      { ...base, title: 'v-expired', endsOn: '2000-01-01' },
      { ...base, title: 'v-future', startsOn: '2999-01-01' },
    ])
    const list = await data.getAds()
    const live = list.find((a) => a.title === 'v-live')!
    expect(live).toMatchObject({ kind: 'video', placements: ['grid'], startsOn: '2000-01-01', endsOn: '2999-12-31' })
    expect(live.videoUrl).toContain('ads/v.mp4')
    expect(list.some((a) => a.title === 'v-expired' || a.title === 'v-future')).toBe(false)
  })
})

describe('shipping, payment accounts and currencies', () => {
  it('returns shipping zones, default first, with ordered methods', async () => {
    const [zone] = await db.insert(s.shippingZones).values({ governorate: 'صنعاء' }).returning()
    const [def] = await db.insert(s.shippingZones).values({ isDefault: true }).returning()
    await db.insert(s.shippingMethods).values([
      { zoneId: zone.id, name: 'عادي', price: 1500, icon: 'standard', sortOrder: 1 },
      { zoneId: zone.id, name: 'سريع', price: 3000, icon: 'express', sortOrder: 0, description: 'خلال يوم' },
      { zoneId: def.id, name: 'استلام', price: 0, icon: 'pickup' },
    ])
    const zones = await data.getShippingZones()
    expect(zones.map((z) => [z.governorate, z.isDefault])).toEqual([['', true], ['صنعاء', false]])
    expect(zones[1].methods.map((m) => [m.name, m.price, m.icon, m.desc])).toEqual([
      ['سريع', 3000, 'express', 'خلال يوم'],
      ['عادي', 1500, 'standard', ''],
    ])
  })

  it('exposes only active, complete payment accounts, sorted, with resolved images', async () => {
    await db.insert(s.paymentAccounts).values([
      { providerName: 'Kuraimi', accountHolderName: 'A', accountNumber: '111', sortOrder: 2, imageKey: 'payment-accounts/k.png' },
      { providerName: 'CAC', accountHolderName: 'B', accountNumber: '222', sortOrder: 1, accountDisplayName: 'Bank' },
      { providerName: 'Hidden', accountHolderName: 'C', accountNumber: '333', isActive: false },
    ])
    const list = await data.getPaymentAccounts()
    expect(list.map((a) => a.providerName)).toEqual(['CAC', 'Kuraimi'])
    expect(list[1].imageUrl).toBe('https://cdn.example.com/payment-accounts/k.png')
    expect(list[0]).toMatchObject({ accountDisplayName: 'Bank', instructions: '', imageUrl: undefined })

    const hidden = (await db.select().from(s.paymentAccounts)).find((a) => a.providerName === 'Hidden')!
    expect(await data.getPaymentAccountById(hidden.id)).toMatchObject({ providerName: 'Hidden', isActive: false })
    expect(await data.getPaymentAccountById('not-a-uuid')).toBeNull()
    expect(await data.getPaymentAccountById('00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(await data.getPaymentAccountById('')).toBeNull()
  })

  it('falls back to the default currencies, then reads the configured ones', async () => {
    const { DEFAULT_CURRENCY_SETTINGS } = await import('@/lib/currency')
    expect(await data.getCurrencySettings()).toEqual(DEFAULT_CURRENCY_SETTINGS)
    await db.insert(s.siteSettings).values({ defaultCurrency: 'USD' })
    await db.insert(s.currencies).values([
      { code: 'YER', name: 'ريال يمني', symbol: 'ر.ي', rate: 1, sortOrder: 0 },
      { code: 'USD', name: 'دولار', symbol: '$', rate: 0.0004, sortOrder: 1 },
    ])
    const settings = await data.getCurrencySettings()
    expect(settings.defaultCode).toBe('USD')
    expect(settings.currencies.map((c) => c.code)).toEqual(expect.arrayContaining(['YER', 'USD']))
  })
})

describe('without a database', () => {
  const saved = process.env.DATABASE_URL
  afterEach(() => void (process.env.DATABASE_URL = saved))

  it('returns safe empty values and never touches the database', async () => {
    delete process.env.DATABASE_URL
    const spy = vi.spyOn(db, 'select')
    expect(await data.getProducts()).toEqual([])
    expect(await data.getProductBySlug('x')).toBeUndefined()
    expect(await data.getCategories()).toEqual([])
    expect(await data.getBrands()).toEqual([])
    expect(await data.getSlides()).toEqual([])
    expect(await data.getAds()).toEqual([])
    expect(await data.getFooterCategories()).toEqual([])
    expect(await data.getPaymentAccountById('00000000-0000-4000-8000-000000000000')).toBeNull()
    expect((await data.getCurrencySettings()).currencies.length).toBeGreaterThan(0)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('image URLs', () => {
  it('resolves R2 keys, keeps local paths and URLs, and falls back to the placeholder', () => {
    expect(resolveImageUrl('products/a.jpg')).toBe('https://cdn.example.com/products/a.jpg')
    expect(resolveImageUrl('/products/a.jpg')).toBe('/products/a.jpg')
    expect(resolveImageUrl('https://other.example.com/x.jpg')).toBe('https://other.example.com/x.jpg')
    expect(resolveImageUrl(null)).toBe('/placeholder.svg')
    expect(resolveOptionalImageUrl(undefined)).toBeUndefined()
    const base = process.env.R2_PUBLIC_URL
    delete process.env.R2_PUBLIC_URL
    expect(resolveImageUrl('products/a.jpg')).toBe('/placeholder.svg')
    process.env.R2_PUBLIC_URL = base
  })
})
