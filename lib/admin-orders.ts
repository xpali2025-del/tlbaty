import "server-only"
import { and, asc, count, desc, eq, exists, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import {
  customers,
  orderItems,
  orderPaymentProofs,
  orderPaymentStatusHistory,
  orderStatusHistory,
  orders,
} from "@/lib/db/store"
import type {
  PaymentAccountSnapshot,
  PaymentMethod,
  PaymentStatus,
  PaymentStatusHistoryEntry,
} from "@/lib/payment"
import {
  ORDER_STATUSES,
  normalizeOrderStatus,
  type OrderStatus,
  type OrderStatusHistoryEntry,
} from "@/lib/order-status"
import type { CourierSnapshot } from "@/lib/courier"
import { customerKey } from "@/lib/phone"

// ============================================
// طبقة قراءة الطلبات للوحة الإدارة على PostgreSQL. بلا كاش (بيانات حيّة).
// _id هو UUID الطلب. بلا DATABASE_URL تعيد صفحة/إحصاءات فارغة آمنة.
// ============================================

export type { OrderStatus }

/** حجم الدفعة الواحدة من الطلبات. */
export const ORDERS_PAGE_SIZE = 25

export type AdminOrderItem = {
  productId?: string
  /** لقطة رقم المنتج وقت الطلب — قد تغيب في الطلبات القديمة. */
  productNumber?: string
  sku?: string
  image?: string
  name?: string
  size?: string
  color?: string
  quantity?: number
  price?: number
  lineTotal?: number
}

export type AdminOrder = {
  _id: string
  orderNumber?: string
  /** حالة موحّدة دائماً — الحالات القديمة مترجمة، والمفقودة تصبح "new". */
  status: OrderStatus
  /** القيمة الأصلية المحفوظة في قاعدة البيانات، للتشخيص وسجل الحالات. */
  rawStatus?: string
  customerId?: string
  customerName?: string
  phone?: string
  city?: string
  address?: string
  customerLocation?: { lat?: number; lng?: number }
  locationAccuracy?: number
  locationCapturedAt?: string
  addressSource?: string
  items: AdminOrderItem[]
  /** ملاحظة اختيارية كتبها العميل — غير موجودة في الطلبات القديمة. */
  customerNote?: string
  shippingMethod?: string
  shippingPrice?: number
  couponCode?: string
  discount?: number
  subtotal?: number
  total?: number
  currency?: string
  createdAt?: string

  // ---------- التوصيل ----------
  /** لقطة المندوب — تغيب في الطلبات القديمة وغير الموزّعة. */
  courierSnapshot?: CourierSnapshot
  courierAssignedAt?: string
  deliveredAt?: string
  statusHistory?: OrderStatusHistoryEntry[]

  // ---------- الدفع (منفصل تماماً عن status) ----------
  paymentMethod?: PaymentMethod
  paymentStatus?: PaymentStatus
  paymentAccountSnapshot?: PaymentAccountSnapshot
  transferSenderName?: string
  transferSenderPhone?: string
  transferReference?: string
  transferSubmittedAt?: string
  /** هل يوجد إثبات حوالة محفوظ؟ لا نعيد الملف أو رابطه إطلاقاً. */
  hasPaymentProof?: boolean
  paymentProofUploadedAt?: string
  paymentVerifiedAt?: string
  paymentRejectedAt?: string
  paymentRejectionReason?: string
  paymentAdminNote?: string
  duplicateTransferReference?: boolean
  paymentStatusHistory?: PaymentStatusHistoryEntry[]
}

/** حقول الطلب الكاملة — تُستخدم في صفحة واحدة فقط من الطلبات. */
export type OrderSortKey = "newest" | "oldest" | "total-desc" | "total-asc"

export type OrderFilters = {
  search?: string
  status?: OrderStatus | "all"
  paymentStatus?: PaymentStatus | "all"
  paymentMethod?: PaymentMethod | "all"
  city?: string
  courierId?: string
  /** الطلبات التي لم يُعيّن لها مندوب فقط. */
  unassignedOnly?: boolean
  /** تاريخ الطلب (YYYY-MM-DD). */
  dateFrom?: string
  dateTo?: string
  /** تاريخ التسليم (YYYY-MM-DD). */
  deliveredFrom?: string
  deliveredTo?: string
  sort?: OrderSortKey
}

export type OrdersPage = {
  orders: AdminOrder[]
  total: number
  /** هل يوجد المزيد بعد هذه الدفعة؟ */
  hasMore: boolean
}

export type OrderStatusCounts = Record<OrderStatus, number> & { all: number }

export type CityStats = {
  city: string
  total: number
  newOrders: number
  unassigned: number
  onTheWay: number
  delivered: number
  customers: number
}

export type OrderStats = {
  statusCounts: OrderStatusCounts
  paymentCounts: Record<string, number>
  /** الطلبات التي لم يُعيّن لها مندوب — عبر كل الحالات. */
  unassigned: number
  cities: CityStats[]
  /** كل المدن الموجودة في الطلبات، مرتبة أبجدياً — لقائمة التصفية. */
  cityNames: string[]
  /** إجمالي الطلبات في المشروع. */
  total: number
}

function emptyStatusCounts(): OrderStatusCounts {
  const counts = { all: 0 } as OrderStatusCounts
  for (const s of ORDER_STATUSES) counts[s] = 0
  return counts
}

export const EMPTY_ORDER_STATS: OrderStats = {
  statusCounts: emptyStatusCounts(),
  paymentCounts: {},
  unassigned: 0,
  cities: [],
  cityNames: [],
  total: 0,
}


/** للطلب مندوب إن وُجد ربط حيّ أو لقطة محفوظة (تبقى اللقطة إن حُذف المندوب لاحقاً). */
const hasCourierSql = sql`(${orders.courierId} is not null or ${orders.courierSnapshot}->>'courierId' is not null)`
const courierIdSql = sql`coalesce(${orders.courierSnapshot}->>'courierId', ${orders.courierId}::text)`

const SORTS: Record<OrderSortKey, SQL> = {
  newest: desc(orders.createdAt),
  oldest: asc(orders.createdAt),
  "total-desc": desc(orders.total),
  "total-asc": asc(orders.total),
}

/** يهرب محارف LIKE الخاصة حتى يُبحث عنها كنص عادي. */
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

function buildWhere(filters: OrderFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = []

  if (filters.status && filters.status !== "all") conditions.push(eq(orders.status, filters.status))
  if (filters.paymentStatus && filters.paymentStatus !== "all") conditions.push(eq(orders.paymentStatus, filters.paymentStatus))
  if (filters.paymentMethod && filters.paymentMethod !== "all") conditions.push(eq(orders.paymentMethod, filters.paymentMethod))

  const city = (filters.city ?? "").trim()
  if (city) conditions.push(eq(orders.city, city))

  if (filters.unassignedOnly) {
    conditions.push(sql`not ${hasCourierSql}`)
  } else {
    const courierId = (filters.courierId ?? "").trim()
    if (courierId) conditions.push(sql`${courierIdSql} = ${courierId}`)
  }

  if (filters.dateFrom) conditions.push(gte(orders.createdAt, new Date(`${filters.dateFrom}T00:00:00Z`)))
  if (filters.dateTo) conditions.push(lte(orders.createdAt, new Date(`${filters.dateTo}T23:59:59Z`)))
  if (filters.deliveredFrom) conditions.push(gte(orders.deliveredAt, new Date(`${filters.deliveredFrom}T00:00:00Z`)))
  if (filters.deliveredTo) conditions.push(lte(orders.deliveredAt, new Date(`${filters.deliveredTo}T23:59:59Z`)))

  const search = (filters.search ?? "").trim().slice(0, 120)
  if (search) {
    const q = likePattern(search)
    const bare = likePattern(search.replace(/^tj-/i, ""))
    conditions.push(
      or(
        sql`${orders.orderNumber} ilike ${q}`,
        sql`${orders.customerName} ilike ${q}`,
        sql`${orders.phone} ilike ${q}`,
        sql`${orders.transferReference} ilike ${q}`,
        sql`${orders.transferSenderPhone} ilike ${q}`,
        sql`${orders.courierSnapshot}->>'name' ilike ${q}`,
        exists(
          db
            .select({ one: sql`1` })
            .from(orderItems)
            .where(
              and(
                eq(orderItems.orderId, orders.id),
                or(
                  sql`${orderItems.productNumber} ilike ${q}`,
                  sql`${orderItems.sku} ilike ${q}`,
                  sql`${orderItems.name} ilike ${q}`,
                  sql`${orderItems.productRef} ilike ${bare}`,
                ),
              ),
            ),
        ),
      ),
    )
  }

  return and(...conditions)
}

const EMPTY_PAGE: OrdersPage = { orders: [], total: 0, hasMore: false }

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined)
const opt = <T,>(v: T | null | undefined): T | undefined => v ?? undefined

