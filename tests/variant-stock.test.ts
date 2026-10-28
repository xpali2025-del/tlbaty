import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { availableFor, colorInStock, firstAvailable, isVariantTracked, lowStockMessage, normalizeVariantKey, sizeInStock } from '@/lib/variant-stock'
import { unwrapAll } from '@/lib/action-result'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: async () => {}, assertManageAuthenticated: async () => {}, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'مدير' }))
vi.mock('@/lib/storage/proofs', () => ({ newProofKey: () => 'k', putPaymentProof: async () => {}, deletePaymentProof: async () => {} }))

const { insertOrder, OutOfStockError } = await import('@/lib/orders/create')
const O = unwrapAll(await import('@/app/manage/orders-actions'))

const contact = { customerName: 'علي', phone: '0781234567', phoneNormalized: '967781234567', city: 'صنعاء', address: 'شارع', addressSource: 'new' as const, latitude: 15.3, longitude: 44.2, accuracy: 20, capturedAt: new Date(), note: '' }
const cod = { method: 'cash_on_delivery' as const, account: null, senderName: '', senderPhone: '', reference: '', proof: null }
let customerId: string
let productId: string

type Line = { color: string; size: string; quantity: number }
const pricingFor = (lines: Line[]) => {
  const currency = { code: 'YER', name: 'ريال', symbol: 'ر.ي', rate: 1 }
  const priced = lines.map((l) => ({ productId: 'VAR-001', name: 'قميص', sku: '', image: '', size: l.size, color: l.color, quantity: l.quantity, price: 100, lineTotal: 100 * l.quantity }))
  const subtotal = priced.reduce((a, l) => a + l.lineTotal, 0)
  return { ok: true as const, currency, lines: priced, shippingMethod: 'عادي', couponCode: '', shippingPrice: 0, discount: 0, subtotal, total: subtotal, base: { subtotal, shipping: 0, discount: 0, total: subtotal } }
}
const variants = async () => (await db.select().from(s.productVariants).where(eq(s.productVariants.productId, productId))).map((v) => `${v.color}|${v.size}|${v.stock}`).sort()
const productStock = async () => (await db.select().from(s.products).where(eq(s.products.id, productId)))[0].stock
const reset = async (rows: [string, string, number][]) => {
  await db.delete(s.productVariants).where(eq(s.productVariants.productId, productId))
  await db.insert(s.productVariants).values(rows.map(([color, size, stock]) => ({ productId, color, size, stock })))
  await db.update(s.products).set({ stock: rows.reduce((a, r) => a + r[2], 0) }).where(eq(s.products.id, productId))
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  const [cat] = await db.insert(s.categories).values({ name: 'ملابس', slug: 'clothes' }).returning()
  const [p] = await db.insert(s.products).values({ productNumber: 'VAR-001', name: 'قميص', slug: 'shirt', categoryId: cat.id, price: 100, description: 'وصف المنتج الطويل' }).returning()
  productId = p.id
  customerId = (await db.insert(s.customers).values({ publicId: 'CUS_V', phone: '967770000111' }).returning())[0].id
})
beforeEach(async () => { await reset([['أسود', 'M', 3], ['أسود', 'L', 0], ['أبيض', 'M', 5]]) })

