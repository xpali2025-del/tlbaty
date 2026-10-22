import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import * as s from '@/lib/db/store'

const db = drizzle(new PGlite())

// Postgres wraps driver errors; the constraint text is on the error or its cause.
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  const err = await p.then(() => null, (e: unknown) => e as Error & { cause?: Error })
  expect(err, 'expected the statement to be rejected').not.toBeNull()
  expect(`${err!.message} ${err!.cause?.message ?? ''}`).toMatch(pattern)
}

let categoryId: string
let customerId: string
const baseProduct = (n: string) => ({
  productNumber: n, name: n, slug: n, categoryId, price: 100, description: 'وصف المنتج الطويل',
})
const baseOrder = (n: string) => ({
  orderNumber: n, customerName: 'ع', phone: '777', subtotal: 100, total: 100,
})

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  categoryId = (await db.insert(s.categories).values({ name: 'ملابس', slug: 'clothes' }).returning())[0].id
  customerId = (await db.insert(s.customers).values({ publicId: 'C1', phone: '967771' }).returning())[0].id
})

describe('catalog', () => {
  it('enforces product constraints', async () => {
    await rejects(db.insert(s.products).values({ ...baseProduct('a'), price: -1 }), /products_price_nonneg/)
    await rejects(db.insert(s.products).values({ ...baseProduct('b'), stock: -1 }), /products_stock_nonneg/)
    await rejects(db.insert(s.products).values({ ...baseProduct('c'), rating: 6 }), /products_rating_range/)
    await rejects(db.insert(s.products).values({ ...baseProduct('d'), categoryId: crypto.randomUUID() }), /foreign key|violates/)
    await db.insert(s.products).values(baseProduct('ok'))
    await rejects(db.insert(s.products).values({ ...baseProduct('ok2'), slug: 'ok' }), /unique|duplicate/)
  })

  it('validates colour hex and cascades product children', async () => {
    const [p] = await db.insert(s.products).values(baseProduct('p-colors')).returning()
    await rejects(db.insert(s.productColors).values({ productId: p.id, name: 'x', hex: 'red' }), /product_colors_hex_format/)
    await db.insert(s.productColors).values({ productId: p.id, name: 'أحمر', hex: '#FF0000' })
    await db.insert(s.productImages).values({ productId: p.id, imageKey: 'products/a.jpg' })
    await db.delete(s.products).where(eq(s.products.id, p.id))
    expect(await db.select().from(s.productColors).where(eq(s.productColors.productId, p.id))).toHaveLength(0)
    expect(await db.select().from(s.productImages).where(eq(s.productImages.productId, p.id))).toHaveLength(0)
  })

  it('blocks deleting a category that still has products', async () => {
    await rejects(db.delete(s.categories).where(eq(s.categories.id, categoryId)), /foreign key|violates/)
  })

  it('stores arrays and numeric values as JS types', async () => {
    const [p] = await db.insert(s.products).values({ ...baseProduct('typed'), price: 1234.5, sizes: ['S', 'M'], keywords: ['k'] }).returning()
    expect(p.price).toBe(1234.5)
    expect(p.sizes).toEqual(['S', 'M'])
    expect(p.keywords).toEqual(['k'])
  })
})

describe('marketing and settings', () => {
  it('treats coupon codes case-insensitively and caps percent at 100', async () => {
    await db.insert(s.coupons).values({ code: 'Eid10', discount: 10, type: 'percent', description: 'd' })
    await rejects(db.insert(s.coupons).values({ code: 'EID10', discount: 5, description: 'd' }), /coupons_code_lower_idx|unique|duplicate/)
    await rejects(db.insert(s.coupons).values({ code: 'big', discount: 150, type: 'percent', description: 'd' }), /coupons_percent_max/)
  })

  it('keeps site_settings a singleton and currency rates positive', async () => {
    await db.insert(s.siteSettings).values({ name: 'متجر' })
    await rejects(db.insert(s.siteSettings).values({ id: 2 }), /site_settings_singleton/)
    await rejects(db.insert(s.currencies).values({ code: 'USD', name: 'دولار', symbol: '$', rate: 0 }), /currencies_rate_positive/)
  })

  it('allows only one default shipping zone and one zone per governorate', async () => {
    await db.insert(s.shippingZones).values({ isDefault: true })
    await rejects(db.insert(s.shippingZones).values({ isDefault: true }), /one_default|unique|duplicate/)
    await db.insert(s.shippingZones).values({ governorate: 'صنعاء' })
    await rejects(db.insert(s.shippingZones).values({ governorate: 'صنعاء' }), /governorate_idx|unique|duplicate/)
    await rejects(db.insert(s.shippingZones).values({}), /shipping_zones_target/)
  })

  it('rejects review ratings outside 1-5', async () => {
    await rejects(db.insert(s.reviews).values({ name: 'a', rating: 0, comment: 'c', reviewDate: '2026-01-01' }), /reviews_rating_range/)
  })
})