export async function getAdminOrdersPage(
  filters: OrderFilters = {},
  page = 0,
  pageSize = ORDERS_PAGE_SIZE,
): Promise<OrdersPage> {
  if (!isDbConfigured()) return EMPTY_PAGE
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0
  const safeSize = Math.min(Math.max(Math.floor(pageSize) || ORDERS_PAGE_SIZE, 1), 100)
  const where = buildWhere(filters)
  const offset = safePage * safeSize

  try {
    const [rows, [{ n }]] = await Promise.all([
      db
        .select({ o: orders, customerPublicId: customers.publicId })
        .from(orders)
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .where(where)
        .orderBy(SORTS[filters.sort ?? "newest"], desc(orders.id))
        .limit(safeSize)
        .offset(offset),
      db.select({ n: count() }).from(orders).where(where),
    ])
    if (rows.length === 0) return { orders: [], total: n, hasMore: false }

    const ids = rows.map((r) => r.o.id)
    const [items, statusHistory, paymentHistory, proofs] = await Promise.all([
      db.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.orderId), asc(orderItems.position)),
      db.select().from(orderStatusHistory).where(inArray(orderStatusHistory.orderId, ids)).orderBy(asc(orderStatusHistory.changedAt)),
      db.select().from(orderPaymentStatusHistory).where(inArray(orderPaymentStatusHistory.orderId, ids)).orderBy(asc(orderPaymentStatusHistory.changedAt)),
      db.select({ orderId: orderPaymentProofs.orderId, uploadedAt: orderPaymentProofs.uploadedAt }).from(orderPaymentProofs).where(inArray(orderPaymentProofs.orderId, ids)),
    ])

    const result = rows.map(({ o, customerPublicId }): AdminOrder => {
      const proof = proofs.find((p) => p.orderId === o.id)
      const snap = o.courierSnapshot
      const hasCourier = Boolean((snap?.courierId ?? o.courierId ?? "").trim())
      return {
        _id: o.id,
        orderNumber: o.orderNumber,
        status: normalizeOrderStatus(o.status),
        rawStatus: o.status,
        customerId: opt(customerPublicId),
        customerName: o.customerName,
        phone: o.phone,
        city: opt(o.city),
        address: opt(o.address),
        customerLocation:
          o.latitude !== null && o.longitude !== null ? { lat: o.latitude, lng: o.longitude } : undefined,
        locationAccuracy: opt(o.locationAccuracy),
        locationCapturedAt: iso(o.locationCapturedAt),
        addressSource: opt(o.addressSource),
        items: items
          .filter((i) => i.orderId === o.id)
          .map((i) => ({
            productId: opt(i.productRef),
            productNumber: opt(i.productNumber),
            sku: opt(i.sku),
            image: opt(i.imageUrl),
            name: i.name,
            size: opt(i.size),
            color: opt(i.color),
            quantity: i.quantity,
            price: i.price,
            lineTotal: i.price * i.quantity,
          })),
        customerNote: opt(o.customerNote),
        shippingMethod: opt(o.shippingMethod),
        shippingPrice: o.shippingPrice,
        couponCode: opt(o.couponCode),
        discount: o.discount,
        subtotal: o.subtotal,
        total: o.total,
        currency: opt(o.currencySymbol),
        createdAt: iso(o.createdAt),
        courierSnapshot: hasCourier
          ? { courierId: snap?.courierId ?? o.courierId ?? undefined, name: snap?.name, phone: snap?.phone }
          : undefined,
        courierAssignedAt: iso(o.courierAssignedAt),
        deliveredAt: iso(o.deliveredAt),
        statusHistory: statusHistory
          .filter((h) => h.orderId === o.id)
          .map((h) => ({ from: opt(h.fromStatus), to: h.toStatus, changedAt: iso(h.changedAt), changedBy: opt(h.changedBy), note: opt(h.note) })),
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        paymentAccountSnapshot: opt(o.paymentAccountSnapshot) as PaymentAccountSnapshot | undefined,
        transferSenderName: opt(o.transferSenderName),
        transferSenderPhone: opt(o.transferSenderPhone),
        transferReference: opt(o.transferReference),
        transferSubmittedAt: iso(o.transferSubmittedAt),
        hasPaymentProof: Boolean(proof),
        paymentProofUploadedAt: iso(proof?.uploadedAt),
        paymentVerifiedAt: iso(o.paymentVerifiedAt),
        paymentRejectedAt: iso(o.paymentRejectedAt),
        paymentRejectionReason: opt(o.paymentRejectionReason),
        paymentAdminNote: opt(o.paymentAdminNote),
        duplicateTransferReference: o.duplicateTransferReference,
        paymentStatusHistory: paymentHistory
          .filter((h) => h.orderId === o.id)
          .map((h) => ({ status: h.status, changedAt: iso(h.changedAt), changedBy: opt(h.changedBy), note: opt(h.note) })),
      }
    })
    return { orders: result, total: n, hasMore: offset + result.length < n }
  } catch (error) {
    console.error("getAdminOrdersPage failed:", error instanceof Error ? error.message : "unknown")
    return EMPTY_PAGE
  }
}

