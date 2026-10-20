import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@/lib/db/schema'

const db = drizzle(new PGlite(), { schema })
vi.mock('@/lib/db/client', () => ({ db }))

const { createOrder, OutOfStockError } = await import('@/lib/queries/orders')

let customerId: string
let productId: string

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  const [c] = await db.insert(schema.customers).values({ email: 'a@b.co', name: 'A' }).returning()
  customerId = c.id
  const [p] = await db
    .insert(schema.products)
    .values({ slug: 'p1', name: 'P1', priceMinor: 2500, stock: 5, status: 'active' })
    .returning()
  productId = p.id
})

describe('createOrder', () => {
  it('reserves stock, totals from DB prices, and queues a notification', async () => {
    const order = await createOrder({ customerId, items: [{ productId, qty: 2 }] })
    expect(order.totalMinor).toBe(5000)
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId))
    expect(p.stock).toBe(3)
    const notes = await db.select().from(schema.notifications)
    expect(notes).toHaveLength(1)
    expect(notes[0].type).toBe('order_created')
  })

  it('rolls back everything when stock is insufficient', async () => {
    await expect(createOrder({ customerId, items: [{ productId, qty: 99 }] })).rejects.toBeInstanceOf(
      OutOfStockError,
    )
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId))
    expect(p.stock).toBe(3)
    expect(await db.select().from(schema.orders)).toHaveLength(1)
  })

  it('never oversells under concurrent orders', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createOrder({ customerId, items: [{ productId, qty: 1 }] })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId))
    expect(p.stock).toBe(0)
  })

  it('rejects empty orders and invalid quantities', async () => {
    await expect(createOrder({ customerId, items: [] })).rejects.toThrow()
    await expect(createOrder({ customerId, items: [{ productId, qty: 0 }] })).rejects.toThrow()
  })
})