describe('customers and auth', () => {
  it('requires unique phones and cascades sessions/history on delete, nulling audit events', async () => {
    await rejects(db.insert(s.customers).values({ publicId: 'C2', phone: '967771' }), /unique|duplicate/)
    const [c] = await db.insert(s.customers).values({ publicId: 'C3', phone: '967772' }).returning()
    await db.insert(s.customerSessions).values({ customerId: c.id, tokenHash: 'h1', expiresAt: new Date(Date.now() + 1e6) })
    await db.insert(s.customerPhoneHistory).values({ customerId: c.id, fromPhone: '1', toPhone: '2' })
    await db.insert(s.authEvents).values({ event: 'login', customerId: c.id, phone: '967772' })
    await db.delete(s.customers).where(eq(s.customers.id, c.id))
    expect(await db.select().from(s.customerSessions).where(eq(s.customerSessions.customerId, c.id))).toHaveLength(0)
    const [ev] = await db.select().from(s.authEvents).where(eq(s.authEvents.phone, '967772'))
    expect(ev.customerId).toBeNull()
  })

  it('rejects sessions that expire before they start and duplicate token hashes', async () => {
    const past = new Date(Date.now() - 1e6)
    await rejects(db.insert(s.customerSessions).values({ customerId, tokenHash: 'h2', expiresAt: past }), /customer_sessions_expiry_order/)
    await db.insert(s.customerSessions).values({ customerId, tokenHash: 'dup', expiresAt: new Date(Date.now() + 1e6) })
    await rejects(db.insert(s.customerSessions).values({ customerId, tokenHash: 'dup', expiresAt: new Date(Date.now() + 1e6) }), /unique|duplicate/)
  })

  it('rejects unknown OTP purposes and event types', async () => {
    await rejects(db.execute(sql`insert into store.otp_codes (phone, code_hash, salt, purpose, expires_at) values ('1','h','s','bogus', now())`), /invalid input value for enum/)
    await rejects(db.execute(sql`insert into store.auth_events (event) values ('bogus')`), /invalid input value for enum/)
  })
})

