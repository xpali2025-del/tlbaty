import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { count, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
process.env.PAYMENT_PROOF_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
Object.assign(process.env, { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_PROOFS_BUCKET: 'proofs' })

const db = drizzle(new PGlite())
const m = vi.hoisted(() => ({
  customer: null as null | { id: string; publicId: string; phone: string },
  put: vi.fn(async (_k: string, _b: Buffer) => {}),
}))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/otp/session', () => ({ getCurrentCustomer: async () => m.customer }))
vi.mock('@/lib/storage/proofs', () => ({
  newProofKey: (id: string) => `payment-proofs/${id}/22222222-2222-4222-8222-222222222222.enc`,
  putPaymentProof: m.put,
  deletePaymentProof: vi.fn(async () => {}),
}))

const route = await import('@/app/api/orders/route')
const seed = loadSeedData(path.resolve(__dirname, '../scripts/migration/data'))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

let accountId: string
const product = seed.products[0] // gp150, price 59

const order = (over: Record<string, unknown> = {}) => ({
  customerName: 'علي محمد', phone: '0781234567', city: 'صنعاء', address: 'شارع الرقاص', addressSource: 'new',
  latitude: 15.35, longitude: 44.2, locationAccuracy: 25, locationCapturedAt: '2026-10-21T10:00:00Z',
  items: [{ productId: product.id, size: 'M', color: 'أسود', quantity: 2, price: 59, name: 'x' }],
  shippingMethod: 'شحن عادي', shippingPrice: 500, couponCode: '', discount: 0, subtotal: 118, total: 618,
  currency: 'ر.ي', currencyCode: 'YER', paymentMethod: 'cash_on_delivery', customerNote: '', ...over,
})
const post = (body: unknown) => route.POST(new Request('http://x/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const postForm = (body: unknown, proof?: File) => {
  const f = new FormData()
  f.set('order', JSON.stringify(body))
  if (proof) f.set('paymentProof', proof)
  return route.POST(new Request('http://x/api/orders', { method: 'POST', body: f }))
}
const stored = async (id: string) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0]
const orderCount = async () => (await db.select({ n: count() }).from(s.orders))[0].n

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  await importCatalog(db, seed, { resolveImage: async (p) => p })
  const [c] = await db.insert(s.customers).values({ publicId: 'CUS_RT', phone: '967781234567' }).returning()
  m.customer = { id: c.id, publicId: c.publicId, phone: c.phone }
  await db.insert(s.currencies).values([{ code: 'YER', name: 'ريال', symbol: 'ر.ي', rate: 1 }, { code: 'USD', name: 'دولار', symbol: '$', rate: 0.5 }])
  await db.insert(s.siteSettings).values({ defaultCurrency: 'YER' })
  await db.insert(s.coupons).values({ code: 'SAVE10', discount: 10, type: 'percent', minOrder: 0, description: 'd' })
  accountId = (await db.insert(s.paymentAccounts).values({ providerName: 'جيب', accountHolderName: 'متجر', accountNumber: '777000' }).returning())[0].id
})
beforeEach(async () => { vi.clearAllMocks(); await db.update(s.products).set({ stock: 1000 }) })
afterEach(() => { m.customer = m.customer && { ...m.customer } })

