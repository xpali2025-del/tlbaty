import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { isAdminEmail } from '@/lib/admin-email'
import * as schema from '@/lib/db/schema'

const db = drizzle(new PGlite(), { schema })
vi.mock('@/lib/db/client', () => ({ db }))

const { createOrder } = await import('@/lib/queries/orders')
const { updateOrderStatus, InvalidTransitionError } = await import('@/lib/queries/admin')

let customerId: string
let productId: string
const stock = async () =>
  (await db.select().from(schema.products).where(eq(schema.products.id, productId)))[0].stock

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  customerId = (await db.insert(schema.customers).values({ email: 'c@x.co', name: 'C' }).returning())[0].id
  productId = (
    await db
      .insert(schema.products)
      .values({ slug: 'p', name: 'P', priceMinor: 1000, stock: 10, status: 'active' })
      .returning()
  )[0].id
})

describe('isAdminEmail', () => {
  it('matches case-insensitively against a comma-separated list', () => {
    expect(isAdminEmail('Owner@X.co', ' owner@x.co , b@x.co ')).toBe(true)
    expect(isAdminEmail('b@x.co', 'owner@x.co')).toBe(false)
  })
  it('denies when the list or email is missing', () => {
    expect(isAdminEmail(undefined, 'a@x.co')).toBe(false)
    expect(isAdminEmail('a@x.co', '')).toBe(false)
    expect(isAdminEmail('a@x.co', undefined)).toBe(false)
  })
})

describe('updateOrderStatus', () => {
  it('follows allowed transitions and notifies the customer', async () => {
    const order = await createOrder({ customerId, items: [{ productId, qty: 2 }] })
    expect((await updateOrderStatus(order.id, 'paid')).status).toBe('paid')
    expect((await updateOrderStatus(order.id, 'shipped')).status).toBe('shipped')
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.type, 'order_status'))
    expect(notes).toHaveLength(2)
  })

  it('rejects invalid transitions', async () => {
    const order = await createOrder({ customerId, items: [{ productId, qty: 1 }] })
    await expect(updateOrderStatus(order.id, 'shipped')).rejects.toBeInstanceOf(InvalidTransitionError)
    await updateOrderStatus(order.id, 'cancelled')
    await expect(updateOrderStatus(order.id, 'paid')).rejects.toBeInstanceOf(InvalidTransitionError)
  })

  it('restores stock exactly once when an order is cancelled', async () => {
    const before = await stock()
    const order = await createOrder({ customerId, items: [{ productId, qty: 3 }] })
    expect(await stock()).toBe(before - 3)
    await updateOrderStatus(order.id, 'cancelled')
    expect(await stock()).toBe(before)
    await expect(updateOrderStatus(order.id, 'cancelled')).rejects.toBeInstanceOf(InvalidTransitionError)
    expect(await stock()).toBe(before)
  })
})
