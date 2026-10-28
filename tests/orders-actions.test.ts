import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { unwrapAll } from '@/lib/action-result'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
const mocks = vi.hoisted(() => ({
  auth: vi.fn(async () => {}),
  deletePaymentProof: vi.fn(async (_k: string) => {}),
}))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: mocks.auth, assertManageAuthenticated: mocks.auth, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'مدير الاختبار' }))
vi.mock('@/lib/storage/proofs', async (orig) => ({ ...(await orig<typeof import('@/lib/storage/proofs')>()), deletePaymentProof: mocks.deletePaymentProof }))

const A = unwrapAll(await import('@/app/manage/orders-actions'))

let seq = 0
async function order(over: Partial<typeof s.orders.$inferInsert> = {}) {
  const [o] = await db.insert(s.orders).values({ orderNumber: `ORD-T-${++seq}`, customerName: 'عميل', phone: '777', subtotal: 10, total: 10, ...over }).returning()
  return o
}
const get = async (id: string) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0]
const UNKNOWN = '00000000-0000-4000-8000-000000000000'

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})
beforeEach(() => vi.clearAllMocks())

describe('updateOrderStatus', () => {
  it('requires auth', async () => {
    const o = await order()
    mocks.auth.mockRejectedValueOnce(new Error('unauthorized'))
    expect(await A.updateOrderStatus(o.id, 'confirmed')).toEqual({ ok: false, error: 'unauthorized' })
    expect((await get(o.id)).status).toBe('new')
  })

  it('walks the happy path, writes history with note and admin, sets deliveredAt', async () => {
    const o = await order()
    expect((await A.updateOrderStatus(o.id, 'confirmed', 'تم الاتصال')).ok).toBe(true)
    for (const next of ['processing', 'ready', 'assigned', 'on_the_way', 'delivered'] as const) {
      const r = await A.updateOrderStatus(o.id, next)
      expect(r.ok, JSON.stringify(r)).toBe(true)
    }
    const row = await get(o.id)
    expect(row.status).toBe('delivered')
    expect(row.deliveredAt).not.toBeNull()
    const hist = await db.select().from(s.orderStatusHistory).where(eq(s.orderStatusHistory.orderId, o.id))
    const first = hist.find((h) => h.toStatus === 'confirmed')
    expect(first).toMatchObject({ fromStatus: 'new', changedBy: 'مدير الاختبار', note: 'تم الاتصال' })
  })

  it('rejects invalid, repeated and unknown transitions without writing', async () => {
    const o = await order()
    expect((await A.updateOrderStatus(o.id, 'delivered')).ok).toBe(false)
    expect((await A.updateOrderStatus(o.id, 'new')).ok).toBe(false)
    expect((await A.updateOrderStatus(o.id, 'bogus' as never)).ok).toBe(false)
    expect((await A.updateOrderStatus(UNKNOWN, 'confirmed')).ok).toBe(false)
    expect((await A.updateOrderStatus('nope', 'confirmed')).ok).toBe(false)
    expect((await get(o.id)).status).toBe('new')
    expect(await db.select().from(s.orderStatusHistory).where(eq(s.orderStatusHistory.orderId, o.id))).toHaveLength(0)
  })
})

describe('stock restore', () => {
  it('returns stock when an order is cancelled, once only', async () => {
    const [cat] = await db.insert(s.categories).values({ name: 'ق', slug: 'c-stock' }).returning()
    const [p] = await db.insert(s.products).values({ productNumber: 'ST-1', name: 'منتج', slug: 'st-1', categoryId: cat.id, price: 5, description: 'd', stock: 7 }).returning()
    const o = await order()
    await db.insert(s.orderItems).values([
      { orderId: o.id, position: 0, productId: p.id, name: 'منتج', quantity: 2, price: 5 },
      { orderId: o.id, position: 1, productId: p.id, name: 'منتج', quantity: 1, price: 5 },
      { orderId: o.id, position: 2, productId: null, name: 'محذوف', quantity: 4, price: 5 },
    ])
    expect((await A.updateOrderStatus(o.id, 'cancelled')).ok).toBe(true)
    expect((await db.select().from(s.products).where(eq(s.products.id, p.id)))[0].stock).toBe(10)
    expect((await A.updateOrderStatus(o.id, 'cancelled')).ok).toBe(false)
    expect((await A.updateOrderStatus(o.id, 'returned')).ok).toBe(false)
    expect((await db.select().from(s.products).where(eq(s.products.id, p.id)))[0].stock).toBe(10)
  })
})

describe('deleteOrder stock', () => {
  it('returns the units of an open order to stock when it is deleted, but not those of a delivered one', async () => {
    const [cat] = await db.insert(s.categories).values({ name: 'ق2', slug: 'c-del' }).returning()
    const [p] = await db.insert(s.products).values({ productNumber: 'DL-1', name: 'منتج', slug: 'dl-1', categoryId: cat.id, price: 5, description: 'd', stock: 4 }).returning()
    const open = await order()
    await db.insert(s.orderItems).values({ orderId: open.id, position: 0, productId: p.id, name: 'منتج', quantity: 3, price: 5 })
    await A.deleteOrder(open.id)
    expect((await db.select().from(s.products).where(eq(s.products.id, p.id)))[0].stock).toBe(7)
    const delivered = await order({ status: 'delivered' })
    await db.insert(s.orderItems).values({ orderId: delivered.id, position: 0, productId: p.id, name: 'منتج', quantity: 2, price: 5 })
    await A.deleteOrder(delivered.id)
    expect((await db.select().from(s.products).where(eq(s.products.id, p.id)))[0].stock).toBe(7)
    // «تعذر التسليم» ليست نهائية: وحداتها ما زالت محجوزة فتعود للمخزون عند الحذف
    const failed = await order({ status: 'failed' })
    await db.insert(s.orderItems).values({ orderId: failed.id, position: 0, productId: p.id, name: 'منتج', quantity: 2, price: 5 })
    await A.deleteOrder(failed.id)
    expect((await db.select().from(s.products).where(eq(s.products.id, p.id)))[0].stock).toBe(9)
  })
})

