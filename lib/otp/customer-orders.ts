import "server-only"
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import { orderItems, orderStatusHistory, orders } from "@/lib/db/store"

// طلبات العميل المسجَّل. الملكية: الطلب المرتبط بحسابه، أو الطلب القديم بلا حساب
// المطابق لهاتفه (طلبات سابقة لإنشاء الحسابات). لا يُعاد أي طلب لا يخص صاحب الجلسة.

export type CustomerOrderSummary = {
  orderNumber: string
  status: string
  createdAt: string | null
  lastUpdatedAt: string | null
  total: number | null
  currency: string | null
  currencyCode: string | null
  paymentStatus: string | null
  paymentMethod: string | null
  itemsCount: number
  firstItemImage: string | null
  firstItemName: string | null
}

export type CustomerOrderDetail = {
  orderNumber: string
  status: string
  createdAt: string | null
  lastUpdatedAt: string | null
  paymentStatus: string | null
  paymentMethod: string | null
  customerName: string | null
  phone: string | null
  city: string | null
  address: string | null
  customerNote: string | null
  shippingMethod: string | null
  shippingPrice: number | null
  discount: number | null
  subtotal: number | null
  total: number | null
  currency: string | null
  currencyCode: string | null
  deliveredAt: string | null
  courierAssignedAt: string | null
  courierName: string | null
  items: Array<{
    productNumber: string | null
    sku: string | null
    image: string | null
    name: string | null
    size: string | null
    color: string | null
    quantity: number | null
    price: number | null
    lineTotal: number | null
  }>
  statusTimeline: Array<{ status: string; changedAt: string }>
}

export type OrderOwner = { id: string; phone: string }

const MAX_ORDER_NUMBER_LENGTH = 40

const owns = (owner: OrderOwner) =>
  or(eq(orders.customerId, owner.id), and(isNull(orders.customerId), eq(orders.customerPhoneNormalized, owner.phone)))

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export async function countOrdersForCustomer(owner: OrderOwner): Promise<number> {
  if (!isDbConfigured()) return 0
  const [row] = await db.select({ n: count() }).from(orders).where(owns(owner))
  return row?.n ?? 0
}

export async function listOrdersForCustomer(owner: OrderOwner): Promise<CustomerOrderSummary[]> {
  if (!isDbConfigured()) return []
  try {
    const rows = await db.select().from(orders).where(owns(owner)).orderBy(desc(orders.createdAt))
    if (rows.length === 0) return []
    const items = await db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
      .orderBy(asc(orderItems.orderId), asc(orderItems.position))
    return rows.map((o) => {
      const mine = items.filter((i) => i.orderId === o.id)
      return {
        orderNumber: o.orderNumber,
        status: o.status,
        createdAt: iso(o.createdAt),
        lastUpdatedAt: iso(o.updatedAt),
        total: o.total,
        currency: o.currencySymbol,
        currencyCode: o.currencyCode,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        itemsCount: mine.length,
        firstItemImage: mine[0]?.imageUrl ?? null,
        firstItemName: mine[0]?.name ?? null,
      }
    })
  } catch {
    console.log("listOrdersForCustomer query failed")
    return []
  }
}

export async function getOrderForCustomer(owner: OrderOwner, orderNumber: string): Promise<CustomerOrderDetail | null> {
  if (!isDbConfigured()) return null
  const normalized = orderNumber.trim().slice(0, MAX_ORDER_NUMBER_LENGTH).toUpperCase()
  if (!normalized) return null
  try {
    const [o] = await db
      .select()
      .from(orders)
      .where(and(sql`upper(${orders.orderNumber}) = ${normalized}`, owns(owner)))
      .limit(1)
    if (!o) return null
    const [items, history] = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.position)),
      db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, o.id)).orderBy(asc(orderStatusHistory.changedAt)),
    ])
    return {
      orderNumber: o.orderNumber,
      status: o.status,
      createdAt: iso(o.createdAt),
      lastUpdatedAt: iso(o.updatedAt),
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      customerName: o.customerName,
      phone: o.phone,
      city: o.city,
      address: o.address,
      customerNote: o.customerNote,
      shippingMethod: o.shippingMethod,
      shippingPrice: o.shippingPrice,
      discount: o.discount,
      subtotal: o.subtotal,
      total: o.total,
      currency: o.currencySymbol,
      currencyCode: o.currencyCode,
      deliveredAt: iso(o.deliveredAt),
      courierAssignedAt: iso(o.courierAssignedAt),
      courierName: o.courierSnapshot?.name ?? null,
      items: items.map((i) => ({
        productNumber: i.productNumber,
        sku: i.sku,
        image: i.imageUrl,
        name: i.name,
        size: i.size,
        color: i.color,
        quantity: i.quantity,
        price: i.price,
        lineTotal: i.price * i.quantity,
      })),
      statusTimeline: history.map((h) => ({ status: h.toStatus, changedAt: h.changedAt.toISOString() })),
    }
  } catch {
    console.log("getOrderForCustomer query failed")
    return null
  }
}
