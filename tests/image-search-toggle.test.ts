import path from 'node:path'
import sharp from 'sharp'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
const storage = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('@/lib/storage/r2', () => ({ getImageBytes: storage.read }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
const { processPaletteBackfill, refreshProductPalette, paletteBackfillStatus } = await import('@/lib/product-palette')
let categoryId: string
let png: Buffer
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  const [cat] = await db.insert(s.categories).values({ name: 'Test', slug: 'test' }).returning()
  categoryId = cat.id
  png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#a00000' } }).png().toBuffer()
})
beforeEach(async () => {
  await db.delete(s.products)
  await db.delete(s.siteSettings)
  storage.read.mockReset()
})
async function product(n: number) {
  const [row] = await db.insert(s.products).values({ productNumber: `T-${n}`, name: 'Test', slug: `test-${n}`, description: '', categoryId, price: 10, mainImageKey: `products/${n}.png` }).returning()
  return row
}
async function enable(value: boolean) {
  await db.insert(s.siteSettings).values({ id: 1, imageSearchEnabled: value }).onConflictDoUpdate({ target: s.siteSettings.id, set: { imageSearchEnabled: value } })
}

describe('image palette backfill', () => {
  it('does no image work while disabled and resumes when enabled', async () => {
    const p = await product(1)
    storage.read.mockResolvedValue(png)
    await enable(false)
    expect((await paletteBackfillStatus()).remaining).toBe(1)
    expect((await processPaletteBackfill()).attempted).toBe(0)
    expect(storage.read).not.toHaveBeenCalled()
    await enable(true)
    expect((await processPaletteBackfill()).done).toBe(1)
    expect((await db.select().from(s.products).where(eq(s.products.id, p.id)))[0].imagePalette).not.toEqual([])
  })
  it('defers a failed image while continuing with other products', async () => {
    const a = await product(1), b = await product(2)
    storage.read.mockImplementation(async (key: string) => key === a.mainImageKey ? null : png)
    const result = await processPaletteBackfill()
    expect(result).toMatchObject({ attempted: 2, done: 1, remaining: 1, deferred: 1 })
    expect((await db.select().from(s.products).where(eq(s.products.id, b.id)))[0].imagePalette).not.toEqual([])
    expect((await processPaletteBackfill()).attempted).toBe(0)
  })
  it.each(['image changed', 'disabled'])('discards an in-flight result when %s', async (reason) => {
    const p = await product(1)
    let start!: () => void
    const started = new Promise<void>(resolve => { start = resolve })
    let release!: (data: Buffer) => void
    storage.read.mockImplementation(() => { start(); return new Promise<Buffer>(resolve => { release = resolve }) })
    const pending = refreshProductPalette(p.id, p.mainImageKey)
    await started
    if (reason === 'image changed') await db.update(s.products).set({ mainImageKey: 'products/new.png', imagePalette: [] }).where(eq(s.products.id, p.id))
    if (reason === 'disabled') await enable(false)
    release(png)
    expect(await pending).toBe(false)
    expect((await db.select().from(s.products).where(eq(s.products.id, p.id)))[0].imagePalette).toEqual([])
  })
})
