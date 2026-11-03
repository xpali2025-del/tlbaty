import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import * as s from '@/lib/db/store'
import { refreshProductSearch } from '@/lib/search-index'
import { buildSearchText } from '@/lib/search-text'

const queries: string[] = []
const db = drizzle(new PGlite(), { logger: { logQuery: (query) => queries.push(query) } })
let categoryId: string
let brandId: string
let productIds: string[]

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  const [category] = await db.insert(s.categories).values({ name: 'أزياء', slug: 'index-batch' }).returning()
  const [brand] = await db.insert(s.brands).values({ name: 'Brand', slug: 'index-brand' }).returning()
  categoryId = category.id
  brandId = brand.id
  const rows = await db.insert(s.products).values(Array.from({ length: 501 }, (_, i) => ({
    productNumber: `BATCH-${i}`, name: `فُستان ${i}`, slug: `batch-${i}`, categoryId, brandId,
    price: 50, stock: 7, description: "O'Brien قماش", sizes: ['S', 'M'], tags: ['new'], keywords: ['هدية'],
  }))).returning({ id: s.products.id })
  productIds = rows.map((r) => r.id)
  await db.insert(s.productColors).values(productIds.flatMap((productId) => [
    { productId, name: 'أحمر', hex: '#FF0000', sortOrder: 1 },
    { productId, name: 'أزرق', hex: '#0000FF', sortOrder: 0 },
  ]))
  // Observe actual row writes, including a second refresh with unchanged text.
  await db.execute(sql`create table search_write_audit (product_id uuid)`)
  await db.execute(sql`create function audit_search_write() returns trigger language plpgsql as $$
    begin insert into search_write_audit values (new.id); return new; end $$`)
  await db.execute(sql`create trigger audit_search_write after update of search_text on store.products
    for each row execute function audit_search_write()`)
})

describe('bounded search index updates', () => {
  it('refreshes 501 products with three bulk updates and preserves searchable fields and stock', async () => {
    queries.length = 0
    expect(await refreshProductSearch(db, { categoryId })).toBe(501)
    const updates = queries.filter((q) => /^\s*update "store"\."products"/.test(q))
    expect(updates).toHaveLength(3)
    for (const p of await db.select().from(s.products)) {
      expect(p.searchText).toBe(buildSearchText({
        name: p.name, description: p.description, code: p.productNumber, sku: p.sku,
        sizes: p.sizes, tags: p.tags, keywords: p.keywords, category: 'أزياء', brand: 'Brand', colors: ['أزرق', 'أحمر'],
      }))
      expect(p.stock).toBe(7)
      expect(p.price).toBe(50)
    }
    const audit = await db.execute<{ count: number }>(sql`select count(*)::int as count from search_write_audit`)
    expect(audit.rows[0].count).toBe(501)
    await refreshProductSearch(db, { brandId })
    const unchanged = await db.execute<{ count: number }>(sql`select count(*)::int as count from search_write_audit`)
    expect(unchanged.rows[0].count).toBe(501)
  })

  it('honors explicit IDs, empty and absent scopes, and an exact page boundary', async () => {
    queries.length = 0
    expect(await refreshProductSearch(db, { productIds: [] })).toBe(0)
    expect(queries).toHaveLength(0)
    expect(await refreshProductSearch(db, { categoryId: '00000000-0000-4000-8000-000000000000' })).toBe(0)
    await db.update(s.products).set({ searchText: 'stale' })
    const ids = productIds.slice(0, 250)
    expect(await refreshProductSearch(db, { productIds: ids })).toBe(250)
    const stale = await db.select().from(s.products).where(eq(s.products.searchText, 'stale'))
    expect(stale).toHaveLength(251)
    expect(stale.every((p) => !ids.includes(p.id))).toBe(true)
    expect(await refreshProductSearch(db)).toBe(501)
    expect(await db.select().from(s.products).where(eq(s.products.searchText, 'stale'))).toHaveLength(0)
  })
})
