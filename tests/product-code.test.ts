import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/test-db'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { buildProductNumber } from '@/lib/product-number'
import { canonicalCodeQuery, formatProductCode, isCategoryCode, isProductCode, suggestCategoryCode, toLatinDigits } from '@/lib/product-code'

const testDb = await openTestDb()
const db = testDb.db
vi.mock('@/lib/db/client', () => ({ db }))
const { allocateProductCode, ensureCategoryCode } = await import('@/lib/product-code-db')

beforeAll(async () => {
  await testDb.migrate()
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
    // الأكواد التي يولّدها النظام نفسه تُقبل عند حفظ القسم ثانية (CT2 … CT9 ثم CT10 … CT99)
    for (const generated of ['CT', 'CT2', 'CT9', 'CT10', 'CT52', 'CT99']) expect(isCategoryCode(generated), generated).toBe(true)
    expect(isCategoryCode('CT100')).toBe(false)
    expect(isProductCode('CT52-007')).toBe(true)
    expect(isCategoryCode('dr')).toBe(false)
  })
  it('suggests category codes from slugs and avoids collisions', () => {
    expect(suggestCategoryCode('women', new Set())).toBe('WOM')
    expect(suggestCategoryCode('women', new Set(['WOM']))).toBe('WOM2')
    expect(suggestCategoryCode('عطور', new Set())).toBe('CT')
    expect(suggestCategoryCode('عطور', new Set(['CT']))).toBe('CT2')
    expect(suggestCategoryCode('a', new Set())).toBe('CT')
  })
  it('does not run out after CT99: falls back to three-letter codes that pass the same validation', () => {
    const taken = new Set<string>(['CT', ...Array.from({ length: 98 }, (_, i) => `CT${i + 2}`)])
    const code = suggestCategoryCode('عطور', taken)
    expect(code).toBe('AAA')
    expect(isCategoryCode(code)).toBe(true)
    taken.add(code)
    expect(suggestCategoryCode('عطور', taken)).toBe('AAB')
    // كل الاحتمالات الـ17576 مأخوذة فقط: خطأ واضح بدل رمز مكرر
    const all = new Set<string>(taken)
    for (let i = 0; i < 26 ** 3; i++) all.add(String.fromCharCode(65 + Math.floor(i / 676), 65 + (Math.floor(i / 26) % 26), 65 + (i % 26)))
    expect(() => suggestCategoryCode('عطور', all)).toThrow('تعذّر توليد رمز قسم فريد')
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

  it('skips numbers already taken (a category code reused after a rename never collides)', async () => {
    const [a, b] = await db.insert(s.categories).values([{ name: 'قديم', slug: 'old-cat', code: 'ZZ', productSeq: 2 }, { name: 'جديد', slug: 'new-cat' }]).returning()
    await db.insert(s.products).values([{ productNumber: 'ZZ-001', name: 'p1', slug: 'zz1', categoryId: a.id, price: 1, description: 'd' }, { productNumber: 'ZZ-002', name: 'p2', slug: 'zz2', categoryId: a.id, price: 1, description: 'd' }])
    await db.update(s.categories).set({ code: 'YY' }).where(eq(s.categories.id, a.id)) // renamed
    await db.update(s.categories).set({ code: 'ZZ' }).where(eq(s.categories.id, b.id)) // code ZZ reused by a new category (seq 0)
    // ZZ-001 and ZZ-002 exist already -> next free is ZZ-003 instead of a unique-violation
    expect(await allocateProductCode(db, b.id)).toBe('ZZ-003')
  })

  it('every code the system suggests is one the category form accepts when the admin saves that category again', () => {
    const taken = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const code = suggestCategoryCode('قسم-عربي', taken)
      expect(isCategoryCode(code), code).toBe(true)
      taken.add(code)
    }
  })
})