describe('authentication and validation', () => {
  it('requires a signed-in customer', async () => {
    const saved = m.customer
    m.customer = null
    const res = await post(order())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('AUTH_REQUIRED')
    m.customer = saved
  })

  it.each([
    ['empty order', { items: [] }, 'EMPTY_ORDER'],
    ['missing address', { address: '' }, 'ADDRESS_REQUIRED'],
    ['invalid phone', { phone: '12345' }, 'INVALID_PHONE'],
    ['unsupported country', { phone: '+971501234567' }, 'INVALID_PHONE'],
    ['bad address source', { addressSource: 'x' }, 'INVALID_ADDRESS_SOURCE'],
    ['no location', { latitude: null }, 'LOCATION_REQUIRED'],
    ['null island', { latitude: 0, longitude: 0 }, 'INVALID_LOCATION'],
    ['out of range', { latitude: 91 }, 'INVALID_LOCATION'],
    ['no accuracy', { locationAccuracy: undefined }, 'INVALID_LOCATION'],
    ['unknown product', { items: [{ productId: 'ghost', quantity: 1 }] }, 'PRODUCT_UNAVAILABLE'],
    ['bad shipping method', { shippingMethod: 'طائرة خاصة' }, 'INVALID_SHIPPING_METHOD'],
    ['absurd quantity', { items: [{ productId: product.id, quantity: 5000 }] }, 'INVALID_QUANTITY'],
  ])('rejects %s', async (_name, over, error) => {
    const before = await orderCount()
    const res = await post(order(over))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(error)
    expect(await orderCount()).toBe(before)
  })

  it('rejects malformed bodies', async () => {
    expect((await route.POST(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'nope' }))).status).toBe(400)
    const f = new FormData()
    f.set('order', '[1,2')
    expect((await route.POST(new Request('http://x', { method: 'POST', body: f }))).status).toBe(400)
  })
})

describe('payment methods enabled from the panel', () => {
  it('refuses a disabled method on the server even if the browser sends it', async () => {
    await db.update(s.siteSettings).set({ codEnabled: false })
    const res = await post(order())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('PAYMENT_METHOD_DISABLED')
    await db.update(s.siteSettings).set({ codEnabled: true })
    expect((await post(order())).status).toBe(200)
  })
})

describe('idempotent submission (retry after a dropped connection or re-login)', () => {
  const key = (n: string) => `checkout-key-${n}-0123456789`
  const stockNow = async () => (await db.select().from(s.products).where(eq(s.products.productNumber, product.id)))[0].stock

  it('returns the same order for the same key and deducts stock only once', async () => {
    const before = await stockNow()
    const first = await (await post(order({ clientOrderKey: key('a') }))).json()
    const second = await (await post(order({ clientOrderKey: key('a') }))).json()
    expect(first.ok && second.ok).toBe(true)
    expect(second).toMatchObject({ duplicate: true, id: first.id, orderNumber: first.orderNumber })
    expect(await stockNow()).toBe(before - 2) // quantity 2, once
    expect((await db.select().from(s.orders).where(eq(s.orders.idempotencyKey, key('a')))).length).toBe(1)
  })

  it('a different key (or no key) is a new order', async () => {
    const a = await (await post(order({ clientOrderKey: key('b1') }))).json()
    const b = await (await post(order({ clientOrderKey: key('b2') }))).json()
    const c = await (await post(order())).json()
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
  })

  it('ignores malformed keys instead of failing', async () => {
    expect((await post(order({ clientOrderKey: 'short' }))).status).toBe(200)
    expect((await post(order({ clientOrderKey: { a: 1 } }))).status).toBe(200)
  })

  it('two simultaneous submissions with one key create exactly one order', async () => {
    const before = await stockNow()
    const [r1, r2] = await Promise.all([post(order({ clientOrderKey: key('race') })), post(order({ clientOrderKey: key('race') }))])
    const [d1, d2] = [await r1.json(), await r2.json()]
    expect(d1.ok && d2.ok).toBe(true)
    expect(d1.id).toBe(d2.id)
    expect(await stockNow()).toBe(before - 2)
  })
})

