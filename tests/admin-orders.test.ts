import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))

const { getAdminOrdersPage, getAdminOrderStats, EMPTY_ORDER_STATS } = await import('@/lib/admin-orders')
const { getAdminCouriers } = await import('@/lib/admin-couriers')

let c1: typeof s.customers.$inferSelect
let courierA: typeof s.couriers.$inferSelect
let courierB: typeof s.couriers.$inferSelect
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12))

async function mk(over: Partial<typeof s.orders.$inferInsert> & { orderNumber: string }, items: { name: string; sku?: string; ref?: string; num?: string; price?: number; qty?: number }[] = [{ name: 'منتج' }]) {
  const [o] = await db.insert(s.orders).values({ customerName: 'عميل', phone: '777', subtotal: 100, total: 100, createdAt: day(1), ...over }).returning()
  await db.insert(s.orderItems).values(items.map((i, position) => ({ orderId: o.id, position, name: i.name, sku: i.sku ?? null, productRef: i.ref ?? null, productNumber: i.num ?? null, quantity: i.qty ?? 1, price: i.price ?? 10 })))
  return o
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  c1 = (await db.insert(s.customers).values({ publicId: 'CUS_ONE', phone: '967781111111' }).returning())[0]
  const cs = await db.insert(s.couriers).values([{ name: 'أحمد المندوب', phone: '700' }, { name: 'بدر', status: 'suspended' }]).returning()
  ;[courierA, courierB] = cs

  await mk({ orderNumber: 'ORD-A', status: 'new', city: 'صنعاء', total: 300, createdAt: day(1), customerId: c1.id, customerName: 'سالم علي', phone: '0781234567' },
    [{ name: 'قميص أزرق', sku: 'SKU-BLUE', ref: 'gp150', num: 'TJ-GP150', price: 100, qty: 2 }, { name: 'حقيبة', price: 100 }])
  await mk({ orderNumber: 'ORD-B', status: 'delivered', city: 'عدن', total: 100, createdAt: day(5), deliveredAt: day(6), courierId: courierA.id,
    courierSnapshot: { courierId: courierA.id, name: 'أحمد المندوب', phone: '700' }, paymentMethod: 'manual_transfer', paymentStatus: 'verified', transferReference: 'TRF-5566' })
  await mk({ orderNumber: 'ORD-C', status: 'on_the_way', city: 'صنعاء', total: 500, createdAt: day(10), customerName: 'ضيف 100%',
    courierSnapshot: { courierId: '00000000-0000-4000-8000-0000000000aa', name: 'مندوب محذوف' } }) // courier deleted: only the snapshot remains
  await mk({ orderNumber: 'ORD-D', status: 'cancelled', city: 'تعز', total: 200, createdAt: day(15), customerId: c1.id })

  const [a] = await db.select().from(s.orders).where((await import('drizzle-orm')).eq(s.orders.orderNumber, 'ORD-A'))
  await db.insert(s.orderStatusHistory).values([
    { orderId: a.id, fromStatus: null, toStatus: 'new', changedAt: day(1) },
    { orderId: a.id, fromStatus: 'new', toStatus: 'confirmed', changedAt: day(2), changedBy: 'مدير', note: 'تم الاتصال' },
  ])
  await db.insert(s.orderPaymentStatusHistory).values({ orderId: a.id, status: 'pending_on_delivery', changedAt: day(1), changedBy: 'النظام' })
  const [b] = await db.select().from(s.orders).where((await import('drizzle-orm')).eq(s.orders.orderNumber, 'ORD-B'))
  await db.insert(s.orderPaymentProofs).values({ orderId: b.id, objectKey: 'payment-proofs/x/y.enc', iv: 'a', authTag: 'b', keyVersion: '1', uploadedAt: day(5) })
})

const numbers = async (filters = {}, page = 0, size = 25) => (await getAdminOrdersPage(filters, page, size)).orders.map((o) => o.orderNumber)

