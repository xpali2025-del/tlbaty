import { beforeAll, describe, expect, it, vi } from 'vitest'
import { openTestDb } from './helpers/test-db'
import * as s from '@/lib/db/store'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const testDb = await openTestDb()
const db = testDb.db
vi.mock('@/lib/db/client', () => ({ db }))

const { countOrdersForCustomer, getOrderForCustomer, listOrdersForCustomer } = await import('@/lib/otp/customer-orders')

const PHONE_A = '967700000001'
const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d, 12))
let ownerA: { id: string; phone: string; createdAt: Date }

// العميل A أُنشئ حسابه في 2026-01-10. الجدول يطابق ما في docs/customer-auth-phases/phase-0-order-ownership-fix.md:
// O1 حسابه · O2 ضيف قبل الحساب · O3 ضيف بعد الحساب · O4 ضيف مفصول · O5 حساب آخر بالهاتف نفسه · O6 ضيف بهاتف آخر
beforeAll(async () => {
  await testDb.migrate()
  const [a] = await db.insert(s.customers).values({ publicId: 'CUS_A', phone: PHONE_A, createdAt: day(1, 10) }).returning()
  const [b] = await db.insert(s.customers).values({ publicId: 'CUS_B', phone: '967700000002', createdAt: day(1, 1) }).returning()
  ownerA = { id: a.id, phone: a.phone, createdAt: a.createdAt }
  const mk = (orderNumber: string, over: Partial<typeof s.orders.$inferInsert>) =>
    db.insert(s.orders).values({ orderNumber, customerName: 'عميل', phone: '777', subtotal: 100, total: 100, ...over }).returning().then(([o]) => o)
  const orders = [
    await mk('O1', { customerId: a.id, customerPhoneNormalized: PHONE_A, createdAt: day(2, 1) }),
    await mk('O2', { customerId: null, customerPhoneNormalized: PHONE_A, createdAt: day(1, 5) }),
    await mk('O3', { customerId: null, customerPhoneNormalized: PHONE_A, createdAt: day(1, 20) }),
    await mk('O4', { customerId: null, customerPhoneNormalized: PHONE_A, createdAt: day(1, 5), detachedAt: day(3, 1) }),
    await mk('O5', { customerId: b.id, customerPhoneNormalized: PHONE_A, createdAt: day(1, 5) }),
    await mk('O6', { customerId: null, customerPhoneNormalized: '967700000009', createdAt: day(1, 5) }),
  ]
  await db.insert(s.orderItems).values(orders.map((o) => ({ orderId: o.id, position: 0, name: 'منتج', quantity: 1, price: 10 })))
})

const numbers = async () => (await listOrdersForCustomer(ownerA)).map((o) => o.orderNumber)

describe('customer order ownership', () => {
  it("lists the customer's own orders and guest orders placed before the account existed", async () => {
    expect(await numbers()).toEqual(['O1', 'O2']) // الأحدث أولاً
  })
  it('ignores guest orders placed after the account was created', async () => {
    expect(await numbers()).not.toContain('O3')
  })
  it('ignores detached orders even when the phone matches', async () => {
    expect(await numbers()).not.toContain('O4')
  })
  it("never shows another customer's order with the same phone", async () => {
    expect(await numbers()).not.toContain('O5')
  })
  it('ignores guest orders of other phones', async () => {
    expect(await numbers()).not.toContain('O6')
  })
  it('count matches the list', async () => {
    expect(await countOrdersForCustomer(ownerA)).toBe(2)
  })
  it('detail follows the same rule', async () => {
    expect((await getOrderForCustomer(ownerA, 'O1'))?.orderNumber).toBe('O1')
    expect((await getOrderForCustomer(ownerA, 'O2'))?.orderNumber).toBe('O2')
    for (const n of ['O3', 'O4', 'O5', 'O6']) expect(await getOrderForCustomer(ownerA, n)).toBeNull()
  })
})