describe('assignCourier', () => {
  it('refuses closed orders', async () => {
    const [c] = await db.insert(s.couriers).values({ name: 'مندوب مغلق' }).returning()
    const done = await order({ status: 'delivered' })
    expect((await A.assignCourier([done.id], c.id)).ok).toBe(false)
    expect((await get(done.id)).courierId).toBeNull()
  })
})

describe('assignCourier (basics)', () => {
  it('assigns many orders atomically and snapshots the courier', async () => {
    const [c] = await db.insert(s.couriers).values({ name: 'مندوب', phone: '700' }).returning()
    const [a, b] = [await order(), await order()]
    expect((await A.assignCourier([a.id, b.id], c.id)).ok).toBe(true)
    for (const o of [a, b]) {
      expect(await get(o.id)).toMatchObject({ courierId: c.id, courierSnapshot: { courierId: c.id, name: 'مندوب', phone: '700' } })
    }
    expect((await A.unassignCourier(a.id)).ok).toBe(true)
    expect(await get(a.id)).toMatchObject({ courierId: null, courierSnapshot: null })
  })

  it('rolls back everything when one id is unknown, and refuses suspended/unknown couriers', async () => {
    const [c] = await db.insert(s.couriers).values({ name: 'مندوب 2' }).returning()
    const [sus] = await db.insert(s.couriers).values({ name: 'موقوف', status: 'suspended' }).returning()
    const a = await order()
    expect((await A.assignCourier([a.id, UNKNOWN], c.id)).ok).toBe(false)
    expect((await get(a.id)).courierId).toBeNull()
    expect((await A.assignCourier([a.id], sus.id)).ok).toBe(false)
    expect((await A.assignCourier([a.id], UNKNOWN)).ok).toBe(false)
    expect((await get(a.id)).courierId).toBeNull()
  })
})

describe('updatePaymentStatus', () => {
  const transfer = () => order({ paymentMethod: 'manual_transfer', paymentStatus: 'pending_verification', transferReference: 'TRF-1234' })

  it('verifies a transfer and records history', async () => {
    const o = await transfer()
    await A.updatePaymentStatus(o.id, 'verified', { note: 'تمت المطابقة' })
    const row = await get(o.id)
    expect(row.paymentStatus).toBe('verified')
    expect(row.paymentVerifiedAt).not.toBeNull()
    const h = await db.select().from(s.orderPaymentStatusHistory).where(eq(s.orderPaymentStatusHistory.orderId, o.id))
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ status: 'verified', changedBy: 'مدير الاختبار', note: 'تمت المطابقة' })
  })

  it('requires a reason to reject and stores it', async () => {
    const o = await transfer()
    await expect(A.updatePaymentStatus(o.id, 'rejected')).rejects.toThrow('سبب')
    expect((await get(o.id)).paymentStatus).toBe('pending_verification')
    await A.updatePaymentStatus(o.id, 'rejected', { reason: 'المبلغ غير مطابق' })
    expect(await get(o.id)).toMatchObject({ paymentStatus: 'rejected', paymentRejectionReason: 'المبلغ غير مطابق' })
  })

  it('rejects illegal transitions, unknown statuses and unknown orders', async () => {
    const cod = await order()
    await expect(A.updatePaymentStatus(cod.id, 'verified')).rejects.toThrow()
    await expect(A.updatePaymentStatus(cod.id, 'bogus' as never)).rejects.toThrow()
    await expect(A.updatePaymentStatus(UNKNOWN, 'verified')).rejects.toThrow()
  })

  it('requires auth', async () => {
    const o = await transfer()
    mocks.auth.mockRejectedValueOnce(new Error('غير مصرّح'))
    await expect(A.updatePaymentStatus(o.id, 'verified')).rejects.toThrow('غير مصرّح')
    expect((await get(o.id)).paymentStatus).toBe('pending_verification')
  })
})

describe('deleteOrder', () => {
  it('deletes the order, cascades its rows and removes the proof object', async () => {
    const o = await order()
    await db.insert(s.orderItems).values({ orderId: o.id, position: 0, name: 'x', quantity: 1, price: 1 })
    await db.insert(s.orderPaymentProofs).values({ orderId: o.id, objectKey: `payment-proofs/${o.id}/a.enc`, iv: 'a', authTag: 'b', keyVersion: '1' })
    await A.deleteOrder(o.id)
    expect(await db.select().from(s.orders).where(eq(s.orders.id, o.id))).toHaveLength(0)
    expect(await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, o.id))).toHaveLength(0)
    expect(await db.select().from(s.orderPaymentProofs).where(eq(s.orderPaymentProofs.orderId, o.id))).toHaveLength(0)
    expect(mocks.deletePaymentProof).toHaveBeenCalledWith(`payment-proofs/${o.id}/a.enc`)
  })

  it('does not touch storage when the order does not exist', async () => {
    await A.deleteOrder(UNKNOWN)
    expect(mocks.deletePaymentProof).not.toHaveBeenCalled()
  })
})
