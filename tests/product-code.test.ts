import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { buildProductNumber } from '@/lib/product-number'
import { canonicalCodeQuery, formatProductCode, isCategoryCode, isProductCode, suggestCategoryCode, toLatinDigits } from '@/lib/product-code'

const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))
const { allocateProductCode, ensureCategoryCode } = await import('@/lib/product-code-db')

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})

describe('code format', () => {
  it('formats with at least three digits', () => {
    expect(formatProductCode('DR', 1)).toBe('DR-001')
    expect(formatProductCode('DR', 12)).toBe('DR-012')
    expect(formatProductCode('DR', 1234)).toBe('DR-1234')
    expect(isProductCode('DR-012')).toBe(true)
    expect(isProductCode('TRF-ACC-GOL-AB12')).toBe(false)
    expect(isCategoryCode('DR')).toBe(true)
    expect(isCategoryCode('D')).toBe(false)
    expect(isCategoryCode('dr')).toBe(false)
  })
  it('suggests category codes from slugs and avoids collisions', () => {
    expect(suggestCategoryCode('women', new Set())).toBe('WOM')
    expect(suggestCategoryCode('women', new Set(['WOM']))).toBe('WOM2')
    expect(suggestCategoryCode('عطور', new Set())).toBe('CT')
    expect(suggestCategoryCode('عطور', new Set(['CT']))).toBe('CT2')
    expect(suggestCategoryCode('a', new Set())).toBe('CT')
  })
  it('turns what customers type into the canonical code', () => {
    for (const q of ['dr12', 'DR 12', 'dr-012', ' Dr_0012 ', 'دr١٢'.replace('د', 'D')]) expect(canonicalCodeQuery(q)).toBe('DR-012')
    expect(canonicalCodeQuery('dress')).toBeNull()
    expect(canonicalCodeQuery('فستان 12')).toBeNull()
    expect(canonicalCodeQuery('12')).toBeNull()
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩۰۱۲')).toBe('0123456789012')
  })
  it('keeps short codes as the displayed product number and legacy ids derived', () => {
    expect(buildProductNumber('DR-012')).toBe('DR-012')
    expect(buildProductNumber('gp150')).toBe('TJ-GP150')
  })
})

describe('allocation', () => {
  it('hands out sequential, never reused codes per category', async () => {
    const [c1, c2] = await db.insert(s.categories).values([{ name: 'نساء', slug: 'women' }, { name: 'رجال', slug: 'men' }]).returning()
    expect(await allocateProductCode(db, c1.id)).toBe('WOM-001')
    expect(await allocateProductCode(db, c1.id)).toBe('WOM-002')
    expect(await allocateProductCode(db, c2.id)).toBe('MEN-001')
    // deleting the latest product never frees its number
    expect(await allocateProductCode(db, c1.id)).toBe('WOM-003')
  })
  it('is race-free: parallel allocations are all distinct', async () => {
    const [c] = await db.insert(s.categories).values({ name: 'أحذية', slug: 'shoes' }).returning()
    const codes = await Promise.all(Array.from({ length: 12 }, () => db.transaction((tx) => allocateProductCode(tx, c.id))))
    expect(new Set(codes).size).toBe(12)
    expect((await db.select().from(s.categories).where(eq(s.categories.id, c.id)))[0].productSeq).toBe(12)
  })
  it('gives arabic-only slugs a fallback code and keeps existing codes stable', async () => {
    const [a, b] = await db.insert(s.categories).values([{ name: 'عطور', slug: 'عطور' }, { name: 'ساعات', slug: 'ساعات' }]).returning()
    const ca = await ensureCategoryCode(db, a.id)
    const cb = await ensureCategoryCode(db, b.id)
    expect(ca).not.toBe(cb)
    expect(await ensureCategoryCode(db, a.id)).toBe(ca)
  })
})
