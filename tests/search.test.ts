import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { buildSearchQuery, parseSearchParams } from '@/lib/search-params'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

const { searchProducts, searchByPalette, getSearchFacets, relevance } = await import('@/lib/search')

const seed = loadSeedData(path.resolve(__dirname, '../scripts/migration/data'))
const names = (r: { items: { name: string }[] }) => r.items.map((i) => i.name)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  await importCatalog(db, seed, { assignCodes: true })
})

describe('params', () => {
  it('parses, validates and round-trips', () => {
    const p = parseSearchParams(new URLSearchParams('q=%20%D9%81%D8%B3%D8%AA%D8%A7%D9%86%20&category=women&color=a&color=b&size=M&min=500&max=100&stock=1&sort=price_asc&limit=9999&brand=%3Cscript%3E'))
    expect(p).toMatchObject({ q: 'فستان', categories: ['women'], colors: ['a', 'b'], sizes: ['M'], minPrice: 100, maxPrice: 500, inStock: true, sort: 'price_asc', limit: 120 })
    expect(p.brand).toBeUndefined()
    expect(parseSearchParams({ sort: 'evil', min: '-5', max: 'abc', limit: '0' })).toEqual({})
    expect(parseSearchParams(new URLSearchParams(buildSearchQuery(p)))).toEqual({ ...p, limit: 120 })
  })
})

describe('params: multiple categories, quick filters and legacy links', () => {
  it('keeps several categories, de-duplicated, and round-trips them', () => {
    const p = parseSearchParams(new URLSearchParams('category=a&category=b&category=a&category=%3Cx%3E'))
    expect(p.categories).toEqual(['a', 'b'])
    expect(buildSearchQuery(p)).toBe('category=a&category=b')
    expect(parseSearchParams(new URLSearchParams(buildSearchQuery(p)))).toEqual(p)
  })
  it('reads the bestseller chip and maps the old /categories?filter= links', () => {
    expect(parseSearchParams({ bestseller: '1' })).toEqual({ bestseller: true })
    expect(parseSearchParams({ filter: 'offers' })).toEqual({ onSale: true })
    expect(parseSearchParams({ filter: 'bestsellers' })).toEqual({ bestseller: true })
    expect(parseSearchParams({ filter: 'new' })).toEqual({ sort: 'newest' })
    expect(parseSearchParams({ filter: 'new', sort: 'price_asc' })).toEqual({ sort: 'price_asc' })
    expect(parseSearchParams({ filter: 'all' })).toEqual({})
  })
  it('counts filter groups (not each value) for the filter button badge', async () => {
    const { activeFilterCount } = await import('@/lib/search-params')
    expect(activeFilterCount({ categories: ['a', 'b'], colors: ['x', 'y'], sizes: ['M'], minPrice: 1, maxPrice: 5, sort: 'newest' })).toBe(5)
    expect(activeFilterCount({ onSale: true, bestseller: true, q: 'x' })).toBe(0)
  })
})

