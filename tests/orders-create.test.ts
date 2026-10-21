import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { count, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'

const db = drizzle(new PGlite())
const proofs = vi.hoisted(() => ({
  put: vi.fn(async (_key: string, _body: Buffer) => {}),
  del: vi.fn(async (_key: string | null | undefined) => {}),
}))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('@/lib/storage/proofs', () => ({
  newProofKey: (orderId: string) => `payment-proofs/${orderId}/11111111-1111-4111-8111-111111111111.enc`,
  putPaymentProof: proofs.put,
  deletePaymentProof: proofs.del,
}))

const { insertOrder, loadPricingProducts, ProofStorageError } = await import('@/lib/orders/create')
const { computeOrderPricing } = await import('@/lib/orders/pricing')

const seed = loadSeedData(path.resolve(__dirname, '../scripts/migration/data'))
let customerId: string

const price = async (productIds: string[], over: { method?: string; code?: string } = {}) => {
  const map = await loadPricingProducts(productIds)
  const r = computeOrderPricing({
    items: productIds.map((productId) => ({ productId, size: 'M', color: 'أسود', quantity: 2 })),
    products: map, zones: [], city: 'صنعاء', shippingMethodName: over.method ?? 'شحن عادي', coupons: [], couponCode: over.code ?? '',
    currencies: [{ code: 'YER', name: 'ريال', symbol: 'ر.ي', rate: 1 }], defaultCurrencyCode: 'YER', currencyCode: 'YER',
  })
  if (!r.ok) throw new Error(r.error)
  return r
}
const contact = { customerName: 'علي', phone: '0781234567', phoneNormalized: '967781234567', city: 'صنعاء', address: 'شارع الرقاص', addressSource: 'new' as const, latitude: 15.3, longitude: 44.2, accuracy: 20, capturedAt: new Date('2026-10-21T10:00:00Z'), note: '' }
const cod = { method: 'cash_on_delivery' as const, account: null, senderName: '', reference: '', proof: null }
const proof = { ciphertext: Buffer.from('cipher'), iv: 'aXY=', authTag: 'dGFn', keyVersion: '1', originalMimeType: 'image/png' as const, processedMimeType: 'image/webp', byteSize: 6 }

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  await importCatalog(db, seed, { resolveImage: async (p) => p })
  customerId = (await db.insert(s.customers).values({ publicId: 'CUS_ORD', phone: '967781234567' }).returning())[0].id
})
beforeEach(() => vi.clearAllMocks())

describe('loadPricingProducts', () => {
  it('reads current prices straight from the database by product id', async () => {
    const map = await loadPricingProducts(['gp150', 'nope'])
    expect([...map.keys()]).toEqual(['gp150'])
    expect(map.get('gp150')).toMatchObject({ name: 'عقد ذهبي', price: 59, sku: 'gp150', image: '/products/accessory-1.jpg' })
    expect((await loadPricingProducts([])).size).toBe(0)
  })
})