describe('getAdminOrdersPage', () => {
  it('returns the full admin shape for an order', async () => {
    const page = await getAdminOrdersPage({ search: 'ORD-A' })
    const o = page.orders[0]
    expect(o).toMatchObject({ orderNumber: 'ORD-A', status: 'new', customerId: 'CUS_ONE', customerName: 'سالم علي', city: 'صنعاء', paymentMethod: 'cash_on_delivery', paymentStatus: 'pending_on_delivery', hasPaymentProof: false, duplicateTransferReference: false, total: 300 })
    expect(o.items.map((i) => [i.name, i.quantity, i.price, i.lineTotal, i.productId, i.sku, i.productNumber])).toEqual([
      ['قميص أزرق', 2, 100, 200, 'gp150', 'SKU-BLUE', 'TJ-GP150'],
      ['حقيبة', 1, 100, 100, undefined, undefined, undefined],
    ])
    expect(o.statusHistory).toEqual([
      { from: undefined, to: 'new', changedAt: day(1).toISOString(), changedBy: undefined, note: undefined },
      { from: 'new', to: 'confirmed', changedAt: day(2).toISOString(), changedBy: 'مدير', note: 'تم الاتصال' },
    ])
    expect(o.paymentStatusHistory).toHaveLength(1)
    expect(o.courierSnapshot).toBeUndefined()
    expect(page.total).toBe(1)
  })

  it('reports proofs and the live courier link', async () => {
    const o = (await getAdminOrdersPage({ search: 'ORD-B' })).orders[0]
    expect(o).toMatchObject({ hasPaymentProof: true, paymentProofUploadedAt: day(5).toISOString(), transferReference: 'TRF-5566', deliveredAt: day(6).toISOString() })
    expect(o.courierSnapshot).toMatchObject({ courierId: courierA.id, name: 'أحمد المندوب' })
  })

  it('keeps the courier snapshot when the courier was deleted', async () => {
    const o = (await getAdminOrdersPage({ search: 'ORD-C' })).orders[0]
    expect(o.courierSnapshot).toMatchObject({ courierId: '00000000-0000-4000-8000-0000000000aa', name: 'مندوب محذوف' })
  })

  it('filters by status, payment, city and courier', async () => {
    expect((await numbers({ status: 'delivered' })).sort()).toEqual(['ORD-B'])
    expect((await numbers({ status: 'all' })).length).toBe(4)
    expect((await numbers({ paymentMethod: 'manual_transfer' }))).toEqual(['ORD-B'])
    expect((await numbers({ paymentStatus: 'verified' }))).toEqual(['ORD-B'])
    expect((await numbers({ city: 'صنعاء' })).sort()).toEqual(['ORD-A', 'ORD-C'])
    expect((await numbers({ courierId: courierA.id }))).toEqual(['ORD-B'])
    expect((await numbers({ courierId: '00000000-0000-4000-8000-0000000000aa' }))).toEqual(['ORD-C'])
    expect((await numbers({ unassignedOnly: true })).sort()).toEqual(['ORD-A', 'ORD-D'])
  })

  it('filters by created and delivered date ranges', async () => {
    expect((await numbers({ dateFrom: '2026-10-05', dateTo: '2026-10-10' })).sort()).toEqual(['ORD-B', 'ORD-C'])
    expect(await numbers({ deliveredFrom: '2026-10-06', deliveredTo: '2026-10-06' })).toEqual(['ORD-B'])
    expect(await numbers({ deliveredFrom: '2026-10-07' })).toEqual([])
  })

  it('searches orders, customers, phones, transfers, couriers and items, case-insensitively', async () => {
    expect(await numbers({ search: 'ord-d' })).toEqual(['ORD-D'])
    expect(await numbers({ search: 'سالم' })).toEqual(['ORD-A'])
    expect(await numbers({ search: '1234567' })).toEqual(['ORD-A'])
    expect(await numbers({ search: 'trf-55' })).toEqual(['ORD-B'])
    expect(await numbers({ search: 'المندوب' })).toEqual(['ORD-B'])
    expect(await numbers({ search: 'محذوف' })).toEqual(['ORD-C'])
    expect(await numbers({ search: 'قميص' })).toEqual(['ORD-A'])
    expect(await numbers({ search: 'sku-blue' })).toEqual(['ORD-A'])
    expect(await numbers({ search: 'TJ-GP15' })).toEqual(['ORD-A'])
    expect(await numbers({ search: 'tj-gp150' })).toEqual(['ORD-A']) // the tj- prefix is stripped for the raw product id
    expect(await numbers({ search: 'nothing-matches-this' })).toEqual([])
  })

  it('treats % and _ in the search as plain characters', async () => {
    expect(await numbers({ search: '%' })).toEqual(['ORD-C']) // only "ضيف 100%" contains a literal percent sign
    expect((await numbers({ search: '_' })).length).toBe(0)
  })

  it('sorts and paginates deterministically', async () => {
    expect(await numbers({ sort: 'newest' })).toEqual(['ORD-D', 'ORD-C', 'ORD-B', 'ORD-A'])
    expect(await numbers({ sort: 'oldest' })).toEqual(['ORD-A', 'ORD-B', 'ORD-C', 'ORD-D'])
    expect(await numbers({ sort: 'total-desc' })).toEqual(['ORD-C', 'ORD-A', 'ORD-D', 'ORD-B'])
    expect(await numbers({ sort: 'total-asc' })).toEqual(['ORD-B', 'ORD-D', 'ORD-A', 'ORD-C'])
    const p0 = await getAdminOrdersPage({ sort: 'newest' }, 0, 3)
    const p1 = await getAdminOrdersPage({ sort: 'newest' }, 1, 3)
    expect([p0.orders.length, p0.total, p0.hasMore]).toEqual([3, 4, true])
    expect([p1.orders.map((o) => o.orderNumber), p1.hasMore]).toEqual([['ORD-A'], false])
    expect((await getAdminOrdersPage({}, -5, 1000)).orders.length).toBe(4) // bad paging input is clamped
  })

  it('returns an empty page without a database', async () => {
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    expect(await getAdminOrdersPage()).toEqual({ orders: [], total: 0, hasMore: false })
    expect(await getAdminOrderStats()).toEqual(EMPTY_ORDER_STATS)
    expect(await getAdminCouriers()).toEqual([])
    process.env.DATABASE_URL = saved
  })
})