describe('searchProducts', () => {
  it('lists everything with no filters and counts the total', async () => {
    const r = await searchProducts({ limit: 100 })
    expect(r.total).toBe(seed.products.length)
    expect(r.items).toHaveLength(seed.products.length)
  })

  it('matches words across name/brand/category regardless of arabic spelling', async () => {
    const sample = seed.products.find((p) => /[أإآة]/.test(p.name))!
    const word = sample.name.split(' ').find((w) => /[أإآة]/.test(w))!
    const plain = word.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
    const r = await searchProducts({ q: plain, limit: 100 })
    expect(names(r)).toContain(sample.name)
    expect((await searchProducts({ q: 'zzzzqqq' })).items).toEqual([])
  })

  it('requires every word and ranks name matches first', async () => {
    const p = seed.products[0]
    const [w1, w2] = p.name.split(' ')
    const r = await searchProducts({ q: `${w1} ${w2 ?? ''}`.trim(), limit: 100 })
    expect(names(r)[0]).toBe(p.name)
    const narrow = await searchProducts({ q: `${w1} zzzzqqq` })
    expect(narrow.items).toEqual([])
  })

  it('finds a product by its short code in any typing style and puts it first', async () => {
    const [row] = await db.select().from(s.products).limit(1)
    const code = row.productNumber
    const [prefix, num] = code.split('-')
    for (const q of [code, code.toLowerCase(), `${prefix}${Number(num)}`, `${prefix} ${num}`]) {
      const r = await searchProducts({ q })
      expect(r.items[0]?.id, q).toBe(code)
      expect(r.matchedCode).toBe(code)
    }
  })

  it('filters by category, brand, price, stock and sale', async () => {
    const facets = await getSearchFacets()
    const cat = facets.categories[0]
    const inCat = await searchProducts({ categories: [cat.slug], limit: 100 })
    expect(inCat.total).toBe(cat.count)
    expect(inCat.items.every((p) => p.category === cat.slug)).toBe(true)

    const b = facets.brands[0]
    const byBrand = await searchProducts({ brand: b.slug, limit: 100 })
    expect(byBrand.total).toBe(b.count)

    const cheap = await searchProducts({ maxPrice: facets.price.min + 1, limit: 100 })
    expect(cheap.items.every((p) => p.price <= facets.price.min + 1)).toBe(true)
    const range = await searchProducts({ minPrice: facets.price.max, limit: 100 })
    expect(range.items.every((p) => p.price >= facets.price.max)).toBe(true)

    await db.update(s.products).set({ stock: 0 }).where(eq(s.products.productNumber, inCat.items[0].id))
    const inStock = await searchProducts({ categories: [cat.slug], inStock: true, limit: 100 })
    expect(inStock.total).toBe(cat.count - 1)

    const sale = await searchProducts({ onSale: true, limit: 100 })
    expect(sale.items.every((p) => p.oldPrice !== undefined && p.oldPrice > p.price)).toBe(true)
    expect(sale.total).toBeGreaterThan(0)
  })

  it('filters by several categories at once', async () => {
    const facets = await getSearchFacets()
    const [a, b] = facets.categories
    const both = await searchProducts({ categories: [a.slug, b.slug], limit: 200 })
    expect(both.total).toBe(a.count + b.count)
    expect(both.items.every((p) => p.category === a.slug || p.category === b.slug)).toBe(true)
    expect((await searchProducts({ categories: ['no-such-category'] })).items).toEqual([])
  })

  it('bestseller filter and popular sort use the flag or the legacy tag; offers include tagged offers', async () => {
    const [x, y] = await db.select().from(s.products).limit(2)
    await db.update(s.products).set({ isBestseller: false, tags: [] })
    await db.update(s.products).set({ isBestseller: true }).where(eq(s.products.productNumber, x.productNumber))
    await db.update(s.products).set({ tags: ['bestseller', 'offer'] }).where(eq(s.products.productNumber, y.productNumber))
    const best = await searchProducts({ bestseller: true, limit: 200 })
    expect(best.items.map((p) => p.id).sort()).toEqual([x.productNumber, y.productNumber].sort())
    const popular = await searchProducts({ sort: 'popular', limit: 200 })
    expect(new Set(popular.items.slice(0, 2).map((p) => p.id))).toEqual(new Set([x.productNumber, y.productNumber]))
    const offers = await searchProducts({ onSale: true, limit: 200 })
    expect(offers.items.map((p) => p.id)).toContain(y.productNumber)
  })

  it('filters by one color (grouped by normalized name) and by size', async () => {
    const facets = await getSearchFacets()
    const color = facets.colors[0]
    const r = await searchProducts({ colors: [color.key], limit: 100 })
    expect(r.total).toBe(r.items.length)
    expect(r.total).toBeGreaterThan(0)
    for (const p of r.items) expect(p.colors.some((c) => c.name.trim().length > 0)).toBe(true)
    expect((await searchProducts({ colors: ['no-such-color'] })).items).toEqual([])

    const size = facets.sizes[0].size
    const bySize = await searchProducts({ sizes: [size], limit: 100 })
    expect(bySize.items.length).toBeGreaterThan(0)
    expect(bySize.items.every((p) => p.sizes.includes(size))).toBe(true)
  })

  it('combines filters with text and sorts by price', async () => {
    const asc = await searchProducts({ sort: 'price_asc', limit: 100 })
    const prices = asc.items.map((p) => p.price)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    const desc = await searchProducts({ sort: 'price_desc', limit: 100 })
    expect(desc.items[0].price).toBe(Math.max(...prices))
  })

  it('never lets LIKE wildcards act as wildcards: punctuation-only queries are just an empty query', async () => {
    const all = (await searchProducts({})).total
    expect((await searchProducts({ q: '%%' })).total).toBe(all)
    expect((await searchProducts({ q: 'ab_%' })).total).toBeLessThan(all) // becomes the token «ab», not a pattern
  })

  it('relevance prefers whole-word name matches', () => {
    expect(relevance({ name: 'فستان احمر', stock: 1 }, ['احمر'])).toBeGreaterThan(relevance({ name: 'فستان', stock: 1 }, ['احمر']))
  })
})

