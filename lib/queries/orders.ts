import 'server-only'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { notifications, orderItems, orders, products } from '@/lib/db/schema'

export type OrderInput = {
  customerId: string
  items: { productId: string; qty: number }[]
}

export class OutOfStockError extends Error {
  constructor(public productId: string) {
    super(`Product ${productId} is unavailable or out of stock`)
  }
}

/** Atomically reserves stock, creates the order and its items, and queues a notification. */
export async function createOrder({ customerId, items }: OrderInput) {
  if (items.length === 0) throw new Error('Order has no items')

  return db.transaction(async (tx) => {
    let totalMinor = 0
    const lines: { productId: string; qty: number; unitPriceMinor: number; currency: string }[] = []

    // Sorted to take row locks in a stable order and avoid deadlocks.
    const sorted = [...items].sort((a, b) => a.productId.localeCompare(b.productId))
    for (const { productId, qty } of sorted) {
      if (!Number.isInteger(qty) || qty <= 0) throw new Error('Invalid quantity')
      const [row] = await tx
        .update(products)
        .set({ stock: sql`${products.stock} - ${qty}`, updatedAt: new Date() })
        .where(and(eq(products.id, productId), eq(products.status, 'active'), gte(products.stock, qty)))
        .returning({ price: products.priceMinor, currency: products.currency })
      if (!row) throw new OutOfStockError(productId)
      totalMinor += row.price * qty
      lines.push({ productId, qty, unitPriceMinor: row.price, currency: row.currency })
    }

    const [order] = await tx
      .insert(orders)
      .values({ customerId, totalMinor, currency: lines[0].currency })
      .returning()
    await tx.insert(orderItems).values(
      lines.map(({ productId, qty, unitPriceMinor }) => ({
        orderId: order.id,
        productId,
        qty,
        unitPriceMinor,
      })),
    )
    await tx.insert(notifications).values({
      customerId,
      type: 'order_created',
      payload: { orderId: order.id, totalMinor },
    })
    return order
  })
}

export async function listCustomerOrders(customerId: string, limit = 20) {
  return db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
}

export async function getOrderWithItems(id: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1)
  if (!order) return null
  const items = await db
    .select({
      id: orderItems.id,
      qty: orderItems.qty,
      unitPriceMinor: orderItems.unitPriceMinor,
      name: products.name,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, id))
  return { ...order, items }
}