describe('getAdminOrderStats', () => {
  it('counts by status, payment and city, with distinct customers and unassigned orders', async () => {
    const stats = await getAdminOrderStats()
    expect(stats.total).toBe(4)
    expect(stats.statusCounts).toMatchObject({ all: 4, new: 1, delivered: 1, on_the_way: 1, cancelled: 1, confirmed: 0 })
    expect(stats.paymentCounts).toEqual({ pending_on_delivery: 3, verified: 1 })
    expect(stats.unassigned).toBe(2) // ORD-C has a snapshot, so it counts as assigned
    expect(stats.cityNames).toEqual(['تعز', 'صنعاء', 'عدن'].sort((a, b) => a.localeCompare(b, 'ar')))
    const sanaa = stats.cities.find((c) => c.city === 'صنعاء')!
    expect(sanaa).toMatchObject({ total: 2, newOrders: 1, onTheWay: 1, delivered: 0, unassigned: 1 })
    expect(stats.cities[0].city).toBe('صنعاء') // biggest city first
  })

  it('counts a registered customer once per city even with several orders', async () => {
    const taiz = (await getAdminOrderStats()).cities.find((c) => c.city === 'تعز')!
    expect(taiz.customers).toBe(1)
  })
})

describe('getAdminCouriers', () => {
  it('lists couriers with assignment stats and resolved images', async () => {
    const list = await getAdminCouriers()
    expect(list.map((c) => c.name)).toEqual(['أحمد المندوب', 'بدر'])
    const a = list.find((c) => c._id === courierA.id)!
    expect(a).toMatchObject({ phone: '700', status: 'active', stats: { assigned: 1, delivered: 1, onTheWay: 0, failed: 0 } })
    expect(list.find((c) => c._id === courierB.id)).toMatchObject({ status: 'suspended', stats: { assigned: 0 } })
  })
})

describe('sender phone of a transfer', () => {
  it('is returned to the panel and searchable', async () => {
    await mk({ orderNumber: 'ORD-SP', paymentMethod: 'manual_transfer', paymentStatus: 'pending_verification', transferReference: 'SP-1234', transferSenderName: 'محمد علي', transferSenderPhone: '967779998877' })
    const page = await getAdminOrdersPage({ search: '779998877' })
    expect(page.orders.map((o) => o.orderNumber)).toEqual(['ORD-SP'])
    expect(page.orders[0]).toMatchObject({ transferSenderName: 'محمد علي', transferSenderPhone: '967779998877' })
  })
})