describe('payment method validation', () => {
  it('rejects an unknown payment method instead of treating it as cash on delivery', async () => {
    const res = await post(order({ paymentMethod: 'bitcoin' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('INVALID_PAYMENT_METHOD')
  })
})

describe('stock', () => {
  it('answers 409 OUT_OF_STOCK and stores nothing when the quantity is not available', async () => {
    await db.update(s.products).set({ stock: 1 }).where(eq(s.products.productNumber, product.id))
    const before = (await db.select().from(s.orders)).length
    const res = await post(order({ items: [{ productId: product.id, size: 'M', color: 'أسود', quantity: 2, price: 59, name: product.name }] }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('OUT_OF_STOCK')
    expect((await db.select().from(s.orders)).length).toBe(before)
  })

  it('decrements stock after a successful order', async () => {
    const res = await post(order())
    expect(res.status).toBe(200)
    const [p] = await db.select().from(s.products).where(eq(s.products.productNumber, product.id))
    expect(p.stock).toBe(998)
  })
})

describe('server-side pricing (price tampering)', () => {
  it('stores the real price even if the browser sends a tiny price and total', async () => {
    const res = await post(order({ items: [{ productId: product.id, size: 'M', color: 'أسود', quantity: 2, price: 1, name: 'مجاني' }], shippingPrice: 0, subtotal: 2, total: 2 }))
    const data = await res.json()
    expect(res.status).toBe(200)
    const o = await stored(data.id)
    expect([o.subtotal, o.shippingPrice, o.total]).toEqual([118, 500, 618])
    const [item] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, data.id))
    expect(item).toMatchObject({ price: 59, name: product.name, quantity: 2 }) // name comes from the catalog, not the browser
    expect(data).toMatchObject({ total: 618, currencyCode: 'YER', priceChanged: true })
  })

  it('reports priceChanged=false when the browser computed the same numbers', async () => {
    const data = await (await post(order())).json()
    expect(data.priceChanged).toBe(false)
    expect(data.total).toBe(618)
  })

  it('applies a valid coupon on the server and ignores a coupon the browser claims but is invalid', async () => {
    const withCoupon = await (await post(order({ couponCode: 'save10', discount: 0, total: 618 }))).json()
    expect(await stored(withCoupon.id)).toMatchObject({ couponCode: 'SAVE10', discount: 12, total: 606 }) // 10% of 118 = 11.8 -> 12 ; 118+500-12
    expect(withCoupon.priceChanged).toBe(true)
    const fake = await (await post(order({ couponCode: 'FREE100', discount: 999, total: 0 }))).json()
    expect(await stored(fake.id)).toMatchObject({ couponCode: null, discount: 0, total: 618 })
  })

  it('converts to the selected currency like the storefront and falls back for unknown codes', async () => {
    const usd = await (await post(order({ currencyCode: 'USD', currency: '$' }))).json()
    // rate 0.5 => each number doubled: unit 118, subtotal 236, shipping 1000, total 1236
    expect(await stored(usd.id)).toMatchObject({ currencyCode: 'USD', currencySymbol: '$', subtotal: 236, shippingPrice: 1000, total: 1236 })
    const unknown = await (await post(order({ currencyCode: 'ZZZ', currency: 'fake' }))).json()
    expect(await stored(unknown.id)).toMatchObject({ currencyCode: 'YER', currencySymbol: 'ر.ي' })
  })

  it('ties the order to the signed-in customer and normalises the phone internationally', async () => {
    const data = await (await post(order({ customerId: 'CUS_SOMEONE_ELSE', phone: '٠٥١٢٣٤٥٦٧٨' }))).json()
    const o = await stored(data.id)
    expect(o.customerId).toBe(m.customer!.id)
    expect(o).toMatchObject({ customerPhoneNormalized: '966512345678', phone: '٠٥١٢٣٤٥٦٧٨', status: 'new' })
  })

  it('sanitises the customer note', async () => {
    const data = await (await post(order({ customerNote: '  <b>مرحبا</b>\n\n\n\nشكرا  ' }))).json()
    expect((await stored(data.id)).customerNote).toBe('مرحبا \n\nشكرا')
  })
})

describe('manual transfer', () => {
  const transfer = (over: Record<string, unknown> = {}) => order({ paymentMethod: 'manual_transfer', paymentAccountId: accountId, transferSenderName: 'محمد أحمد علي', transferSenderPhone: '0771234567', transferReference: 'TR-4455', ...over })
  const png = () => new File([PNG], 'proof.png', { type: 'image/png' })

  it('requires an available account, valid sender name and transfer reference (the proof image is optional)', async () => {
    const e = async (over: Record<string, unknown>, proof?: File) => (await (await postForm(transfer(over), proof)).json()).error
    expect(await e({ paymentAccountId: '' }, png())).toBe('PAYMENT_ACCOUNT_REQUIRED')
    expect(await e({ paymentAccountId: '00000000-0000-4000-8000-000000000000' }, png())).toBe('PAYMENT_ACCOUNT_UNAVAILABLE')
    expect(await e({ transferSenderName: 'x' }, png())).toBe('INVALID_TRANSFER_SENDER')
    expect(await e({ transferReference: '12' }, png())).toBe('INVALID_TRANSFER_REFERENCE')
    expect(await e({ transferSenderName: '' })).toBe('INVALID_TRANSFER_SENDER')
    expect(await e({ transferSenderPhone: '' })).toBe('INVALID_TRANSFER_SENDER_PHONE')
    expect(await e({ transferSenderPhone: '12ab' })).toBe('INVALID_TRANSFER_SENDER_PHONE')
    expect(await e({ transferSenderPhone: '123' })).toBe('INVALID_TRANSFER_SENDER_PHONE')
    expect(await e({ transferSenderPhone: undefined })).toBe('INVALID_TRANSFER_SENDER_PHONE')
    expect(await e({ transferReference: '' })).toBe('INVALID_TRANSFER_REFERENCE')
    expect(await e({}, new File([Buffer.from('not an image at all, just text')], 'x.png', { type: 'image/png' }))).toBe('INVALID_PAYMENT_PROOF')
    expect(m.put).not.toHaveBeenCalled()
  })

  it('accepts a transfer with no proof image: nothing is uploaded, the order waits for manual verification', async () => {
    const res = await postForm(transfer({ transferReference: 'NOIMG-1234' }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.payment).toMatchObject({ method: 'manual_transfer', status: 'pending_verification', transferReference: 'NOIMG-1234' })
    expect(m.put).not.toHaveBeenCalled()
    expect(await db.select().from(s.orderPaymentProofs).where(eq(s.orderPaymentProofs.orderId, data.id))).toHaveLength(0)
    expect(await stored(data.id)).toMatchObject({ transferSenderName: 'محمد أحمد علي', transferSenderPhone: '967771234567', transferReference: 'NOIMG-1234' })
    expect(data.payment.transferSenderPhone).toBe('967771234567') // 0771234567 -> international
  })

  it('accepts arabic digits, other wallet numbers, and stores digits only', async () => {
    const arabic = await (await postForm(transfer({ transferReference: 'AR-1111', transferSenderPhone: '٠٧٧١٢٣٤٥٦٧' }))).json()
    expect((await stored(arabic.id)).transferSenderPhone).toBe('967771234567')
    const saudi = await (await postForm(transfer({ transferReference: 'SA-2222', transferSenderPhone: '+966 50 123 4567' }))).json()
    expect((await stored(saudi.id)).transferSenderPhone).toBe('966501234567')
    const other = await (await postForm(transfer({ transferReference: 'OT-3333', transferSenderPhone: '+44 7700 900123' }))).json()
    expect((await stored(other.id)).transferSenderPhone).toBe('447700900123')
  })

  it('a transfer without an image still works when proof storage is not configured; only attaching an image needs it', async () => {
    const saved = process.env.R2_PROOFS_BUCKET
    delete process.env.R2_PROOFS_BUCKET
    expect((await postForm(transfer({ transferReference: 'NOIMG-5678' }))).status).toBe(200)
    expect((await postForm(transfer({ transferReference: 'WITHIMG-5678' }), png())).status).toBe(503)
    process.env.R2_PROOFS_BUCKET = saved
  })

  it('stores the account snapshot from the server and uploads only the encrypted proof', async () => {
    const res = await postForm(transfer({ paymentAccountSnapshot: { accountNumber: 'attacker-account' } }), png())
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.payment).toMatchObject({ method: 'manual_transfer', status: 'pending_verification', providerName: 'جيب', transferReference: 'TR-4455' })
    const o = await stored(data.id)
    expect(o.paymentAccountSnapshot).toMatchObject({ providerName: 'جيب', accountNumber: '777000', sourceDocumentId: accountId })
    expect(o.duplicateTransferReference).toBe(false)

    const [key, body] = m.put.mock.calls[0]
    expect(key).toBe(`payment-proofs/${data.id}/22222222-2222-4222-8222-222222222222.enc`)
    expect(body.includes(PNG)).toBe(false) // ciphertext, not the raw image
    const [row] = await db.select().from(s.orderPaymentProofs).where(eq(s.orderPaymentProofs.orderId, data.id))
    expect(row).toMatchObject({ keyVersion: '1', objectKey: key })
    expect(row.iv).toBeTruthy()
    expect(row.authTag).toBeTruthy()
  })

  it('round-trips: the stored proof decrypts back to an image', async () => {
    const data = await (await postForm(transfer({ transferReference: 'TR-7788' }), png())).json()
    const [row] = await db.select().from(s.orderPaymentProofs).where(eq(s.orderPaymentProofs.orderId, data.id))
    const { decryptPaymentProof } = await import('@/lib/payment-proof')
    const stored = m.put.mock.calls.find((c) => c[0] === row.objectKey)![1]
    const plain = decryptPaymentProof({ ciphertext: stored, iv: row.iv, authTag: row.authTag, keyVersion: row.keyVersion })
    expect(plain.subarray(0, 4).toString('ascii')).toMatch(/RIFF|\x89PNG/) // sharp -> webp, or the original png
  })

  it('flags a reused transfer reference on the second order', async () => {
    await postForm(transfer({ transferReference: 'DUP-9001' }), png())
    const second = await (await postForm(transfer({ transferReference: 'DUP-9001' }), png())).json()
    expect((await stored(second.id)).duplicateTransferReference).toBe(true)
  })

  it('refuses transfers when proof storage is not configured, and writes nothing', async () => {
    const saved = process.env.R2_PROOFS_BUCKET
    delete process.env.R2_PROOFS_BUCKET
    const before = await orderCount()
    const res = await postForm(transfer({ transferReference: 'NOCFG-1234' }), png())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('PAYMENT_PROOF_NOT_CONFIGURED')
    expect(await orderCount()).toBe(before)
    process.env.R2_PROOFS_BUCKET = saved
  })

  it('refuses transfers when the encryption key is missing', async () => {
    const saved = process.env.PAYMENT_PROOF_ENCRYPTION_KEY
    delete process.env.PAYMENT_PROOF_ENCRYPTION_KEY
    const res = await postForm(transfer({ transferReference: 'NOKEY-1234' }), png())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('PAYMENT_PROOF_NOT_CONFIGURED')
    process.env.PAYMENT_PROOF_ENCRYPTION_KEY = saved
  })

  it('reports a proof storage failure without creating the order', async () => {
    m.put.mockRejectedValueOnce(new Error('R2 down'))
    const before = await orderCount()
    const res = await postForm(transfer({ transferReference: 'FAIL-1234' }), png())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('PAYMENT_PROOF_FAILED')
    expect(await orderCount()).toBe(before)
  })
})

describe('without a database', () => {
  it('skips cash-on-delivery orders and refuses transfers', async () => {
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    const cod = await (await post(order())).json()
    expect(cod).toMatchObject({ ok: true, skipped: true })
    const tr = await postForm(order({ paymentMethod: 'manual_transfer', paymentAccountId: accountId, transferSenderName: 'محمد أحمد علي', transferReference: 'TR-1111' }), new File([PNG], 'p.png', { type: 'image/png' }))
    expect(tr.status).toBe(400) // no account without a database -> rejected before anything is stored
    process.env.DATABASE_URL = saved
  })
})