/** لوحة الأرقام: عدّ حسب الحالة والدفع والمدينة، مع عدد العملاء المميّزين في كل مدينة. */
export async function getAdminOrderStats(): Promise<OrderStats> {
  if (!isDbConfigured()) return EMPTY_ORDER_STATS
  let rows: {
    status: string
    paymentStatus: string
    city: string | null
    customerPublicId: string | null
    phone: string
    hasCourier: boolean
  }[] = []
  try {
    rows = await db
      .select({
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        city: orders.city,
        customerPublicId: customers.publicId,
        phone: orders.phone,
        hasCourier: sql<boolean>`${hasCourierSql}`,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
  } catch (error) {
    console.error("getAdminOrderStats failed:", error instanceof Error ? error.message : "unknown")
    return EMPTY_ORDER_STATS
  }

  const statusCounts = emptyStatusCounts()
  const paymentCounts: Record<string, number> = {}
  let unassigned = 0
  const cityMap = new Map<string, { counts: Omit<CityStats, "city" | "customers">; customers: Set<string> }>()

  for (const row of rows) {
    const status = normalizeOrderStatus(row.status)
    statusCounts.all += 1
    statusCounts[status] += 1
    paymentCounts[row.paymentStatus] = (paymentCounts[row.paymentStatus] ?? 0) + 1

    const isUnassigned = !row.hasCourier
    if (isUnassigned) unassigned += 1

    const city = (row.city ?? "").trim() || "بلا مدينة"
    let entry = cityMap.get(city)
    if (!entry) {
      entry = { counts: { total: 0, newOrders: 0, unassigned: 0, onTheWay: 0, delivered: 0 }, customers: new Set<string>() }
      cityMap.set(city, entry)
    }
    entry.counts.total += 1
    if (status === "new") entry.counts.newOrders += 1
    if (isUnassigned) entry.counts.unassigned += 1
    if (status === "on_the_way") entry.counts.onTheWay += 1
    if (status === "delivered") entry.counts.delivered += 1

    const key = customerKey({ customerId: row.customerPublicId ?? undefined, phone: row.phone })
    if (key) entry.customers.add(key)
  }

  const cities: CityStats[] = [...cityMap.entries()]
    .map(([city, entry]) => ({ city, ...entry.counts, customers: entry.customers.size }))
    .sort((a, b) => b.total - a.total || a.city.localeCompare(b.city, "ar"))

  return {
    statusCounts,
    paymentCounts,
    unassigned,
    cities,
    cityNames: cities.map((c) => c.city).sort((a, b) => a.localeCompare(b, "ar")),
    total: statusCounts.all,
  }
}