describe('facets', () => {
  it('only lists non-empty categories/brands with counts, sizes and a price range', async () => {
    const f = await getSearchFacets()
    expect(f.categories.every((c) => c.count > 0)).toBe(true)
    expect(f.categories.reduce((n, c) => n + c.count, 0)).toBe(seed.products.length)
    expect(f.price.max).toBeGreaterThanOrEqual(f.price.min)
    expect(f.sizes.length).toBeGreaterThan(0)
  })
})

describe('searchByPalette', () => {
  it('ranks products by palette similarity, falls back to declared colors, and respects filters', async () => {
    const [a, b] = await db.select().from(s.products).limit(2)
    await db.update(s.products).set({ imagePalette: [{ hex: '#c81e28', weight: 1 }] }).where(eq(s.products.id, a.id))
    await db.update(s.products).set({ imagePalette: [{ hex: '#1e28c8', weight: 1 }] }).where(eq(s.products.id, b.id))
    const red = await searchByPalette([{ hex: '#d02530', weight: 1 }])
    expect(red.items[0].id).toBe(a.productNumber)
    expect(red.items[0].similarity).toBeGreaterThan(0.8)
    expect(red.items.find((p) => p.id === b.productNumber)).toBeUndefined()
    const blue = await searchByPalette([{ hex: '#2030c0', weight: 1 }])
    expect(blue.items[0].id).toBe(b.productNumber)

    const cat = (await db.select().from(s.categories).where(eq(s.categories.id, b.categoryId)))[0]
    const other = await db.select().from(s.categories)
    const elsewhere = other.find((c) => c.id !== cat.id)!
    expect((await searchByPalette([{ hex: '#2030c0', weight: 1 }], { categories: [elsewhere.slug] })).items.find((p) => p.id === b.productNumber)).toBeUndefined()
    expect((await searchByPalette([])).items).toEqual([])
  })
})

describe('image search route', () => {
  it('validates the palette, applies filters and answers with similarity', async () => {
    const { POST } = await import('@/app/api/search/image/route')
    const call = (body: unknown, ip = '1.1.1.1') => POST(new Request('http://x/api/search/image', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) }) as never)
    expect((await call('not json')).status).toBe(400)
    expect((await call({ palette: [{ hex: 'red', weight: 1 }] })).status).toBe(400)
    const ok = await call({ palette: [{ hex: '#d02530', weight: 1 }] })
    expect(ok.status).toBe(200)
    const data = await ok.json()
    expect(data.items.length).toBeGreaterThan(0)
    expect(data.items[0]).toHaveProperty('similarity')
    // limiter: the 21st call in a minute from one address is refused
    let last = 200
    for (let i = 0; i < 25; i++) last = (await call({ palette: [{ hex: '#d02530', weight: 1 }] }, '9.9.9.9')).status
    expect(last).toBe(429)
  })

  it('survives non-string filter values instead of answering 500', async () => {
    const { POST } = await import('@/app/api/search/image/route')
    const res = await POST(new Request('http://x/api/search/image', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '3.3.3.3' }, body: JSON.stringify({ palette: [{ hex: '#d02530', weight: 1 }], filters: { q: 5, category: { a: 1 }, color: [1, 'x'], limit: [] } }) }) as never)
    expect(res.status).toBe(200)
  })
})

describe('image search feature switch', () => {
  it('rejects direct requests when disabled, then permits them on re-enable', async () => {
    const { POST } = await import('@/app/api/search/image/route')
    const request = () => new Request('http://x/api/search/image', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '5.6.7.8' }, body: JSON.stringify({ palette: [{ hex: '#d02530', weight: 1 }] }) }) as never
    await db.insert(s.siteSettings).values({ id: 1, imageSearchEnabled: false }).onConflictDoUpdate({ target: s.siteSettings.id, set: { imageSearchEnabled: false } })
    expect((await POST(request())).status).toBe(403)
    expect((await searchProducts({})).total).toBeGreaterThan(0)
    await db.update(s.siteSettings).set({ imageSearchEnabled: true }).where(eq(s.siteSettings.id, 1))
    expect((await POST(request())).status).toBe(200)
  })
})