describe('insertOrder', () => {
  it('stores the order, numbered lines linked to live products, and the initial payment history', async () => {
    const [a, b] = seed.products.slice(0, 2)
    const pricing = await price([a.id, b.id], { method: 'شحن عادي' })
    const created = await insertOrder({ customer: { id: customerId }, contact, pricing, payment: cod })
    expect(created.orderNumber).toMatch(/^ORD-\d{8}-[0-9A-F]{8}$/)
    expect(created.paymentStatus).toBe('pending_on_delivery')

    const [o] = await db.select().from(s.orders).where(eq(s.orders.id, created.id))
    expect(o).toMatchObject({ status: 'new', customerId, customerPhoneNormalized: '967781234567', phone: '0781234567', shippingMethod: 'شحن عادي', shippingPrice: 500, discount: 0, currencyCode: 'YER', currencySymbol: 'ر.ي', addressSource: 'عنوان جديد', paymentMethod: 'cash_on_delivery', duplicateTransferReference: false, latitude: 15.3 })
    expect(o.subtotal).toBe(pricing.subtotal)
    expect(o.total).toBe(pricing.total)

    const items = (await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, created.id))).sort((x, y) => x.position - y.position)
    expect(items.map((i) => [i.productRef, i.position, i.quantity])).toEqual([[a.id, 0, 2], [b.id, 1, 2]])
    expect(items[0].productNumber).toMatch(/^TJ-[A-Z0-9]+$/)
    expect(items.every((i) => i.productId !== null)).toBe(true)

    const history = await db.select().from(s.orderPaymentStatusHistory).where(eq(s.orderPaymentStatusHistory.orderId, created.id))
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ status: 'pending_on_delivery', changedBy: 'النظام' })
    expect(proofs.put).not.toHaveBeenCalled()
  })

  it('links only the ordered products, never other orders\' lines', async () => {
    const a = seed.products[3]
    const first = await insertOrder({ customer: { id: customerId }, contact, pricing: await price([a.id]), payment: cod })
    const second = await insertOrder({ customer: { id: customerId }, contact, pricing: await price([a.id]), payment: cod })
    expect(first.id).not.toBe(second.id)
    for (const id of [first.id, second.id]) {
      expect(await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id))).toHaveLength(1)
    }
  })

  it('keeps the order readable after the product is deleted (snapshot + product_ref)', async () => {
    const [p] = await db.insert(s.products).values({ productNumber: 'TMP-1', name: 'مؤقت', slug: 'tmp-1', categoryId: (await db.select().from(s.categories))[0].id, price: 300, description: 'd' }).returning()
    const created = await insertOrder({ customer: { id: customerId }, contact, pricing: await price(['TMP-1']), payment: cod })
    await db.delete(s.products).where(eq(s.products.id, p.id))
    const [item] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, created.id))
    expect(item).toMatchObject({ productId: null, productRef: 'TMP-1', name: 'مؤقت', price: 300 })
  })

  it('stores a manual transfer with its encrypted proof, flags duplicate references, and uploads the proof first', async () => {
    const pricing = await price([seed.products[5].id])
    const transfer = { method: 'manual_transfer' as const, account: { providerName: 'جيب', accountNumber: '777', accountHolderName: 'م' }, senderName: 'محمد أحمد', reference: 'REF-12345', proof }
    const one = await insertOrder({ customer: { id: customerId }, contact, pricing, payment: transfer })
    expect(one.paymentStatus).toBe('pending_verification')
    expect(proofs.put).toHaveBeenCalledTimes(1)
    const [putKey, putBody] = proofs.put.mock.calls[0]
    expect(putKey).toBe(`payment-proofs/${one.id}/11111111-1111-4111-8111-111111111111.enc`)
    expect(putBody.toString()).toBe('cipher')

    const [o1] = await db.select().from(s.orders).where(eq(s.orders.id, one.id))
    expect(o1).toMatchObject({ transferSenderName: 'محمد أحمد', transferReference: 'REF-12345', duplicateTransferReference: false, paymentAccountSnapshot: transfer.account })
    const [row] = await db.select().from(s.orderPaymentProofs).where(eq(s.orderPaymentProofs.orderId, one.id))
    expect(row).toMatchObject({ objectKey: putKey, iv: 'aXY=', authTag: 'dGFn', keyVersion: '1', byteSize: 6 })

    const two = await insertOrder({ customer: { id: customerId }, contact, pricing, payment: transfer })
    const [o2] = await db.select().from(s.orders).where(eq(s.orders.id, two.id))
    expect(o2.duplicateTransferReference).toBe(true)
  })

  it('aborts cleanly when the proof upload fails (no order is written)', async () => {
    proofs.put.mockRejectedValueOnce(new Error('R2 down'))
    const before = (await db.select({ n: count() }).from(s.orders))[0].n
    const transfer = { method: 'manual_transfer' as const, account: {}, senderName: 'محمد أحمد', reference: 'REF-99999', proof }
    await expect(insertOrder({ customer: { id: customerId }, contact, pricing: await price([seed.products[6].id]), payment: transfer })).rejects.toBeInstanceOf(ProofStorageError)
    expect((await db.select({ n: count() }).from(s.orders))[0].n).toBe(before)
  })

  it('removes the uploaded proof when the database write fails', async () => {
    const before = (await db.select({ n: count() }).from(s.orders))[0].n
    const bad = { ...(await price([seed.products[7].id])), subtotal: -5, total: -5 } // violates orders_amounts_nonneg
    const transfer = { method: 'manual_transfer' as const, account: {}, senderName: 'محمد أحمد', reference: 'REF-77777', proof }
    await expect(insertOrder({ customer: { id: customerId }, contact, pricing: bad, payment: transfer })).rejects.toThrow()
    expect(proofs.put).toHaveBeenCalledTimes(1)
    expect(proofs.del).toHaveBeenCalledWith(proofs.put.mock.calls[0][0])
    expect((await db.select({ n: count() }).from(s.orders))[0].n).toBe(before)
    expect(await db.select().from(s.orderPaymentProofs).where(eq(s.orderPaymentProofs.keyVersion, 'x'))).toHaveLength(0)
  })

  it('rolls everything back if a line cannot be stored', async () => {
    const before = [(await db.select({ n: count() }).from(s.orders))[0].n, (await db.select({ n: count() }).from(s.orderItems))[0].n]
    const pricing = await price([seed.products[8].id])
    pricing.lines[0].quantity = 0 // violates order_items_quantity_positive
    await expect(insertOrder({ customer: { id: customerId }, contact, pricing, payment: cod })).rejects.toThrow()
    expect([(await db.select({ n: count() }).from(s.orders))[0].n, (await db.select({ n: count() }).from(s.orderItems))[0].n]).toEqual(before)
  })
})