describe('orders', () => {
  it('stores an order with items, history and a 1:1 payment proof, and cascades them', async () => {
    const [p] = await db.insert(s.products).values(baseProduct('ordered')).returning()
    const [o] = await db.insert(s.orders).values({ ...baseOrder('ORD-1'), customerId, paymentMethod: 'manual_transfer', paymentStatus: 'pending_verification' }).returning()
    expect(o.status).toBe('new')
    await db.insert(s.orderItems).values({ orderId: o.id, productId: p.id, name: 'ordered', quantity: 2, price: 50 })
    await db.insert(s.orderStatusHistory).values({ orderId: o.id, toStatus: 'new' })
    await db.insert(s.orderPaymentStatusHistory).values({ orderId: o.id, status: 'pending_verification' })
    await db.insert(s.orderPaymentProofs).values({ orderId: o.id, objectKey: 'proofs/1.enc', iv: 'iv', authTag: 't', keyVersion: 'v1' })
    await rejects(db.insert(s.orderPaymentProofs).values({ orderId: o.id, objectKey: 'x', iv: 'iv', authTag: 't', keyVersion: 'v1' }), /unique|duplicate/)
    await db.delete(s.orders).where(eq(s.orders.id, o.id))
    expect(await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, o.id))).toHaveLength(0)
    expect(await db.select().from(s.orderPaymentProofs).where(eq(s.orderPaymentProofs.orderId, o.id))).toHaveLength(0)
  })

  it('keeps order history when a product, courier or customer is deleted', async () => {
    const [p] = await db.insert(s.products).values(baseProduct('gone')).returning()
    const [c] = await db.insert(s.couriers).values({ name: 'مندوب' }).returning()
    const [cu] = await db.insert(s.customers).values({ publicId: 'C9', phone: '967779' }).returning()
    const [o] = await db.insert(s.orders).values({ ...baseOrder('ORD-2'), customerId: cu.id, courierId: c.id }).returning()
    await db.insert(s.orderItems).values({ orderId: o.id, productId: p.id, name: 'gone', quantity: 1, price: 10 })
    await db.delete(s.products).where(eq(s.products.id, p.id))
    await db.delete(s.couriers).where(eq(s.couriers.id, c.id))
    await db.delete(s.customers).where(eq(s.customers.id, cu.id))
    const [after] = await db.select().from(s.orders).where(eq(s.orders.id, o.id))
    expect([after.courierId, after.customerId]).toEqual([null, null])
    const [item] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, o.id))
    expect(item.productId).toBeNull()
    expect(item.name).toBe('gone')
  })

  it('enforces order and item constraints', async () => {
    await rejects(db.insert(s.orders).values({ ...baseOrder('ORD-3'), total: -1 }), /orders_amounts_nonneg/)
    await rejects(db.insert(s.orders).values({ ...baseOrder('ORD-4'), latitude: 120 }), /orders_latitude_range/)
    const [o] = await db.insert(s.orders).values(baseOrder('ORD-5')).returning()
    await rejects(db.insert(s.orderItems).values({ orderId: o.id, name: 'x', quantity: 0, price: 1 }), /order_items_quantity_positive/)
    await rejects(db.insert(s.orders).values(baseOrder('ORD-5')), /unique|duplicate/)
  })

  it('rolls back a failed transaction completely', async () => {
    const before = (await db.select().from(s.orders)).length
    await rejects(
      db.transaction(async (tx) => {
        const [o] = await tx.insert(s.orders).values(baseOrder('ORD-TX')).returning()
        await tx.insert(s.orderItems).values({ orderId: o.id, name: 'bad', quantity: 0, price: 1 })
      }),
      /order_items_quantity_positive/,
    )
    expect((await db.select().from(s.orders)).length).toBe(before)
  })
})

describe('notifications', () => {
  it('records a read for exactly one reader and prevents duplicates', async () => {
    const [n] = await db.insert(s.notifications).values({ title: 'عرض', status: 'published', publishedAt: new Date() }).returning()
    await db.insert(s.notificationReads).values({ notificationId: n.id, deviceId: 'dev-1' })
    await rejects(db.insert(s.notificationReads).values({ notificationId: n.id, deviceId: 'dev-1' }), /unique|duplicate/)
    await db.insert(s.notificationReads).values({ notificationId: n.id, customerId })
    await rejects(db.insert(s.notificationReads).values({ notificationId: n.id, customerId }), /unique|duplicate/)
    await rejects(db.insert(s.notificationReads).values({ notificationId: n.id }), /notification_reads_one_reader/)
    await rejects(db.insert(s.notificationReads).values({ notificationId: n.id, customerId, deviceId: 'd2' }), /notification_reads_one_reader/)
    await db.delete(s.notifications).where(eq(s.notifications.id, n.id))
    expect(await db.select().from(s.notificationReads).where(eq(s.notificationReads.notificationId, n.id))).toHaveLength(0)
  })
})

describe('migration', () => {
  it('creates every table in the store schema and nothing in public', async () => {
    const r = await db.execute(sql`select table_schema, count(*)::int as n from information_schema.tables where table_schema in ('public','store') group by 1 order by 1`)
    const counts = Object.fromEntries((r.rows as { table_schema: string; n: number }[]).map((x) => [x.table_schema, x.n]))
    expect(counts.public ?? 0).toBe(0)
    expect(counts.store).toBe(38)
  })
})
