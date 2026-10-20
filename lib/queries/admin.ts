import 'server-only'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  categories,
  customers,
  notifications,
  orderItems,
  orders,
  productImages,
  products,
} from '@/lib/db/schema'

export type ProductInput = {
  slug: string
  name: string
  description: string | null
  priceMinor: number
  currency: string
  stock: number
  status: 'draft' | 'active' | 'archived'
  categoryId: string | null
}

export const listAllProducts = () => db.select().from(products).orderBy(desc(products.createdAt))
export const listCategories = () => db.select().from(categories).orderBy(asc(categories.name))

export async function createCategory(slug: string, name: string) {
  const [row] = await db.insert(categories).values({ slug, name }).returning()
  return row
}

export async function createProduct(input: ProductInput) {
  const [row] = await db.insert(products).values(input).returning()
  return row
}

export async function updateProduct(id: string, input: ProductInput) {
  const [row] = await db
    .update(products)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning()
  return row ?? null
}

export async function getProductForAdmin(id: string) {
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1)
  if (!product) return null
  const images = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id))
    .orderBy(asc(productImages.sortOrder))
  return { ...product, images }
}

export async function addProductImage(productId: string, objectKey: string, alt: string | null) {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${productImages.sortOrder}) + 1, 0)` })
    .from(productImages)
    .where(eq(productImages.productId, productId))
  const [row] = await db
    .insert(productImages)
    .values({ productId, objectKey, alt, sortOrder: next })
    .returning()
  return row
}

/** Returns the deleted row (so the caller can remove the R2 object) or null. */
export async function deleteProductImage(id: string, productId: string) {
  const [row] = await db
    .delete(productImages)
    .where(and(eq(productImages.id, id), eq(productImages.productId, productId)))
    .returning()
  return row ?? null
}

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot move order from ${from} to ${to}`)
  }
}

/** Moves an order along the allowed transitions; cancelling restores stock; the customer is notified. */
export async function updateOrderStatus(orderId: string, to: (typeof orders.$inferSelect)['status']) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
    if (!order) throw new Error('Order not found')
    if (!ORDER_TRANSITIONS[order.status]?.includes(to)) {
      throw new InvalidTransitionError(order.status, to)
    }
    if (to === 'cancelled') {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId))
      for (const i of items) {
        await tx
          .update(products)
          .set({ stock: sql`${products.stock} + ${i.qty}`, updatedAt: new Date() })
          .where(eq(products.id, i.productId))
      }
    }
    const [updated] = await tx
      .update(orders)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning()
    await tx.insert(notifications).values({
      customerId: order.customerId,
      type: 'order_status',
      payload: { orderId, status: to },
    })
    return updated
  })
}

export function listOrdersForAdmin(limit = 100) {
  return db
    .select({
      id: orders.id,
      status: orders.status,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      createdAt: orders.createdAt,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
}