describe('variant stock helpers', () => {
  const p = { stock: 8, variantStock: [{ color: 'أسود', size: 'M', stock: 3 }, { color: 'أسود', size: 'L', stock: 0 }, { color: 'أبيض', size: 'M', stock: 5 }], colors: [{ name: 'أسود' }, { name: 'أبيض' }], sizes: ['M', 'L'] }
  it('reads availability per colour and size', () => {
    expect(isVariantTracked(p)).toBe(true)
    expect(availableFor(p, 'أسود', 'M')).toBe(3)
    expect(availableFor(p, 'أسود', 'L')).toBe(0)
    expect(availableFor(p, 'أبيض', 'L')).toBe(0) // combination missing
    expect(sizeInStock(p, 'أسود', 'L')).toBe(false)
    expect(colorInStock(p, 'أبيض')).toBe(true)
    expect(firstAvailable({ ...p, variantStock: p.variantStock.map((v) => (v.color === 'أسود' ? { ...v, stock: 0 } : v)) }).color).toBe('أبيض')
  })
  it('falls back to the single stock when untracked and ignores unused dimensions', () => {
    expect(availableFor({ stock: 4 }, 'x', 'y')).toBe(4)
    expect(availableFor({ stock: -2 }, '', '')).toBe(0)
    const colorless = [{ color: '', size: 'M', stock: 2 }]
    expect(normalizeVariantKey(colorless, 'default', 'M')).toEqual({ color: '', size: 'M' })
    expect(availableFor({ stock: 2, variantStock: colorless }, 'default', 'M')).toBe(2)
  })
  it('low-stock wording', () => {
    expect(lowStockMessage(0)).toBe('نفد المخزون')
    expect(lowStockMessage(2)).toBe('متبقي 2 فقط')
    expect(lowStockMessage(9)).toBeNull()
  })
})

describe('orders against variant stock', () => {
  it('deducts only the ordered colour/size and mirrors the total on the product', async () => {
    await insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor([{ color: 'أسود', size: 'M', quantity: 2 }]), payment: cod })
    expect(await variants()).toEqual(['أبيض|M|5', 'أسود|L|0', 'أسود|M|1'])
    expect(await productStock()).toBe(6)
  })

  it('refuses an out-of-stock variant even though the product total has stock, and changes nothing', async () => {
    await expect(insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor([{ color: 'أسود', size: 'L', quantity: 1 }]), payment: cod })).rejects.toBeInstanceOf(OutOfStockError)
    await expect(insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor([{ color: 'أسود', size: 'M', quantity: 4 }]), payment: cod })).rejects.toBeInstanceOf(OutOfStockError)
    expect(await variants()).toEqual(['أبيض|M|5', 'أسود|L|0', 'أسود|M|3'])
    expect(await productStock()).toBe(8)
  })

  it('rolls back variants deducted earlier in the same order when a later line is short', async () => {
    const lines = [{ color: 'أبيض', size: 'M', quantity: 2 }, { color: 'أسود', size: 'M', quantity: 9 }]
    await expect(insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor(lines), payment: cod })).rejects.toBeInstanceOf(OutOfStockError)
    expect(await variants()).toEqual(['أبيض|M|5', 'أسود|L|0', 'أسود|M|3'])
  })

  it('rejects a colour/size combination that does not exist', async () => {
    await expect(insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor([{ color: 'أحمر', size: 'M', quantity: 1 }]), payment: cod })).rejects.toBeInstanceOf(OutOfStockError)
  })

  it('two parallel orders cannot oversell the last units of a variant', async () => {
    const results = await Promise.allSettled([1, 2, 3].map(() => insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor([{ color: 'أسود', size: 'M', quantity: 2 }]), payment: cod })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await variants()).toContain('أسود|M|1')
  })

  it('cancelling an order puts the units back into the same colour/size', async () => {
    const o = await insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor([{ color: 'أبيض', size: 'M', quantity: 4 }, { color: 'أسود', size: 'M', quantity: 1 }]), payment: cod })
    expect(await variants()).toEqual(['أبيض|M|1', 'أسود|L|0', 'أسود|M|2'])
    expect((await O.updateOrderStatus(o.id, 'cancelled')).ok).toBe(true)
    expect(await variants()).toEqual(['أبيض|M|5', 'أسود|L|0', 'أسود|M|3'])
    expect(await productStock()).toBe(8)
  })

  it('untracked products keep using the single stock', async () => {
    await db.delete(s.productVariants).where(eq(s.productVariants.productId, productId))
    await db.update(s.products).set({ stock: 3 }).where(eq(s.products.id, productId))
    await insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor([{ color: 'أي لون', size: 'S', quantity: 2 }]), payment: cod })
    expect(await productStock()).toBe(1)
    await expect(insertOrder({ customer: { id: customerId }, contact, pricing: pricingFor([{ color: 'x', size: 'S', quantity: 2 }]), payment: cod })).rejects.toBeInstanceOf(OutOfStockError)
  })
})
